//! Global hotkey state + `#[tauri::command]`s for rebinding at runtime, plus
//! the setup-time registration of the persisted chords.
//!
//! Two shortcuts: the always-present window toggle (`CurrentHotkey`) and an
//! optional quick-capture chord (`CaptureHotkey`). Both rebind commands
//! register the new chord before unregistering the old one so a rejected chord
//! (taken by another app, OS-reserved) never leaves the user with no working
//! hotkey until restart.

use std::str::FromStr;
use std::sync::Mutex;

use crate::store::{Settings, DEFAULT_HOTKEY};

#[cfg(desktop)]
use tauri::Manager;
#[cfg(desktop)]
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};

#[cfg(desktop)]
pub struct CurrentHotkey(pub Mutex<Shortcut>);

/// Second optional global hotkey for the quick-capture flow. None = disabled.
#[cfg(desktop)]
pub struct CaptureHotkey(pub Mutex<Option<Shortcut>>);

#[cfg(desktop)]
#[tauri::command]
pub fn set_hotkey(
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
pub fn set_hotkey(_accelerator: String) -> Result<(), String> {
    Err("global shortcuts not available on this platform".to_string())
}

#[cfg(desktop)]
#[tauri::command]
pub fn set_quick_capture_hotkey(
    accelerator: Option<String>,
    app: tauri::AppHandle,
    current: tauri::State<'_, CaptureHotkey>,
) -> Result<(), String> {
    let mut guard = current.0.lock().map_err(|e| e.to_string())?;
    let gs = app.global_shortcut();
    let next: Option<Shortcut> = match accelerator.as_deref() {
        None | Some("") => None,
        Some(a) => Some(Shortcut::from_str(a).map_err(|e| format!("invalid hotkey \"{a}\": {e}"))?),
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
pub fn set_quick_capture_hotkey(_accelerator: Option<String>) -> Result<(), String> {
    Err("global shortcuts not available on this platform".to_string())
}

/// Register the persisted hotkeys at startup and manage their state.
///
/// Register failures are logged + tolerated rather than aborting setup — an
/// OS-level conflict on the persisted chord would otherwise lock the user out
/// of their own app (can't open Settings to rebind).
#[cfg(desktop)]
pub fn register_startup(app: &tauri::App, loaded_settings: Option<&Settings>) {
    let raw = loaded_settings
        .map(|s| s.global_hotkey.clone())
        .unwrap_or_else(|| DEFAULT_HOTKEY.to_string());
    let shortcut = Shortcut::from_str(&raw)
        .unwrap_or_else(|_| Shortcut::from_str(DEFAULT_HOTKEY).expect("default hotkey parses"));
    if let Err(e) = app.global_shortcut().register(shortcut) {
        eprintln!("global hotkey {raw} unavailable: {e}");
    }
    app.manage(CurrentHotkey(Mutex::new(shortcut)));

    let capture_shortcut: Option<Shortcut> = loaded_settings
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
