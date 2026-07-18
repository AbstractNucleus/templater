//! Data-layer and misc system `#[tauri::command]`s: load/save, templates
//! import/export (file I/O only), backups, and a few small OS shims (open paths).
//! Template mutations live in the frontend store and persist via [`save_app_data`].

use crate::error::{cmd_err, AppError};
use crate::store::{
    commit_temp_file, parse_templates_json, prepare_temp_file, AppData, BackupEntry, LoadOutcome,
    Store, Template, DATA_VERSION,
};
use std::path::Path;

/// Templates-only export file. Settings are intentionally excluded — they're
/// machine-specific (window geometry, hotkey, theme) and exporting them would
/// pollute the import target.
#[derive(serde::Serialize)]
struct ExportFile<'a> {
    version: u32,
    templates: &'a [Template],
}

/// Serialize `templates` as a versioned export file and write it atomically.
/// Returns the number of templates written. Caller supplies the in-memory set
/// (TS is write-authority; do not reload from disk here).
fn write_export(path: &str, templates: &[Template]) -> Result<usize, String> {
    let path = Path::new(path);
    let count = templates.len();
    let tmp = prepare_temp_file(path, |w| {
        let file = ExportFile {
            version: DATA_VERSION,
            templates,
        };
        serde_json::to_writer_pretty(w, &file).map_err(|e| e.to_string())
    })
    .map_err(cmd_err)?;
    commit_temp_file(&tmp, path).map_err(cmd_err)?;
    Ok(count)
}

#[tauri::command]
pub fn load_app_data(store: tauri::State<'_, Store>) -> Result<LoadOutcome, String> {
    store.load().map_err(cmd_err)
}

#[tauri::command]
pub fn save_app_data(data: AppData, store: tauri::State<'_, Store>) -> Result<(), String> {
    store.save(&data).map_err(cmd_err)
}

/// Clear a fail-closed corrupt-settings lock by writing `Settings::default()`.
#[tauri::command]
pub fn reset_corrupt_settings(store: tauri::State<'_, Store>) -> Result<(), String> {
    store.reset_corrupt_settings().map_err(cmd_err)
}

/// Write `templates` to an export file at `path`. Templates come from the
/// frontend store — not from a disk reload — so export matches memory.
#[tauri::command]
pub fn export_templates(path: String, templates: Vec<Template>) -> Result<usize, String> {
    write_export(&path, &templates)
}

/// Read and parse a templates export file. Does not touch app data — the
/// frontend merges and persists via [`save_app_data`].
#[tauri::command]
pub fn read_templates_export(path: String) -> Result<Vec<Template>, String> {
    let text = std::fs::read_to_string(&path)
        .map_err(|e| cmd_err(AppError::msg(format!("read {path}: {e}"))))?;
    Ok(parse_templates_json(&text)
        .map_err(|e| cmd_err(AppError::msg(format!("not a valid templates export: {e}"))))?
        .templates)
}

#[tauri::command]
pub fn list_template_backups(store: tauri::State<'_, Store>) -> Result<Vec<BackupEntry>, String> {
    store.list_template_backups().map_err(cmd_err)
}

/// Read templates from a named backup. Does not write — the frontend persists
/// via [`save_app_data`] (mirrors import).
#[tauri::command]
pub fn read_template_backup(
    name: String,
    store: tauri::State<'_, Store>,
) -> Result<Vec<Template>, String> {
    store.read_template_backup(&name).map_err(cmd_err)
}

#[tauri::command]
pub fn open_data_dir(app: tauri::AppHandle) -> Result<(), String> {
    use tauri::Manager;
    use tauri_plugin_opener::OpenerExt;
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| cmd_err(AppError::msg(format!("app_data_dir: {e}"))))?;
    app.opener()
        .open_path(dir.to_string_lossy(), None::<&str>)
        .map_err(|e| cmd_err(AppError::msg(format!("open: {e}"))))
}

#[tauri::command]
pub fn open_path(path: String, app: tauri::AppHandle) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    app.opener()
        .open_path(path, None::<&str>)
        .map_err(|e| cmd_err(AppError::msg(format!("open: {e}"))))
}
