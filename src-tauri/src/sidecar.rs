//! Node.js sidecar host. Spawns the sidecar process at startup, holds its
//! stdin/stdout, and exposes a single async `request` method that the Tauri
//! commands wrap.
//!
//! Wire protocol: newline-delimited JSON, one request per line, one response
//! per line. See sidecar/index.ts for the request/response shapes.

use std::path::PathBuf;
use std::process::Stdio;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{ChildStdin, ChildStdout, Command};
use tokio::sync::Mutex;

pub struct Sidecar {
    inner: Mutex<SidecarInner>,
}

struct SidecarInner {
    // Holding `_child` keeps the process alive; `kill_on_drop` reaps it at app exit.
    _child: tokio::process::Child,
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
}

impl Sidecar {
    pub fn spawn() -> Result<Self, String> {
        let script = sidecar_script_path();
        if !script.exists() {
            return Err(format!("sidecar script not found at {}", script.display()));
        }

        // On Windows, `npx` is `npx.cmd`. std::process::Command does respect
        // PATHEXT on recent Rust, but being explicit avoids surprise.
        let npx = if cfg!(windows) { "npx.cmd" } else { "npx" };

        let mut child = Command::new(npx)
            .arg("tsx")
            .arg(&script)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .kill_on_drop(true)
            .spawn()
            .map_err(|e| format!("failed to spawn sidecar ({npx} tsx {}): {e}", script.display()))?;

        let stdin = child.stdin.take().ok_or("sidecar stdin missing")?;
        let stdout = BufReader::new(child.stdout.take().ok_or("sidecar stdout missing")?);

        Ok(Self {
            inner: Mutex::new(SidecarInner {
                _child: child,
                stdin,
                stdout,
            }),
        })
    }

    pub async fn request(&self, payload: &serde_json::Value) -> Result<serde_json::Value, String> {
        let mut inner = self.inner.lock().await;

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
}

/// Resolve the sidecar script path. In dev (cargo run / tauri dev), the cwd
/// is `src-tauri/`, so the sidecar lives at `../sidecar/index.ts` relative to
/// CARGO_MANIFEST_DIR. In a bundled release this needs to point at a Tauri
/// resource path; that's a v2 concern.
fn sidecar_script_path() -> PathBuf {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    manifest_dir.join("../sidecar/index.ts")
}
