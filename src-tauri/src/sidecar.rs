//! Node.js sidecar host. Spawns the sidecar process at startup, holds its
//! stdin/stdout, and exposes a single async `request` method that the Tauri
//! commands wrap.
//!
//! Wire protocol: newline-delimited JSON, one request per line, one response
//! per line. See sidecar/index.ts for the request/response shapes.
//!
//! Resilience model:
//! - If the initial spawn fails (e.g. Node isn't installed), the Sidecar
//!   enters the [`SidecarState::Unavailable`] state. The app still runs;
//!   only paste-match / agent-edit calls fail with a recognisable error.
//!   Each subsequent request attempts to re-spawn first, so the user can
//!   install Node and have the feature start working without restarting
//!   the app.
//! - If a request fails mid-session with a "process died" type error
//!   (0-byte read, broken pipe), the sidecar is respawned once and the
//!   request retried. Avoids stranding the app on a transient crash.
//!
//! Build modes:
//! - Debug builds (tauri dev): run `npx tsx sidecar/index.ts` from the source
//!   tree, resolved relative to CARGO_MANIFEST_DIR.
//! - Release builds (tauri build): run `node` against the pre-compiled
//!   sidecar/dist/index.js bundled as a Tauri resource.

use std::path::PathBuf;
use std::process::Stdio;
use tauri::{AppHandle, Manager};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{ChildStdin, ChildStdout, Command};
use tokio::sync::Mutex;

pub struct Sidecar {
    inner: Mutex<SidecarState>,
    script: SidecarScript,
}

enum SidecarState {
    Active(SidecarInner),
    Unavailable(String),
}

struct SidecarInner {
    // Holding `_child` keeps the process alive; `kill_on_drop` reaps it at app exit.
    _child: tokio::process::Child,
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
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
    /// Infallible constructor — tries to spawn the sidecar, falling back to an
    /// `Unavailable` state if Node/npx isn't on PATH or the script is missing.
    pub fn start(app: &AppHandle) -> Self {
        let script = resolve_script(app);
        let state = match Self::try_spawn(&script) {
            Ok(inner) => SidecarState::Active(inner),
            Err(e) => {
                eprintln!("sidecar unavailable at startup: {e}");
                SidecarState::Unavailable(e)
            }
        };
        Self {
            inner: Mutex::new(state),
            script,
        }
    }

    fn try_spawn(script: &SidecarScript) -> Result<SidecarInner, String> {
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
                c
            }
            SidecarCommand::BundledNode(node) => {
                if !node.exists() {
                    return Err(format!("bundled node not found at {}", node.display()));
                }
                Command::new(node)
            }
        };

        let label = match &script.command {
            SidecarCommand::NpxTsx => "npx tsx".to_string(),
            SidecarCommand::BundledNode(n) => format!("{} (bundled)", n.display()),
        };

        let mut child = command
            .arg(&script.path)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .kill_on_drop(true)
            .spawn()
            .map_err(|e| format!("failed to spawn sidecar ({label} {}): {e}", script.path.display()))?;

        let stdin = child.stdin.take().ok_or("sidecar stdin missing")?;
        let stdout = BufReader::new(child.stdout.take().ok_or("sidecar stdout missing")?);

        Ok(SidecarInner {
            _child: child,
            stdin,
            stdout,
        })
    }

    pub async fn request(&self, payload: &serde_json::Value) -> Result<serde_json::Value, String> {
        let mut guard = self.inner.lock().await;

        // If we're currently Unavailable, try one respawn before giving up —
        // the user may have installed Node since launch.
        if matches!(*guard, SidecarState::Unavailable(_)) {
            match Self::try_spawn(&self.script) {
                Ok(inner) => *guard = SidecarState::Active(inner),
                Err(_) => {
                    let SidecarState::Unavailable(reason) = &*guard else { unreachable!() };
                    return Err(format!("sidecar unavailable: {reason}"));
                }
            }
        }

        // First attempt with the current process.
        let first_err = {
            let SidecarState::Active(inner) = &mut *guard else { unreachable!() };
            match request_once(inner, payload).await {
                Ok(v) => return Ok(v),
                Err(e) => e,
            }
        };

        // If the error looks like the process died, try one respawn + retry.
        if is_sidecar_dead(&first_err) {
            match Self::try_spawn(&self.script) {
                Ok(inner) => {
                    *guard = SidecarState::Active(inner);
                    let SidecarState::Active(inner) = &mut *guard else { unreachable!() };
                    return request_once(inner, payload).await;
                }
                Err(spawn_err) => {
                    *guard = SidecarState::Unavailable(spawn_err.clone());
                    return Err(format!(
                        "sidecar died and respawn failed: {spawn_err} (original: {first_err})"
                    ));
                }
            }
        }

        Err(first_err)
    }
}

async fn request_once(
    inner: &mut SidecarInner,
    payload: &serde_json::Value,
) -> Result<serde_json::Value, String> {
    let mut line = serde_json::to_string(payload).map_err(|e| e.to_string())?;
    line.push('\n');
    inner
        .stdin
        .write_all(line.as_bytes())
        .await
        .map_err(|e| format!("sidecar write failed: {e}"))?;
    inner
        .stdin
        .flush()
        .await
        .map_err(|e| format!("sidecar flush failed: {e}"))?;

    let mut response_line = String::new();
    let bytes = inner
        .stdout
        .read_line(&mut response_line)
        .await
        .map_err(|e| format!("sidecar read failed: {e}"))?;
    if bytes == 0 {
        return Err("sidecar closed stdout".to_string());
    }
    serde_json::from_str(response_line.trim())
        .map_err(|e| format!("sidecar response parse error: {e}; line: {response_line:?}"))
}

fn is_sidecar_dead(err: &str) -> bool {
    err.contains("closed stdout")
        || err.contains("write failed")
        || err.contains("flush failed")
        || err.contains("Broken pipe")
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
    // `../sidecar/...` paths declared in tauri.conf.json's bundle.resources
    // land under `_up_/` in the runtime resource_dir.
    let script = resource_dir
        .join("_up_")
        .join("sidecar")
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

