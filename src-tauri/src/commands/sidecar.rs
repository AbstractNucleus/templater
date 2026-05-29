//! Thin `#[tauri::command]` passthroughs to the Node sidecar.
//!
//! Every command here builds a `{ "id", "op", ...named fields }` JSON request
//! and forwards it via [`Sidecar::request`], returning the raw response value.
//! The shapes are mechanical, so a `sidecar_command!` macro generates each fn
//! instead of hand-writing ~15 near-identical bodies. The macro maps each Rust
//! argument straight onto a JSON field of the same name — so the argument names
//! ARE the wire field names and must not be renamed (they're a contract with
//! both `src/lib/api.ts` and the sidecar protocol).

use crate::sidecar::{Diagnostics, Sidecar};

/// Generate a `#[tauri::command] async fn` that forwards a fixed `id`/`op` plus
/// the listed named arguments to the sidecar as JSON fields of the same name.
macro_rules! sidecar_command {
    (
        $(#[$meta:meta])*
        $name:ident, id = $id:literal, op = $op:literal
        $(, $arg:ident : $ty:ty )* $(,)?
    ) => {
        $(#[$meta])*
        #[tauri::command]
        pub async fn $name(
            $( $arg: $ty, )*
            state: tauri::State<'_, Sidecar>,
        ) -> Result<serde_json::Value, String> {
            state
                .request(&serde_json::json!({
                    "id": $id,
                    "op": $op,
                    $( stringify!($arg): $arg, )*
                }))
                .await
        }
    };
}

sidecar_command!(ping_sidecar, id = "ping-1", op = "ping");

sidecar_command!(
    rank_templates,
    id = "rank",
    op = "rank",
    pasted: String,
    catalog: Vec<crate::store::Template>,
    backend: String,
    model: String,
);

sidecar_command!(
    edit_template,
    id = "edit-template",
    op = "edit-template",
    draft: serde_json::Value,
    history: serde_json::Value,
    prompt: String,
    backend: String,
    model: String,
);

sidecar_command!(
    adapt_template,
    id = "adapt-template",
    op = "adapt-template",
    draft: serde_json::Value,
    inbound: String,
    backend: String,
    model: String,
);

sidecar_command!(
    context_set_sources,
    id = "context-set-sources",
    op = "context-set-sources",
    sources: Vec<String>,
    backend: String,
    model: String,
);

sidecar_command!(context_status, id = "context-status", op = "context-status");

sidecar_command!(
    context_list_files,
    id = "context-list-files",
    op = "context-list-files",
    source: Option<String>,
);

sidecar_command!(
    context_rescan,
    id = "context-rescan",
    op = "context-rescan",
    source: Option<String>,
);

sidecar_command!(
    context_read_file,
    id = "context-read-file",
    op = "context-read-file",
    path: String,
);

sidecar_command!(
    context_search,
    id = "context-search",
    op = "context-search",
    query: String,
    limit: Option<u32>,
);

sidecar_command!(
    context_capture_memory,
    id = "context-capture-memory",
    op = "context-capture-memory",
    raw: String,
    source: String,
    backend: String,
    model: String,
);

#[tauri::command]
pub fn get_sidecar_diagnostics(state: tauri::State<'_, Sidecar>) -> Diagnostics {
    state.diagnostics()
}
