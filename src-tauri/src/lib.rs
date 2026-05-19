mod sidecar;

use sidecar::Sidecar;
use tauri::Manager;

#[tauri::command]
async fn ping_sidecar(state: tauri::State<'_, Sidecar>) -> Result<serde_json::Value, String> {
    state
        .request(&serde_json::json!({ "id": "ping-1", "op": "ping" }))
        .await
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let sidecar = Sidecar::spawn().map_err(|e| -> Box<dyn std::error::Error> { e.into() })?;
            app.manage(sidecar);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![ping_sidecar])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
