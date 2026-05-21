mod sidecar;
mod store;

use sidecar::Sidecar;
use std::collections::HashSet;
use std::str::FromStr;
use std::sync::Mutex;
use store::{AppData, Store, Template, WindowGeometry, DATA_VERSION, DEFAULT_HOTKEY};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager, PhysicalPosition, PhysicalSize, WindowEvent,
};
#[cfg(desktop)]
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};

#[cfg(desktop)]
struct CurrentHotkey(Mutex<Shortcut>);

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
    state: tauri::State<'_, Sidecar>,
) -> Result<serde_json::Value, String> {
    state
        .request(&serde_json::json!({
            "id": "rank",
            "op": "rank",
            "pasted": pasted,
            "catalog": catalog,
        }))
        .await
}

#[tauri::command]
async fn edit_template(
    draft: serde_json::Value,
    history: serde_json::Value,
    prompt: String,
    state: tauri::State<'_, Sidecar>,
) -> Result<serde_json::Value, String> {
    state
        .request(&serde_json::json!({
            "id": "edit-template",
            "op": "edit-template",
            "draft": draft,
            "history": history,
            "prompt": prompt,
        }))
        .await
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
    let _ = gs.unregister(*guard);
    gs.register(new_shortcut)
        .map_err(|e| format!("failed to register hotkey: {e}"))?;
    *guard = new_shortcut;
    Ok(())
}

#[cfg(not(desktop))]
#[tauri::command]
fn set_hotkey(_accelerator: String) -> Result<(), String> {
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

        // The handler fires only for registered shortcuts, and we only ever
        // register one (the toggle). So no per-shortcut comparison needed —
        // any press is the toggle.
        builder = builder.plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(move |app, _shortcut, event| {
                    if event.state() == ShortcutState::Pressed {
                        toggle_main_window(app);
                    }
                })
                .build(),
        );
    }

    builder
        .setup(|app| {
            app.manage(Sidecar::start(&app.handle()));

            let dir = app
                .path()
                .app_data_dir()
                .map_err(|e| -> Box<dyn std::error::Error> { format!("app_data_dir: {e}").into() })?;
            std::fs::create_dir_all(&dir).map_err(|e| -> Box<dyn std::error::Error> {
                format!("mkdir {}: {e}", dir.display()).into()
            })?;
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

            #[cfg(desktop)]
            {
                let raw = loaded_settings
                    .as_ref()
                    .map(|s| s.global_hotkey.clone())
                    .unwrap_or_else(|| DEFAULT_HOTKEY.to_string());
                let shortcut = Shortcut::from_str(&raw).unwrap_or_else(|_| {
                    Shortcut::from_str(DEFAULT_HOTKEY).expect("default hotkey parses")
                });
                app.global_shortcut().register(shortcut)?;
                app.manage(CurrentHotkey(Mutex::new(shortcut)));
            }

            let show_item = MenuItem::with_id(app, "show", "Show", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_item, &quit_item])?;

            let icon = app
                .default_window_icon()
                .ok_or("missing default window icon")?
                .clone();

            TrayIconBuilder::with_id("main-tray")
                .icon(icon)
                .tooltip("templates-widget")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => toggle_main_window(app),
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
            load_app_data,
            save_app_data,
            export_templates,
            export_template,
            import_templates,
            get_env_warnings,
            set_hotkey,
            open_data_dir,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
