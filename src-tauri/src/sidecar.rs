//! Node.js sidecar host. Lazily spawns the sidecar process on first use and
//! exposes a single async `request` method.
//!
//! Wire protocol: newline-delimited JSON, one request per line, one response
//! per line. Each request carries a unique `id`; responses echo it back so
//! the reader can route to the matching caller. See sidecar/index.ts.
//!
//! Concurrency model: a writer task owns stdin, a reader task owns stdout.
//! Callers register a oneshot in a shared pending map keyed by id and await
//! it. Multiple in-flight requests share the same pipe without serialising.
//!
//! Resilience:
//! - Initial spawn failure (no Node on PATH, missing script) parks the
//!   sidecar in `Unavailable`. The app still runs; each subsequent
//!   `request()` tries to respawn first, so installing Node mid-session
//!   recovers without restarting the app.
//! - Mid-session death (reader EOF or writer broken pipe) marks the sidecar
//!   `Unavailable` and drains pending callers with an error. A single slow
//!   request times out independently so it does not kill unrelated in-flight
//!   work.
//!
//! Build modes:
//! - Debug builds (tauri dev): run `npx tsx sidecar/index.ts` from source.
//! - Release builds (tauri build): run a bundled `node` against the
//!   pre-compiled `sidecar/dist/index.js` shipped as a Tauri resource.

use std::collections::{HashMap, VecDeque};
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{ChildStdin, ChildStdout, Command};
use tokio::sync::{mpsc, oneshot};

/// Event name used to forward `{ id, progress: { text } }` lines from the
/// sidecar to the frontend. Listened to by AgentSidebar to render streaming
/// partials.
pub const SIDECAR_PROGRESS_EVENT: &str = "sidecar-progress";

/// Emitted after a successful respawn so the frontend can re-push state the
/// new sidecar process doesn't know about (context source list, etc.).
pub const SIDECAR_RESPAWNED_EVENT: &str = "sidecar-respawned";

/// Caps on sidecar round-trips. Control ops should fail quickly, while AI ops
/// need room for cold SDK startup, context picking, and streamed draft calls.
const QUICK_REQUEST_TIMEOUT: Duration = Duration::from_secs(10);
const DEFAULT_REQUEST_TIMEOUT: Duration = Duration::from_secs(30);
const RANK_REQUEST_TIMEOUT: Duration = Duration::from_secs(60);
const DRAFT_REQUEST_TIMEOUT: Duration = Duration::from_secs(90);

static REQUEST_COUNTER: AtomicU64 = AtomicU64::new(0);

fn next_request_id() -> String {
    let n = REQUEST_COUNTER.fetch_add(1, Ordering::Relaxed);
    format!("r{n}")
}

fn request_timeout(op: &str) -> Duration {
    match op {
        "ping" | "context-status" | "context-list-files" | "context-read-file"
        | "context-search" => QUICK_REQUEST_TIMEOUT,
        "rank" => RANK_REQUEST_TIMEOUT,
        "edit-template" | "adapt-template" | "context-capture-memory" => DRAFT_REQUEST_TIMEOUT,
        _ => DEFAULT_REQUEST_TIMEOUT,
    }
}

type Pending = Arc<Mutex<HashMap<String, oneshot::Sender<Result<serde_json::Value, String>>>>>;

/// Newest-last ring of recent sidecar calls. Drives the Diagnostics panel in
/// Settings so the user can see what the sidecar has been doing without
/// digging through stderr. Sized so p50/p95-per-op stays meaningful even
/// when one op dominates the recent traffic.
const DIAG_CAPACITY: usize = 100;

#[derive(Debug, Clone, serde::Serialize)]
pub struct DiagEntry {
    /// "ping" | "rank" | "edit-template" | "adapt-template" — what the caller asked for.
    pub op: String,
    /// Unix epoch ms when the request was sent.
    pub started_at_ms: u64,
    /// Wall-clock round-trip in ms. Includes serialization + sidecar work + parse.
    pub duration_ms: u64,
    pub ok: bool,
    /// First ~200 chars of the error when `ok` is false. Truncated to avoid bloating the panel.
    pub error: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct Diagnostics {
    /// "active", "starting", or "unavailable".
    pub state: &'static str,
    pub state_reason: Option<String>,
    pub entries: Vec<DiagEntry>,
    pub stats: Vec<DiagStat>,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct DiagStat {
    pub op: String,
    pub count: usize,
    pub p50: u64,
    pub p95: u64,
    pub fail: usize,
}

pub struct Sidecar {
    state: Arc<Mutex<SidecarState>>,
    script: SidecarScript,
    app: AppHandle,
    diag: Arc<Mutex<VecDeque<DiagEntry>>>,
    /// Passed as the sidecar's argv[2] so it can persist the context index
    /// (context.db) next to the app's other data files.
    app_data_dir: PathBuf,
}

enum SidecarState {
    Active(ActiveSidecar),
    Starting(String),
    Unavailable(String),
}

struct ActiveSidecar {
    writer_tx: mpsc::UnboundedSender<Vec<u8>>,
    pending: Pending,
    // Held so `kill_on_drop` reaps the process when the state transitions
    // back to Unavailable or the app exits.
    _child: tokio::process::Child,
}

#[derive(Clone)]
struct SidecarScript {
    path: PathBuf,
    command: SidecarCommand,
}

#[derive(Clone)]
enum SidecarCommand {
    /// Dev: run the TS source via `npx tsx <path>`. Relies on Node + npx
    /// being on PATH (which is true on a dev machine).
    NpxTsx,
    /// Release: run the compiled JS with a Node binary bundled next to the
    /// main app .exe. Zero external prereq on the friend's machine.
    BundledNode(PathBuf),
}

impl Sidecar {
    /// Lazy constructor. Parks state in `Unavailable("not yet started")` and
    /// defers `try_spawn` until the first `request()`. Browse-and-copy
    /// sessions that never touch rank/edit/adapt/context skip the Node
    /// process entirely — no ~1-2s SDK handshake, no ~120 MB resident.
    /// `request()` already auto-respawns from `Unavailable`, so first-use
    /// transparently materialises the process.
    pub fn start(app: &AppHandle, app_data_dir: PathBuf) -> Self {
        let script = resolve_script(app);
        let state = Arc::new(Mutex::new(SidecarState::Unavailable(
            "not yet started".to_string(),
        )));
        Self {
            state,
            script,
            app: app.clone(),
            diag: Arc::new(Mutex::new(VecDeque::with_capacity(DIAG_CAPACITY))),
            app_data_dir,
        }
    }

    fn try_spawn(
        script: &SidecarScript,
        state: &Arc<Mutex<SidecarState>>,
        app: &AppHandle,
        app_data_dir: &PathBuf,
    ) -> Result<ActiveSidecar, String> {
        if !script.path.exists() {
            return Err(format!(
                "sidecar script not found at {}",
                script.path.display()
            ));
        }

        let mut command = match &script.command {
            SidecarCommand::NpxTsx => {
                // On Windows, `npx` is `npx.cmd`. std::process::Command does respect
                // PATHEXT on recent Rust, but being explicit avoids surprise.
                let npx = if cfg!(windows) { "npx.cmd" } else { "npx" };
                let mut c = Command::new(npx);
                c.arg("tsx");
                // Mirrors the BundledNode branch — node:sqlite is experimental in
                // Node 22.x. tsx forwards NODE_OPTIONS to the underlying node.
                c.env("NODE_OPTIONS", "--experimental-sqlite");
                c
            }
            SidecarCommand::BundledNode(node) => {
                if !node.exists() {
                    return Err(format!("bundled node not found at {}", node.display()));
                }
                let mut c = Command::new(node);
                // node:sqlite is experimental in Node 22.x and requires this
                // flag. The bundled binary is pinned at 22.11.0 (see
                // scripts/fetch-node-binary.mjs) where the module exists but
                // refuses to load without the flag. Bump the bundled version
                // and drop this once node:sqlite is stable in the pinned line.
                c.arg("--experimental-sqlite");
                c
            }
        };

        let label = match &script.command {
            SidecarCommand::NpxTsx => "npx tsx".to_string(),
            SidecarCommand::BundledNode(n) => format!("{} (bundled)", n.display()),
        };

        command
            .arg(&script.path)
            .arg(app_data_dir)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .kill_on_drop(true);

        // Without CREATE_NO_WINDOW the bundled node.exe pops a console window
        // when spawned from a GUI parent. The handles we care about
        // (stdin/stdout) still work — only the console allocation is
        // suppressed.
        #[cfg(windows)]
        {
            const CREATE_NO_WINDOW: u32 = 0x0800_0000;
            command.creation_flags(CREATE_NO_WINDOW);
        }

        let mut child = command
            .spawn()
            .map_err(|e| format!("failed to spawn sidecar ({label} {}): {e}", script.path.display()))?;

        let stdin = child.stdin.take().ok_or("sidecar stdin missing")?;
        let stdout = BufReader::new(child.stdout.take().ok_or("sidecar stdout missing")?);

        let pending: Pending = Arc::new(Mutex::new(HashMap::new()));
        let (writer_tx, writer_rx) = mpsc::unbounded_channel::<Vec<u8>>();

        // tauri::async_runtime::spawn uses Tauri's tokio handle — works from
        // both the sync `setup` callback (no reactor on the current thread)
        // and from inside async commands (reactor available).
        tauri::async_runtime::spawn(writer_loop(stdin, writer_rx));
        tauri::async_runtime::spawn(reader_loop(
            stdout,
            pending.clone(),
            state.clone(),
            app.clone(),
        ));

        Ok(ActiveSidecar {
            writer_tx,
            pending,
            _child: child,
        })
    }

    pub async fn request(&self, payload: &serde_json::Value) -> Result<serde_json::Value, String> {
        let op = payload
            .get("op")
            .and_then(|v| v.as_str())
            .unwrap_or("?")
            .to_string();
        let started_at_ms = now_epoch_ms();
        let started = std::time::Instant::now();
        let outcome = self.request_inner(payload, &op).await;
        let duration_ms = started.elapsed().as_millis() as u64;
        let (ok, error) = diag_status(&outcome);
        let entry = DiagEntry {
            op: op.clone(),
            started_at_ms,
            duration_ms,
            ok,
            error,
        };
        push_diag(&self.diag, entry);
        if let Ok(value) = &outcome {
            if let Some(pick_ms) = value
                .get("timings")
                .and_then(|t| t.get("pick_ms"))
                .and_then(|v| v.as_u64())
            {
                push_diag(
                    &self.diag,
                    DiagEntry {
                        op: "pick".to_string(),
                        started_at_ms,
                        duration_ms: pick_ms,
                        ok: true,
                        error: None,
                    },
                );
            }
        }
        outcome
    }

    async fn request_inner(
        &self,
        payload: &serde_json::Value,
        op: &str,
    ) -> Result<serde_json::Value, String> {
        // Snapshot the writer + pending Arc, respawning from Unavailable if
        // needed. Lock is released before any await.
        let (writer_tx, pending, respawned) = {
            let mut guard = self.state.lock().unwrap();
            let mut respawned = false;
            if let SidecarState::Unavailable(prior) = &*guard {
                let prior = prior.clone();
                *guard = SidecarState::Starting("starting sidecar".to_string());
                drop(guard);
                match Self::try_spawn(&self.script, &self.state, &self.app, &self.app_data_dir) {
                    Ok(active) => {
                        guard = self.state.lock().unwrap();
                        *guard = SidecarState::Active(active);
                        respawned = true;
                    }
                    Err(e) => {
                        guard = self.state.lock().unwrap();
                        *guard = SidecarState::Unavailable(e.clone());
                        return Err(format!("sidecar unavailable: {e} (prior: {prior})"));
                    }
                }
            }
            if let SidecarState::Starting(reason) = &*guard {
                return Err(format!("sidecar unavailable: {reason}"));
            }
            let SidecarState::Active(active) = &*guard else { unreachable!() };
            (active.writer_tx.clone(), active.pending.clone(), respawned)
        };
        // Tell the frontend so it can re-push any state the new sidecar
        // process doesn't know about (context source list, etc.).
        if respawned {
            let _ = self.app.emit(SIDECAR_RESPAWNED_EVENT, ());
        }

        // Override any caller-supplied id so concurrent requests don't collide.
        let id = next_request_id();
        let mut payload = payload.clone();
        payload["id"] = serde_json::Value::String(id.clone());

        let mut line = match serde_json::to_string(&payload) {
            Ok(s) => s,
            Err(e) => return Err(e.to_string()),
        };
        line.push('\n');

        let (tx, rx) = oneshot::channel();
        pending.lock().unwrap().insert(id.clone(), tx);

        if writer_tx.send(line.into_bytes()).is_err() {
            pending.lock().unwrap().remove(&id);
            self.mark_unavailable("sidecar writer task exited");
            return Err("sidecar unavailable: writer closed".to_string());
        }

        let timeout = request_timeout(op);
        match tokio::time::timeout(timeout, rx).await {
            Ok(Ok(result)) => result,
            Ok(Err(_)) => {
                // Reader dropped the sender — either it exited (drain ran)
                // or a parse error orphaned this id. Either way, the pipe is
                // no longer trustworthy.
                pending.lock().unwrap().remove(&id);
                self.mark_unavailable("sidecar reader task exited");
                Err("sidecar unavailable: pipe closed".to_string())
            }
            Err(_) => {
                pending.lock().unwrap().remove(&id);
                Err(format!(
                    "sidecar request timed out after {}s",
                    timeout.as_secs()
                ))
            }
        }
    }

    pub fn diagnostics(&self) -> Diagnostics {
        let (state, state_reason) = {
            let guard = self.state.lock().unwrap();
            match &*guard {
                SidecarState::Active(_) => ("active", None),
                SidecarState::Starting(r) => ("starting", Some(r.clone())),
                SidecarState::Unavailable(r) => ("unavailable", Some(r.clone())),
            }
        };
        let entries: Vec<DiagEntry> = self.diag.lock().unwrap().iter().cloned().collect();
        let stats = diag_stats(&entries);
        Diagnostics {
            state,
            state_reason,
            entries,
            stats,
        }
    }

    fn mark_unavailable(&self, reason: &str) {
        let mut guard = self.state.lock().unwrap();
        // If another caller already swapped state, don't overwrite.
        if matches!(*guard, SidecarState::Active(_) | SidecarState::Starting(_)) {
            *guard = SidecarState::Unavailable(reason.to_string());
        }
    }
}

async fn writer_loop(mut stdin: ChildStdin, mut rx: mpsc::UnboundedReceiver<Vec<u8>>) {
    while let Some(bytes) = rx.recv().await {
        if stdin.write_all(&bytes).await.is_err() {
            break;
        }
        if stdin.flush().await.is_err() {
            break;
        }
    }
}

async fn reader_loop(
    mut stdout: BufReader<ChildStdout>,
    pending: Pending,
    state: Arc<Mutex<SidecarState>>,
    app: AppHandle,
) {
    loop {
        let mut line = String::new();
        match stdout.read_line(&mut line).await {
            Ok(0) => break, // EOF
            Ok(_) => {}
            Err(_) => break,
        }
        let parsed: serde_json::Value = match serde_json::from_str(line.trim()) {
            Ok(v) => v,
            Err(e) => {
                eprintln!("sidecar: response parse error: {e}; line: {line:?}");
                continue;
            }
        };
        let Some(id) = parsed.get("id").and_then(|v| v.as_str()).map(String::from) else {
            eprintln!("sidecar: response missing id: {line}");
            continue;
        };

        // Progress lines (no `ok` field) are streaming updates — forward to
        // the frontend without completing the caller's oneshot.
        if parsed.get("progress").is_some() && parsed.get("ok").is_none() {
            let _ = app.emit(SIDECAR_PROGRESS_EVENT, &parsed);
            continue;
        }

        if let Some(tx) = pending.lock().unwrap().remove(&id) {
            let _ = tx.send(Ok(parsed));
        }
        // Unknown id (caller already gave up or timed out): drop silently.
    }

    // Pipe is dead. Mark the sidecar unavailable so the next caller respawns,
    // and complete every still-waiting oneshot with a clear error.
    {
        let mut guard = state.lock().unwrap();
        if matches!(*guard, SidecarState::Active(_)) {
            *guard = SidecarState::Unavailable("sidecar pipe closed".to_string());
        }
    }
    let drained: Vec<_> = pending.lock().unwrap().drain().collect();
    for (_id, tx) in drained {
        let _ = tx.send(Err("sidecar pipe closed".to_string()));
    }
}

/// Resolve where the sidecar entrypoint lives + which command runs it.
/// - Debug builds (tauri dev): TS source under CARGO_MANIFEST_DIR, run via
///   `npx tsx` (Node assumed on PATH for dev machines).
/// - Release builds (tauri build): pre-compiled `dist/index.js` under the
///   bundled resources, run via the Node binary shipped next to the main
///   .exe via tauri.conf.json's `externalBin`. Zero external prereqs on the
///   target machine.
fn resolve_script(app: &AppHandle) -> SidecarScript {
    if cfg!(debug_assertions) {
        return SidecarScript {
            path: PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../sidecar/index.ts"),
            command: SidecarCommand::NpxTsx,
        };
    }

    let resource_dir = app
        .path()
        .resource_dir()
        .ok()
        .unwrap_or_else(|| PathBuf::from("."));
    // `../sidecar/prod-bundle/...` paths declared in tauri.conf.json's
    // bundle.resources land under `_up_/sidecar/prod-bundle/` in the runtime
    // resource_dir. The prod-bundle directory is a freshly-installed,
    // devDeps-pruned copy of the sidecar — see scripts/build-sidecar-prod.mjs.
    let script = resource_dir
        .join("_up_")
        .join("sidecar")
        .join("prod-bundle")
        .join("dist")
        .join("index.js");

    // Tauri places externalBin binaries next to the main .exe with the
    // target-triple suffix stripped (so `node-x86_64-pc-windows-msvc.exe`
    // becomes `node.exe`). Resolve via current_exe()'s parent.
    let node_exe = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|d| d.join(bundled_node_filename())))
        .unwrap_or_else(|| PathBuf::from(bundled_node_filename()));

    SidecarScript {
        path: script,
        command: SidecarCommand::BundledNode(node_exe),
    }
}

fn bundled_node_filename() -> &'static str {
    if cfg!(windows) {
        "node.exe"
    } else {
        "node"
    }
}

fn now_epoch_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn push_diag(diag: &Arc<Mutex<VecDeque<DiagEntry>>>, entry: DiagEntry) {
    let mut buf = diag.lock().unwrap();
    if buf.len() >= DIAG_CAPACITY {
        buf.pop_front();
    }
    buf.push_back(entry);
}

fn diag_stats(entries: &[DiagEntry]) -> Vec<DiagStat> {
    let mut by_op: HashMap<String, (Vec<u64>, usize)> = HashMap::new();
    for entry in entries {
        let (durations, fail) = by_op
            .entry(entry.op.clone())
            .or_insert_with(|| (Vec::new(), 0));
        durations.push(entry.duration_ms);
        if !entry.ok {
            *fail += 1;
        }
    }
    let mut stats: Vec<DiagStat> = by_op
        .into_iter()
        .map(|(op, (mut durations, fail))| {
            durations.sort_unstable();
            DiagStat {
                op,
                count: durations.len(),
                p50: percentile(&durations, 50),
                p95: percentile(&durations, 95),
                fail,
            }
        })
        .collect();
    stats.sort_by(|a, b| b.count.cmp(&a.count).then_with(|| a.op.cmp(&b.op)));
    stats
}

fn percentile(sorted: &[u64], p: usize) -> u64 {
    if sorted.is_empty() {
        return 0;
    }
    let rank = ((p * sorted.len()).div_ceil(100)).saturating_sub(1);
    sorted[rank.min(sorted.len() - 1)]
}

fn diag_status(outcome: &Result<serde_json::Value, String>) -> (bool, Option<String>) {
    match outcome {
        Err(e) => (false, Some(truncate(e, 200))),
        Ok(value) if value.get("ok").and_then(|v| v.as_bool()) == Some(false) => {
            let error = value
                .get("error")
                .and_then(|v| v.as_str())
                .unwrap_or("sidecar returned ok=false");
            (false, Some(truncate(error, 200)))
        }
        Ok(_) => (true, None),
    }
}

fn truncate(s: &str, max: usize) -> String {
    if s.len() <= max {
        return s.to_string();
    }
    // char-boundary safe truncation
    let mut end = max;
    while !s.is_char_boundary(end) && end > 0 {
        end -= 1;
    }
    format!("{}…", &s[..end])
}
