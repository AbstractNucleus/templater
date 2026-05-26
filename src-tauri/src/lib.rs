mod sidecar;
mod store;

use sidecar::{Diagnostics, Sidecar};
use std::collections::HashSet;
use std::str::FromStr;
use std::sync::Mutex;
use store::{AppData, BackupEntry, Store, Template, WindowGeometry, DATA_VERSION, DEFAULT_HOTKEY};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager, PhysicalPosition, PhysicalSize, WindowEvent,
};
#[cfg(desktop)]
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};

#[cfg(desktop)]
struct CurrentHotkey(Mutex<Shortcut>);

/// Second optional global hotkey for the quick-capture flow. None = disabled.
#[cfg(desktop)]
struct CaptureHotkey(Mutex<Option<Shortcut>>);

#[tauri::command]
async fn ping_sidecar(state: tauri::State<'_, Sidecar>) -> Result<serde_json::Value, String> {
    state
        .request(&serde_json::json!({ "id": "ping-1", "op": "ping" }))
        .await
}

#[tauri::command]
async fn rank_templates(
    pasted: String,
    catalog: Vec<Template>,
    backend: String,
    state: tauri::State<'_, Sidecar>,
) -> Result<serde_json::Value, String> {
    state
        .request(&serde_json::json!({
            "id": "rank",
            "op": "rank",
            "pasted": pasted,
            "catalog": catalog,
            "backend": backend,
        }))
        .await
}

#[tauri::command]
async fn edit_template(
    draft: serde_json::Value,
    history: serde_json::Value,
    prompt: String,
    backend: String,
    state: tauri::State<'_, Sidecar>,
) -> Result<serde_json::Value, String> {
    state
        .request(&serde_json::json!({
            "id": "edit-template",
            "op": "edit-template",
            "draft": draft,
            "history": history,
            "prompt": prompt,
            "backend": backend,
        }))
        .await
}

#[tauri::command]
async fn adapt_template(
    draft: serde_json::Value,
    inbound: String,
    backend: String,
    state: tauri::State<'_, Sidecar>,
) -> Result<serde_json::Value, String> {
    state
        .request(&serde_json::json!({
            "id": "adapt-template",
            "op": "adapt-template",
            "draft": draft,
            "inbound": inbound,
            "backend": backend,
        }))
        .await
}

#[tauri::command]
async fn context_set_sources(
    sources: Vec<String>,
    backend: String,
    state: tauri::State<'_, Sidecar>,
) -> Result<serde_json::Value, String> {
    state
        .request(&serde_json::json!({
            "id": "context-set-sources",
            "op": "context-set-sources",
            "sources": sources,
            "backend": backend,
        }))
        .await
}

#[tauri::command]
async fn context_status(
    state: tauri::State<'_, Sidecar>,
) -> Result<serde_json::Value, String> {
    state
        .request(&serde_json::json!({ "id": "context-status", "op": "context-status" }))
        .await
}

#[tauri::command]
async fn context_list_files(
    source: Option<String>,
    state: tauri::State<'_, Sidecar>,
) -> Result<serde_json::Value, String> {
    state
        .request(&serde_json::json!({
            "id": "context-list-files",
            "op": "context-list-files",
            "source": source,
        }))
        .await
}

#[tauri::command]
async fn context_rescan(
    source: Option<String>,
    state: tauri::State<'_, Sidecar>,
) -> Result<serde_json::Value, String> {
    state
        .request(&serde_json::json!({
            "id": "context-rescan",
            "op": "context-rescan",
            "source": source,
        }))
        .await
}

#[tauri::command]
async fn context_read_file(
    path: String,
    state: tauri::State<'_, Sidecar>,
) -> Result<serde_json::Value, String> {
    state
        .request(&serde_json::json!({
            "id": "context-read-file",
            "op": "context-read-file",
            "path": path,
        }))
        .await
}

#[tauri::command]
async fn context_search(
    query: String,
    limit: Option<u32>,
    state: tauri::State<'_, Sidecar>,
) -> Result<serde_json::Value, String> {
    state
        .request(&serde_json::json!({
            "id": "context-search",
            "op": "context-search",
            "query": query,
            "limit": limit,
        }))
        .await
}

#[tauri::command]
async fn context_capture_memory(
    raw: String,
    source: String,
    filename: Option<String>,
    backend: String,
    state: tauri::State<'_, Sidecar>,
) -> Result<serde_json::Value, String> {
    state
        .request(&serde_json::json!({
            "id": "context-capture-memory",
            "op": "context-capture-memory",
            "raw": raw,
            "source": source,
            "filename": filename,
            "backend": backend,
        }))
        .await
}

#[tauri::command]
fn get_sidecar_diagnostics(state: tauri::State<'_, Sidecar>) -> Diagnostics {
    state.diagnostics()
}

/// Spawn `claude login` in a new terminal window. The user completes the
/// device-flow in the terminal; on success the Agent SDK picks up the new
/// session on its next call (no app restart needed). We don't try to capture
/// or report progress — the terminal is the source of truth, and forcing
/// users into a hidden subprocess hides the auth code prompt.
#[tauri::command]
fn open_claude_login() -> Result<(), String> {
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

#[tauri::command]
fn load_app_data(store: tauri::State<'_, Store>) -> Result<Option<AppData>, String> {
    store.load()
}

#[tauri::command]
fn save_app_data(data: AppData, store: tauri::State<'_, Store>) -> Result<(), String> {
    store.save(&data)
}

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
struct ImportResult {
    added: usize,
    skipped: usize,
    templates: Vec<Template>,
}

#[tauri::command]
fn export_templates(path: String, store: tauri::State<'_, Store>) -> Result<usize, String> {
    let data = store
        .load()?
        .unwrap_or_else(|| AppData::new(Vec::new()));
    let count = data.templates.len();
    let file = ExportFile {
        version: DATA_VERSION,
        templates: data.templates,
    };
    let json = serde_json::to_string_pretty(&file).map_err(|e| e.to_string())?;
    std::fs::write(&path, json).map_err(|e| format!("write {path}: {e}"))?;
    Ok(count)
}

#[tauri::command]
fn export_template(
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
    let file = ExportFile {
        version: DATA_VERSION,
        templates: vec![tpl],
    };
    let json = serde_json::to_string_pretty(&file).map_err(|e| e.to_string())?;
    std::fs::write(&path, json).map_err(|e| format!("write {path}: {e}"))?;
    Ok(())
}

#[tauri::command]
fn export_templates_subset(
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
    let count = subset.len();
    let file = ExportFile {
        version: DATA_VERSION,
        templates: subset,
    };
    let json = serde_json::to_string_pretty(&file).map_err(|e| e.to_string())?;
    std::fs::write(&path, json).map_err(|e| format!("write {path}: {e}"))?;
    Ok(count)
}

#[tauri::command]
fn import_templates(
    path: String,
    store: tauri::State<'_, Store>,
) -> Result<ImportResult, String> {
    let text = std::fs::read_to_string(&path).map_err(|e| format!("read {path}: {e}"))?;
    let file: ImportFile = serde_json::from_str(&text)
        .or_else(|_| {
            // Tolerate the bare-array shape: [Template, ...]
            serde_json::from_str::<Vec<Template>>(&text).map(|templates| ImportFile { templates })
        })
        .map_err(|e| format!("not a valid templates export: {e}"))?;

    let mut data = store
        .load()?
        .unwrap_or_else(|| AppData::new(Vec::new()));
    let existing: HashSet<String> = data.templates.iter().map(|t| t.id.clone()).collect();

    let mut additions: Vec<Template> = Vec::new();
    let mut skipped = 0usize;
    for tpl in file.templates {
        if existing.contains(&tpl.id) {
            skipped += 1;
        } else {
            additions.push(tpl);
        }
    }
    let added = additions.len();

    // Prepend in file order so the imported chunk lands at the top and keeps
    // its internal ordering. tail = existing.
    additions.extend(data.templates.into_iter());
    data.templates = additions;

    store.save(&data)?;
    Ok(ImportResult {
        added,
        skipped,
        templates: data.templates,
    })
}

#[derive(serde::Serialize)]
struct EnvWarnings {
    api_key_override: bool,
}

#[tauri::command]
fn get_env_warnings() -> EnvWarnings {
    EnvWarnings {
        api_key_override: std::env::var_os("ANTHROPIC_API_KEY").is_some(),
    }
}

#[tauri::command]
fn list_template_backups(store: tauri::State<'_, Store>) -> Result<Vec<BackupEntry>, String> {
    store.list_template_backups()
}

#[tauri::command]
fn restore_template_backup(
    name: String,
    store: tauri::State<'_, Store>,
) -> Result<AppData, String> {
    store.restore_template_backup(&name)
}

#[tauri::command]
fn open_data_dir(app: tauri::AppHandle) -> Result<(), String> {
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
fn open_path(path: String, app: tauri::AppHandle) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    app.opener()
        .open_path(path, None::<&str>)
        .map_err(|e| format!("open: {e}"))
}

#[tauri::command]
fn reset_window_position(
    app: tauri::AppHandle,
    store: tauri::State<'_, Store>,
) -> Result<(), String> {
    // Center the live window so the close-time geometry save (which we can't
    // suppress without piling on flags) captures the centered position rather
    // than the user's pre-reset coordinates.
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.set_size(PhysicalSize::new(800u32, 600u32));
        let _ = window.center();
    }
    // Clear the persisted geometry too — both the in-memory webview and the
    // settings file now agree the position is unset.
    if let Ok(Some(mut data)) = store.load() {
        data.settings.window_geometry = None;
        store.save(&data)?;
    }
    Ok(())
}

#[cfg(desktop)]
#[tauri::command]
fn set_hotkey(
    accelerator: String,
    app: tauri::AppHandle,
    current: tauri::State<'_, CurrentHotkey>,
) -> Result<(), String> {
    let new_shortcut = Shortcut::from_str(&accelerator)
        .map_err(|e| format!("invalid hotkey \"{accelerator}\": {e}"))?;
    let mut guard = current.0.lock().map_err(|e| e.to_string())?;
    if new_shortcut == *guard {
        return Ok(());
    }
    let gs = app.global_shortcut();
    // Register the new chord BEFORE unregistering the old one: if the new
    // chord is rejected (taken by another app, OS-reserved) the user keeps a
    // working hotkey instead of being left with none until restart.
    gs.register(new_shortcut)
        .map_err(|e| format!("failed to register hotkey: {e}"))?;
    let _ = gs.unregister(*guard);
    *guard = new_shortcut;
    Ok(())
}

#[cfg(not(desktop))]
#[tauri::command]
fn set_hotkey(_accelerator: String) -> Result<(), String> {
    Err("global shortcuts not available on this platform".to_string())
}

#[cfg(desktop)]
#[tauri::command]
fn set_quick_capture_hotkey(
    accelerator: Option<String>,
    app: tauri::AppHandle,
    current: tauri::State<'_, CaptureHotkey>,
) -> Result<(), String> {
    let mut guard = current.0.lock().map_err(|e| e.to_string())?;
    let gs = app.global_shortcut();
    let next: Option<Shortcut> = match accelerator.as_deref() {
        None | Some("") => None,
        Some(a) => Some(
            Shortcut::from_str(a).map_err(|e| format!("invalid hotkey \"{a}\": {e}"))?,
        ),
    };
    if next == *guard {
        return Ok(());
    }
    // Register-before-unregister, same rationale as set_hotkey above.
    if let Some(s) = next {
        gs.register(s)
            .map_err(|e| format!("failed to register quick-capture hotkey: {e}"))?;
    }
    if let Some(prev) = *guard {
        let _ = gs.unregister(prev);
    }
    *guard = next;
    Ok(())
}

#[cfg(not(desktop))]
#[tauri::command]
fn set_quick_capture_hotkey(_accelerator: Option<String>) -> Result<(), String> {
    Err("global shortcuts not available on this platform".to_string())
}

/// Returns true if the saved top-left corner falls inside any connected monitor.
/// Used to discard stale geometry when monitor configuration has changed.
fn geometry_on_some_monitor(window: &tauri::WebviewWindow, geo: &WindowGeometry) -> bool {
    let Ok(monitors) = window.available_monitors() else {
        return true; // be permissive when we can't enumerate
    };
    monitors.iter().any(|m| {
        let p = m.position();
        let s = m.size();
        geo.x >= p.x
            && geo.y >= p.y
            && geo.x < p.x + s.width as i32
            && geo.y < p.y + s.height as i32
    })
}

/// Read the main window's current outer geometry and persist it into settings.
/// Skipped if the window is hidden — `outer_position` then reflects the
/// last-visible state, which we don't want to overwrite.
fn save_window_geometry(app: &tauri::AppHandle) {
    let Some(window) = app.get_webview_window("main") else { return };
    if !window.is_visible().unwrap_or(false) {
        return;
    }
    // Minimized windows on Windows report outer_position around (-32000, -32000) —
    // saving that loses the user's real geometry on next launch.
    if window.is_minimized().unwrap_or(false) {
        return;
    }
    let (Ok(pos), Ok(size)) = (window.outer_position(), window.outer_size()) else {
        return;
    };
    let store = app.state::<Store>();
    let Ok(Some(mut data)) = store.load() else { return };
    data.settings.window_geometry = Some(WindowGeometry {
        x: pos.x,
        y: pos.y,
        width: size.width,
        height: size.height,
    });
    let _ = store.save(&data);
}

fn toggle_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let visible = window.is_visible().unwrap_or(false);
        if visible {
            save_window_geometry(app);
            let _ = window.hide();
        } else {
            let _ = window.show();
            let _ = window.set_focus();
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init());

    #[cfg(desktop)]
    {
        use tauri_plugin_global_shortcut::ShortcutState;

        // We register up to two shortcuts: the window toggle and an optional
        // quick-capture. Compare the fired shortcut against the live state
        // values to decide which flow to run.
        builder = builder.plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(move |app, shortcut, event| {
                    if event.state() != ShortcutState::Pressed {
                        return;
                    }
                    let capture_match = app
                        .try_state::<CaptureHotkey>()
                        .and_then(|c| c.0.lock().ok().and_then(|g| *g))
                        .map(|s| s == *shortcut)
                        .unwrap_or(false);
                    if capture_match {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                        let _ = app.emit("quick-capture", ());
                        return;
                    }
                    toggle_main_window(app);
                })
                .build(),
        );
    }

    builder
        .setup(|app| {
            let dir = app
                .path()
                .app_data_dir()
                .map_err(|e| -> Box<dyn std::error::Error> { format!("app_data_dir: {e}").into() })?;
            std::fs::create_dir_all(&dir).map_err(|e| -> Box<dyn std::error::Error> {
                format!("mkdir {}: {e}", dir.display()).into()
            })?;

            // Sidecar needs the data dir so it can place context.db next to
            // templates.json / settings.json.
            app.manage(Sidecar::start(&app.handle(), dir.clone()));

            let store = Store::new(dir.join("templates.json"), dir.join("settings.json"));

            let loaded_settings = store.load().ok().flatten().map(|d| d.settings);
            let start_minimised = loaded_settings
                .as_ref()
                .map(|s| s.start_minimised_to_tray)
                .unwrap_or(false);

            if let Some(window) = app.get_webview_window("main") {
                if let Some(settings) = &loaded_settings {
                    if let Some(geo) = &settings.window_geometry {
                        if geometry_on_some_monitor(&window, geo) {
                            let _ = window.set_position(PhysicalPosition::new(geo.x, geo.y));
                            let _ = window.set_size(PhysicalSize::new(geo.width, geo.height));
                        }
                    }
                    if settings.always_on_top_default {
                        let _ = window.set_always_on_top(true);
                    }
                }
                if !start_minimised {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
            app.manage(store);

            // Push the persisted source list to the sidecar so the watcher
            // and SQLite index come up before the user touches anything.
            // Skipped when no sources are configured — keeps the sidecar
            // lazy so a browse-and-copy session never spawns the Node
            // process. Non-blocking when it does run: ingest summaries
            // happen in the background.
            if let Some(settings) = &loaded_settings {
                if !settings.context_sources.is_empty() {
                    let sources = settings.context_sources.clone();
                    let backend = if settings.paste_backend.is_empty() {
                        "agent".to_string()
                    } else {
                        settings.paste_backend.clone()
                    };
                    let handle = app.handle().clone();
                    tauri::async_runtime::spawn(async move {
                        let sidecar = handle.state::<Sidecar>();
                        if let Err(e) = sidecar
                            .request(&serde_json::json!({
                                "id": "context-init",
                                "op": "context-set-sources",
                                "sources": sources,
                                "backend": backend,
                            }))
                            .await
                        {
                            eprintln!("initial context source sync failed: {e}");
                        }
                    });
                }
            }

            #[cfg(desktop)]
            {
                let raw = loaded_settings
                    .as_ref()
                    .map(|s| s.global_hotkey.clone())
                    .unwrap_or_else(|| DEFAULT_HOTKEY.to_string());
                let shortcut = Shortcut::from_str(&raw).unwrap_or_else(|_| {
                    Shortcut::from_str(DEFAULT_HOTKEY).expect("default hotkey parses")
                });
                // Log + continue on register failure rather than aborting setup —
                // an OS-level conflict on the persisted chord would otherwise lock
                // the user out of their own app (can't open Settings to rebind).
                if let Err(e) = app.global_shortcut().register(shortcut) {
                    eprintln!("global hotkey {raw} unavailable: {e}");
                }
                app.manage(CurrentHotkey(Mutex::new(shortcut)));

                let capture_shortcut: Option<Shortcut> = loaded_settings
                    .as_ref()
                    .and_then(|s| s.quick_capture_hotkey.as_deref())
                    .filter(|s| !s.is_empty())
                    .and_then(|s| Shortcut::from_str(s).ok());
                if let Some(sc) = capture_shortcut {
                    if let Err(e) = app.global_shortcut().register(sc) {
                        eprintln!("quick-capture hotkey unavailable: {e}");
                    }
                }
                app.manage(CaptureHotkey(Mutex::new(capture_shortcut)));
            }

            let show_item = MenuItem::with_id(app, "show", "Show", true, None::<&str>)?;
            let settings_item = MenuItem::with_id(app, "settings", "Settings", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_item, &settings_item, &quit_item])?;

            let icon = app
                .default_window_icon()
                .ok_or("missing default window icon")?
                .clone();

            TrayIconBuilder::with_id("main-tray")
                .icon(icon)
                .tooltip("Templater")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        // Menu items do what the label says — only the
                        // left-click tray icon toggles visibility.
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    "settings" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                        let _ = app.emit("open-settings", ());
                    }
                    "quit" => {
                        save_window_geometry(app);
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        toggle_main_window(tray.app_handle());
                    }
                })
                .build(app)?;

            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
                    save_window_geometry(&window.app_handle());
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            ping_sidecar,
            rank_templates,
            edit_template,
            adapt_template,
            get_sidecar_diagnostics,
            open_claude_login,
            load_app_data,
            save_app_data,
            export_templates,
            export_template,
            export_templates_subset,
            import_templates,
            list_template_backups,
            restore_template_backup,
            get_env_warnings,
            set_hotkey,
            set_quick_capture_hotkey,
            open_data_dir,
            open_path,
            reset_window_position,
            context_set_sources,
            context_status,
            context_list_files,
            context_rescan,
            context_read_file,
            context_search,
            context_capture_memory,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
