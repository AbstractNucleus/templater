//! `#[tauri::command]` handlers, grouped by concern. Re-exported flat so
//! `lib.rs` can register them by their bare names in `generate_handler!`.

pub mod data;
pub mod sidecar;
