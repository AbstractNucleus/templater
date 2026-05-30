//! Data-layer and misc system `#[tauri::command]`s: load/save, templates
//! import/export, bulk edits, backups, and a few small OS shims (open paths,
//! launch `claude login`, report env warnings). The mutating template
//! commands route their read-modify-write-save through [`Store::mutate`].

use crate::store::{AppData, BackupEntry, Store, Template, TemplateVersion, DATA_VERSION};
use chrono::Utc;
use std::collections::{HashMap, HashSet};

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

#[derive(serde::Serialize)]
pub struct ImportResult {
    added: usize,
    overwritten: usize,
    skipped: usize,
    templates: Vec<Template>,
}

/// Mirror of `TEMPLATE_HISTORY_CAP` in `src/lib/types.ts`. Keep in sync.
const TEMPLATE_HISTORY_CAP: usize = 10;

/// Serialize `templates` as a versioned export file and write it to `path`.
/// Returns the number of templates written. Shared by all three export
/// commands, which differ only in how they select the template set.
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

#[tauri::command]
pub fn export_templates(path: String, store: tauri::State<'_, Store>) -> Result<usize, String> {
    let data = store.load()?.unwrap_or_else(|| AppData::new(Vec::new()));
    write_export(&path, data.templates)
}

#[tauri::command]
pub fn export_template(
    id: String,
    path: String,
    store: tauri::State<'_, Store>,
) -> Result<(), String> {
    let data = store
        .load()?
        .ok_or_else(|| "no templates file on disk".to_string())?;
    let tpl = data
        .templates
        .into_iter()
        .find(|t| t.id == id)
        .ok_or_else(|| format!("template {id} not found"))?;
    write_export(&path, vec![tpl])?;
    Ok(())
}

#[tauri::command]
pub fn export_templates_subset(
    ids: Vec<String>,
    path: String,
    store: tauri::State<'_, Store>,
) -> Result<usize, String> {
    let data = store
        .load()?
        .ok_or_else(|| "no templates file on disk".to_string())?;
    let want: HashSet<String> = ids.into_iter().collect();
    let subset: Vec<Template> = data
        .templates
        .into_iter()
        .filter(|t| want.contains(&t.id))
        .collect();
    write_export(&path, subset)
}

#[tauri::command]
pub fn bulk_delete_templates(
    ids: Vec<String>,
    store: tauri::State<'_, Store>,
) -> Result<Vec<Template>, String> {
    store.mutate(|data| {
        let want: HashSet<String> = ids.into_iter().collect();
        data.templates.retain(|t| !want.contains(&t.id));
        for id in &want {
            data.settings.placeholder_values.remove(id);
        }
        Ok(data.templates.clone())
    })
}

/// Add or remove `tag` across the templates named in `ids`. `add = true`
/// pushes the tag if absent; `add = false` retains everything but the tag.
/// Tag matching is case-insensitive; the stored form is trimmed + lowercased.
fn bulk_tag(
    ids: Vec<String>,
    tag: String,
    add: bool,
    store: &Store,
) -> Result<Vec<Template>, String> {
    let trimmed = tag.trim().to_lowercase();
    if trimmed.is_empty() {
        return Err("tag is empty".to_string());
    }
    store.mutate(|data| {
        let want: HashSet<String> = ids.into_iter().collect();
        for template in &mut data.templates {
            if !want.contains(&template.id) {
                continue;
            }
            if add {
                if !template
                    .tags
                    .iter()
                    .any(|existing| existing.eq_ignore_ascii_case(&trimmed))
                {
                    template.tags.push(trimmed.clone());
                }
            } else {
                template
                    .tags
                    .retain(|existing| !existing.eq_ignore_ascii_case(&trimmed));
            }
        }
        Ok(data.templates.clone())
    })
}

#[tauri::command]
pub fn bulk_add_template_tag(
    ids: Vec<String>,
    tag: String,
    store: tauri::State<'_, Store>,
) -> Result<Vec<Template>, String> {
    bulk_tag(ids, tag, true, &store)
}

#[tauri::command]
pub fn bulk_remove_template_tag(
    ids: Vec<String>,
    tag: String,
    store: tauri::State<'_, Store>,
) -> Result<Vec<Template>, String> {
    bulk_tag(ids, tag, false, &store)
}

#[tauri::command]
pub fn import_templates(
    path: String,
    overwrite: bool,
    store: tauri::State<'_, Store>,
) -> Result<ImportResult, String> {
    let text = std::fs::read_to_string(&path).map_err(|e| format!("read {path}: {e}"))?;
    let file: ImportFile = serde_json::from_str(&text)
        .or_else(|_| {
            // Tolerate the bare-array shape: [Template, ...]
            serde_json::from_str::<Vec<Template>>(&text).map(|templates| ImportFile { templates })
        })
        .map_err(|e| format!("not a valid templates export: {e}"))?;

    store.mutate(|data| {
        // id → index in data.templates, so we can mutate in place on overwrite.
        let index: HashMap<String, usize> = data
            .templates
            .iter()
            .enumerate()
            .map(|(i, t)| (t.id.clone(), i))
            .collect();

        let now = Utc::now().to_rfc3339();
        let mut additions: Vec<Template> = Vec::new();
        let mut overwritten = 0usize;
        let mut skipped = 0usize;

        for tpl in file.templates {
            match index.get(&tpl.id).copied() {
                Some(_) if !overwrite => skipped += 1,
                Some(i) => {
                    let local = &mut data.templates[i];
                    // Snapshot the pre-overwrite local content so the existing
                    // Revert UI can recover it. Mirrors `pushHistorySnapshot` in
                    // `templatesStore.svelte.ts`.
                    local.history.push(TemplateVersion {
                        saved_at: now.clone(),
                        opening: local.opening.clone(),
                        body: local.body.clone(),
                        tags: local.tags.clone(),
                    });
                    let len = local.history.len();
                    if len > TEMPLATE_HISTORY_CAP {
                        local.history.drain(0..len - TEMPLATE_HISTORY_CAP);
                    }
                    // Replace content; keep id, pinned, copy_count, last_used_at,
                    // created_at so the user's usage stats and ownership history
                    // survive the overwrite.
                    local.name = tpl.name;
                    local.tags = tpl.tags;
                    local.folder = tpl.folder;
                    local.opening = tpl.opening;
                    local.body = tpl.body;
                    local.updated_at = now.clone();
                    overwritten += 1;
                }
                None => additions.push(tpl),
            }
        }
        let added = additions.len();

        // Prepend new additions in file order so the imported chunk lands at the
        // top and keeps its internal ordering. Overwrites stayed in place above.
        additions.append(&mut data.templates);
        data.templates = additions;

        Ok(ImportResult {
            added,
            overwritten,
            skipped,
            templates: data.templates.clone(),
        })
    })
}

#[derive(serde::Serialize)]
pub struct EnvWarnings {
    api_key_override: bool,
}

#[tauri::command]
pub fn get_env_warnings() -> EnvWarnings {
    EnvWarnings {
        api_key_override: std::env::var_os("ANTHROPIC_API_KEY").is_some(),
    }
}

#[tauri::command]
pub fn list_template_backups(store: tauri::State<'_, Store>) -> Result<Vec<BackupEntry>, String> {
    store.list_template_backups()
}

#[tauri::command]
pub fn restore_template_backup(
    name: String,
    store: tauri::State<'_, Store>,
) -> Result<AppData, String> {
    store.restore_template_backup(&name)
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

/// Spawn `claude login` in a new terminal window. The user completes the
/// device-flow in the terminal; on success the Agent SDK picks up the new
/// session on its next call (no app restart needed). We don't try to capture
/// or report progress — the terminal is the source of truth, and forcing
/// users into a hidden subprocess hides the auth code prompt.
#[tauri::command]
pub fn open_claude_login() -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        // `cmd /c start "" cmd /k claude login` opens a new console window
        // that stays open after `claude login` exits so the user can read
        // any error output.
        std::process::Command::new("cmd")
            .args(["/c", "start", "", "cmd", "/k", "claude", "login"])
            .spawn()
            .map_err(|e| format!("spawn cmd: {e}"))?;
        return Ok(());
    }
    #[cfg(target_os = "macos")]
    {
        // AppleScript opens Terminal.app and runs the command inside a fresh tab.
        std::process::Command::new("osascript")
            .args([
                "-e",
                "tell application \"Terminal\" to do script \"claude login\"",
                "-e",
                "tell application \"Terminal\" to activate",
            ])
            .spawn()
            .map_err(|e| format!("spawn osascript: {e}"))?;
        return Ok(());
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        Err("claude login launcher not implemented for this platform".to_string())
    }
}
