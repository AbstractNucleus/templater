//! Data-layer and misc system `#[tauri::command]`s: load/save, templates
//! import/export (file I/O only), backups, and a few small OS shims (open paths).
//! Template mutations live in the frontend store and persist via [`save_app_data`].

use crate::store::{AppData, BackupEntry, Store, Template, DATA_VERSION};

/// Templates-only export file. Settings are intentionally excluded — they're
/// machine-specific (window geometry, hotkey, theme) and exporting them would
/// pollute the import target.
#[derive(serde::Serialize)]
struct ExportFile {
    version: u32,
    templates: Vec<Template>,
}

/// Permissive import shape: only `templates` is required; an export from this
/// app, a full AppData backup, or any other JSON object that carries a
/// `templates` array will all parse.
#[derive(serde::Deserialize)]
struct ImportFile {
    templates: Vec<Template>,
}

/// Serialize `templates` as a versioned export file and write it to `path`.
/// Returns the number of templates written. Caller supplies the in-memory set
/// (TS is write-authority; do not reload from disk here).
fn write_export(path: &str, templates: Vec<Template>) -> Result<usize, String> {
    let count = templates.len();
    let file = ExportFile {
        version: DATA_VERSION,
        templates,
    };
    let json = serde_json::to_string_pretty(&file).map_err(|e| e.to_string())?;
    std::fs::write(path, json).map_err(|e| format!("write {path}: {e}"))?;
    Ok(count)
}

#[tauri::command]
pub fn load_app_data(store: tauri::State<'_, Store>) -> Result<Option<AppData>, String> {
    store.load()
}

#[tauri::command]
pub fn save_app_data(data: AppData, store: tauri::State<'_, Store>) -> Result<(), String> {
    store.save(&data)
}

/// Write `templates` to an export file at `path`. Templates come from the
/// frontend store — not from a disk reload — so export matches memory.
#[tauri::command]
pub fn export_templates(path: String, templates: Vec<Template>) -> Result<usize, String> {
    write_export(&path, templates)
}

/// Read and parse a templates export file. Does not touch app data — the
/// frontend merges and persists via [`save_app_data`].
#[tauri::command]
pub fn read_templates_export(path: String) -> Result<Vec<Template>, String> {
    let text = std::fs::read_to_string(&path).map_err(|e| format!("read {path}: {e}"))?;
    let file: ImportFile = serde_json::from_str(&text)
        .or_else(|_| {
            // Tolerate the bare-array shape: [Template, ...]
            serde_json::from_str::<Vec<Template>>(&text).map(|templates| ImportFile { templates })
        })
        .map_err(|e| format!("not a valid templates export: {e}"))?;
    Ok(file.templates)
}

#[tauri::command]
pub fn list_template_backups(store: tauri::State<'_, Store>) -> Result<Vec<BackupEntry>, String> {
    store.list_template_backups()
}

/// Read templates from a named backup. Does not write — the frontend persists
/// via [`save_app_data`] (mirrors import).
#[tauri::command]
pub fn read_template_backup(
    name: String,
    store: tauri::State<'_, Store>,
) -> Result<Vec<Template>, String> {
    store.read_template_backup(&name)
}

#[tauri::command]
pub fn open_data_dir(app: tauri::AppHandle) -> Result<(), String> {
    use tauri::Manager;
    use tauri_plugin_opener::OpenerExt;
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir: {e}"))?;
    app.opener()
        .open_path(dir.to_string_lossy(), None::<&str>)
        .map_err(|e| format!("open: {e}"))
}

#[tauri::command]
pub fn open_path(path: String, app: tauri::AppHandle) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    app.opener()
        .open_path(path, None::<&str>)
        .map_err(|e| format!("open: {e}"))
}
