mod commands;
mod error;
mod hotkey;
mod store;
mod tray;
mod windows;
mod windows_snap;

use store::{LoadOutcome, Store};
use tauri::{Manager, WindowEvent};
use windows::{
    configure_main_on_startup, is_satellite, on_close_requested, reset_window_position,
    set_satellite, toggle_main_window,
};

use commands::data::{
    export_templates, list_template_backups, load_app_data, open_data_dir, open_path,
    read_template_backup, read_templates_export, reset_corrupt_settings, save_app_data,
};
use commands::translate::translate_text;
use hotkey::set_hotkey;

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

            let loaded_settings = match store.load() {
                Ok(LoadOutcome::Ready { data }) => Some(data.settings),
                _ => None,
            };
            let start_minimised = loaded_settings
                .as_ref()
                .map(|s| s.start_minimised_to_tray)
                .unwrap_or(false);

            if let Some(window) = app.get_webview_window("main") {
                configure_main_on_startup(&window, loaded_settings.as_ref(), start_minimised);
            }
            app.manage(store);

            #[cfg(desktop)]
            hotkey::register_startup(app, loaded_settings.as_ref());

            tray::install(app)?;

            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                if on_close_requested(&window.app_handle(), window.label()) {
                    api.prevent_close();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            load_app_data,
            save_app_data,
            reset_corrupt_settings,
            export_templates,
            read_templates_export,
            list_template_backups,
            read_template_backup,
            set_hotkey,
            open_data_dir,
            open_path,
            reset_window_position,
            set_satellite,
            is_satellite,
            translate_text,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
