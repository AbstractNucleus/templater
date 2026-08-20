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
    save_catalog, save_preferences,
};
use commands::translate::translate_text;
use hotkey::set_hotkey;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Resolve the data dir and register the store before Tauri constructs
    // config-defined webviews. Showing the main window lets its frontend
    // invoke load_app_data immediately; the store must already be managed.
    let context = tauri::generate_context!();
    let dir = dirs::data_dir()
        .expect("could not resolve application data directory")
        .join(&context.config().identifier);
    std::fs::create_dir_all(&dir).expect("could not create application data directory");

    let store = Store::new(dir);
    let loaded_settings = match store.load() {
        Ok(LoadOutcome::Ready { data }) => Some(data.settings),
        _ => None,
    };
    let start_minimised = loaded_settings
        .as_ref()
        .map(|s| s.start_minimised_to_tray)
        .unwrap_or(false);

    let mut builder = tauri::Builder::default()
        .manage(store)
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
        .setup(move |app| {
            if let Some(window) = app.get_webview_window("main") {
                configure_main_on_startup(&window, loaded_settings.as_ref(), start_minimised);
            }

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
            save_catalog,
            save_preferences,
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
        .run(context)
        .expect("error while running tauri application");
}
