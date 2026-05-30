mod commands;
mod hotkey;
mod sidecar;
mod store;
mod tray;
mod windows_snap;

use sidecar::Sidecar;
use store::{Store, WindowGeometry};
use tauri::{Emitter, Manager, PhysicalPosition, PhysicalSize, WindowEvent};

use commands::data::{
    bulk_add_template_tag, bulk_delete_templates, bulk_remove_template_tag, export_template,
    export_templates, export_templates_subset, get_env_warnings, import_templates, list_template_backups,
    load_app_data, open_claude_login, open_data_dir, open_path, restore_template_backup,
    save_app_data,
};
use commands::sidecar::{
    adapt_template, context_capture_memory, context_list_files, context_read_file, context_rescan,
    context_search, context_set_sources, context_status, edit_template, get_sidecar_diagnostics,
    ping_sidecar, rank_templates,
};
use hotkey::{set_hotkey, set_quick_capture_hotkey};

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
                        .try_state::<hotkey::CaptureHotkey>()
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
                windows_snap::install(&window);
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
            bulk_delete_templates,
            bulk_add_template_tag,
            bulk_remove_template_tag,
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
