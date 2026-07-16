mod commands;
mod hotkey;
mod store;
mod tray;
mod windows_snap;

use store::{Store, WindowGeometry};
use tauri::{Emitter, Manager, PhysicalPosition, PhysicalSize, WindowEvent};

use commands::data::{
    bulk_add_template_tag, bulk_delete_templates, bulk_remove_template_tag, export_template,
    export_templates, export_templates_subset, import_templates, list_template_backups,
    load_app_data, open_data_dir, open_path, restore_template_backup, save_app_data,
};
use hotkey::set_hotkey;

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

/// Gap (logical px) between the main window's left edge and the preview window's
/// right edge when parked to the left.
const PREVIEW_GAP: i32 = 12;
/// Default preview window width (logical px) when the main window is too narrow
/// to derive a sensible mirrored width.
const PREVIEW_DEFAULT_WIDTH: u32 = 460;

/// Show the preview window parked to the left of the main window. If the
/// preview window is already visible, this is a no-op (selection updates are
/// delivered via events from the frontend, not by re-opening the window).
#[tauri::command]
fn open_preview_window(app: tauri::AppHandle) -> Result<(), String> {
    let Some(main) = app.get_webview_window("main") else {
        return Err("main window not found".into());
    };
    let preview = app
        .get_webview_window("preview")
        .ok_or_else(|| "preview window not found".to_string())?;

    let (Ok(main_pos), Ok(main_size)) = (main.outer_position(), main.outer_size()) else {
        // Best-effort: just show it without repositioning.
        let _ = preview.show();
        let _ = preview.set_focus();
        return Ok(());
    };

    let preview_w = PREVIEW_DEFAULT_WIDTH;
    // Park to the left of the main window, top-aligned with it.
    let x = main_pos.x - preview_w as i32 - PREVIEW_GAP;
    let y = main_pos.y;
    // Clamp: if the derived x would be off the left edge of the screen, just
    // butt the preview against the main window's left side and let the OS clip.
    let clamped_x = if x < 0 { 0 } else { x };

    let _ = preview.set_size(PhysicalSize::new(preview_w, main_size.height));
    let _ = preview.set_position(PhysicalPosition::new(clamped_x, y));
    let _ = preview.show();
    let _ = preview.set_focus();
    Ok(())
}

/// Hide the preview window.
#[tauri::command]
fn close_preview_window(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(preview) = app.get_webview_window("preview") {
        let _ = preview.hide();
    }
    Ok(())
}

/// Returns true if the preview window currently exists and is visible.
#[tauri::command]
fn is_preview_open(app: tauri::AppHandle) -> bool {
    app.get_webview_window("preview")
        .and_then(|w| w.is_visible().ok())
        .unwrap_or(false)
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
pub(crate) fn save_window_geometry(app: &tauri::AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
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
    let Ok(Some(mut data)) = store.load() else {
        return;
    };
    data.settings.window_geometry = Some(WindowGeometry {
        x: pos.x,
        y: pos.y,
        width: size.width,
        height: size.height,
    });
    let _ = store.save(&data);
}

pub(crate) fn toggle_main_window(app: &tauri::AppHandle) {
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

        builder = builder.plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(move |app, _shortcut, event| {
                    if event.state() != ShortcutState::Pressed {
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
                windows_snap::install(&window);
            }
            app.manage(store);

            #[cfg(desktop)]
            hotkey::register_startup(app, loaded_settings.as_ref());

            tray::install(app)?;

            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
                    save_window_geometry(&window.app_handle());
                    api.prevent_close();
                    let _ = window.hide();
                } else if window.label() == "preview" {
                    // Don't destroy the preview window — just hide it so the
                    // main window's toggle state can be updated and re-show is cheap.
                    api.prevent_close();
                    let _ = window.hide();
                    let _ = window.app_handle().emit("preview-closed", ());
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            load_app_data,
            save_app_data,
            export_templates,
            export_template,
            export_templates_subset,
            bulk_delete_templates,
            bulk_add_template_tag,
            bulk_remove_template_tag,
            import_templates,
            list_template_backups,
            restore_template_backup,
            set_hotkey,
            open_data_dir,
            open_path,
            reset_window_position,
            open_preview_window,
            close_preview_window,
            is_preview_open,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}