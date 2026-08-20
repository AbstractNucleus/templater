//! Main + satellite window orchestration (show/hide/park, geometry save).

use crate::store::{Store, WindowGeometry};
use crate::windows_snap;
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewWindow};

/// Remembers translator visibility across main-window hide so tray/hotkey
/// show can restore it via the same park path as `set_satellite`.
static TRANSLATOR_WAS_OPEN: AtomicBool = AtomicBool::new(false);

/// Hide-time translator height (physical px). 0 = never observed.
/// Live size wins while the window still reports one; this is only for park
/// after hide if the OS zeros the hidden size.
static TRANSLATOR_HEIGHT: AtomicU32 = AtomicU32::new(0);

/// Default translator window height (logical px). Used only when the webview
/// has never reported a size (first park).
const TRANSLATOR_DEFAULT_HEIGHT: u32 = 360;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SatelliteKind {
    Preview,
    Translator,
}

impl SatelliteKind {
    pub fn label(self) -> &'static str {
        match self {
            Self::Preview => "preview",
            Self::Translator => "translator",
        }
    }

    fn placement(self) -> Placement {
        match self {
            Self::Preview => Placement::LeftOfMain,
            Self::Translator => Placement::AboveMain,
        }
    }

    fn closed_event(self) -> &'static str {
        match self {
            Self::Preview => "preview-closed",
            Self::Translator => "translator-closed",
        }
    }

    pub fn from_label(label: &str) -> Option<Self> {
        match label {
            "preview" => Some(Self::Preview),
            "translator" => Some(Self::Translator),
            _ => None,
        }
    }
}

/// Where to park a satellite window relative to the main window.
enum Placement {
    /// Same height as main, flush to its left edge.
    LeftOfMain,
    /// Same width as main, flush above its top edge. Height comes from the
    /// satellite window (live size, then hide-stash, then scaled default).
    AboveMain,
}

/// Live size wins. Stash is hide-time fallback. Scaled default only if unseen.
fn resolve_park_height(live: Option<u32>, stashed: u32, default_logical: u32, scale: f64) -> u32 {
    if let Some(h) = live.filter(|&h| h > 0) {
        return h;
    }
    if stashed > 0 {
        return stashed;
    }
    (default_logical as f64 * scale).round().max(1.0) as u32
}

fn current_height(window: &WebviewWindow) -> Option<u32> {
    window
        .inner_size()
        .ok()
        .map(|s| s.height)
        .filter(|&h| h > 0)
        .or_else(|| {
            window
                .outer_size()
                .ok()
                .map(|s| s.height)
                .filter(|&h| h > 0)
        })
}

fn above_main_height(satellite: &WebviewWindow) -> u32 {
    resolve_park_height(
        current_height(satellite),
        TRANSLATOR_HEIGHT.load(Ordering::SeqCst),
        TRANSLATOR_DEFAULT_HEIGHT,
        satellite.scale_factor().unwrap_or(1.0),
    )
}

fn above_main_y(main_y: i32, height: u32) -> i32 {
    (main_y - height as i32).max(0)
}

/// Show a satellite parked beside/above the main window. If main geometry
/// can't be read, shows the satellite without repositioning.
fn park_satellite(app: &AppHandle, kind: SatelliteKind) -> Result<(), String> {
    let label = kind.label();
    let Some(main) = app.get_webview_window("main") else {
        return Err("main window not found".into());
    };
    let satellite = app
        .get_webview_window(label)
        .ok_or_else(|| format!("{label} window not found"))?;

    let (Ok(main_pos), Ok(main_size)) = (main.outer_position(), main.outer_size()) else {
        let _ = satellite.show();
        let _ = satellite.set_focus();
        return Ok(());
    };

    let (size, pos) = match kind.placement() {
        Placement::LeftOfMain => {
            let w = main_size.width;
            let x = (main_pos.x - w as i32).max(0);
            (
                PhysicalSize::new(w, main_size.height),
                PhysicalPosition::new(x, main_pos.y),
            )
        }
        Placement::AboveMain => {
            let height = above_main_height(&satellite);
            (
                PhysicalSize::new(main_size.width, height),
                PhysicalPosition::new(main_pos.x, above_main_y(main_pos.y, height)),
            )
        }
    };

    let _ = satellite.set_size(size);
    let _ = satellite.set_position(pos);
    let _ = satellite.set_always_on_top(main.is_always_on_top().unwrap_or(false));
    let _ = satellite.show();
    let _ = satellite.set_focus();
    Ok(())
}

fn hide_satellite(app: &AppHandle, kind: SatelliteKind, emit_closed: bool) {
    let label = kind.label();
    let was_open = is_satellite_open(app, label);
    if let Some(w) = app.get_webview_window(label) {
        if matches!(kind.placement(), Placement::AboveMain) {
            if let Some(h) = current_height(&w) {
                TRANSLATOR_HEIGHT.store(h, Ordering::SeqCst);
            }
        }
        let _ = w.hide();
    }
    if emit_closed && was_open {
        let _ = app.emit(kind.closed_event(), ());
    }
}

fn is_satellite_open(app: &AppHandle, label: &str) -> bool {
    app.get_webview_window(label)
        .and_then(|w| w.is_visible().ok())
        .unwrap_or(false)
}

/// Open or close a satellite pop-out.
#[tauri::command]
pub fn set_satellite(app: AppHandle, kind: SatelliteKind, open: bool) -> Result<(), String> {
    if open {
        park_satellite(&app, kind)
    } else {
        hide_satellite(&app, kind, true);
        Ok(())
    }
}

#[tauri::command]
pub fn is_satellite(app: AppHandle, kind: SatelliteKind) -> bool {
    is_satellite_open(&app, kind.label())
}

#[tauri::command]
pub fn reset_window_position(app: AppHandle, store: tauri::State<'_, Store>) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.set_size(PhysicalSize::new(800u32, 600u32));
        let _ = window.center();
    }
    store.set_window_geometry(None)?;
    Ok(())
}

/// Returns true if the saved top-left corner falls inside any connected monitor.
pub fn geometry_on_some_monitor(window: &WebviewWindow, geo: &WindowGeometry) -> bool {
    let Ok(monitors) = window.available_monitors() else {
        return true;
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

/// Persist main-window outer geometry into preferences.json only.
pub fn save_window_geometry(app: &AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    if !window.is_visible().unwrap_or(false) {
        return;
    }
    if window.is_minimized().unwrap_or(false) {
        return;
    }
    let (Ok(pos), Ok(size)) = (window.outer_position(), window.outer_size()) else {
        return;
    };
    let store = app.state::<Store>();
    let _ = store.set_window_geometry(Some(WindowGeometry {
        x: pos.x,
        y: pos.y,
        width: size.width,
        height: size.height,
    }));
}

pub fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
    }
    if TRANSLATOR_WAS_OPEN.swap(false, Ordering::SeqCst) {
        let _ = park_satellite(app, SatelliteKind::Translator);
    }
}

pub fn toggle_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let visible = window.is_visible().unwrap_or(false);
        if visible {
            hide_main_window(app);
        } else {
            show_main_window(app);
        }
    }
}

/// Hide the main window and any dependent pop-outs.
pub fn hide_main_window(app: &AppHandle) {
    let Some(main) = app.get_webview_window("main") else {
        return;
    };
    save_window_geometry(app);
    if is_satellite_open(app, SatelliteKind::Preview.label()) {
        hide_satellite(app, SatelliteKind::Preview, true);
    }
    TRANSLATOR_WAS_OPEN.store(
        is_satellite_open(app, SatelliteKind::Translator.label()),
        Ordering::SeqCst,
    );
    hide_satellite(app, SatelliteKind::Translator, false);
    let _ = main.hide();
}

/// Handle CloseRequested for main / satellites. Returns true if the event was
/// claimed (caller should `prevent_close`).
pub fn on_close_requested(app: &AppHandle, label: &str) -> bool {
    if label == "main" {
        hide_main_window(app);
        return true;
    }
    if let Some(kind) = SatelliteKind::from_label(label) {
        hide_satellite(app, kind, true);
        return true;
    }
    false
}

/// Apply saved geometry / always-on-top and install native drag-hit testing.
pub fn configure_main_on_startup(
    window: &WebviewWindow,
    settings: Option<&crate::store::Settings>,
    start_minimised: bool,
) {
    if let Some(settings) = settings {
        if let Some(geo) = &settings.window_geometry {
            if geometry_on_some_monitor(window, geo) {
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
    windows_snap::install(window);
}

#[cfg(test)]
mod tests {
    use super::{above_main_y, resolve_park_height, TRANSLATOR_DEFAULT_HEIGHT};

    #[test]
    fn live_size_wins_over_stash() {
        assert_eq!(
            resolve_park_height(Some(540), 480, TRANSLATOR_DEFAULT_HEIGHT, 1.5),
            540
        );
    }

    #[test]
    fn stash_used_when_live_is_gone() {
        assert_eq!(
            resolve_park_height(None, 480, TRANSLATOR_DEFAULT_HEIGHT, 1.0),
            480
        );
        assert_eq!(
            resolve_park_height(Some(0), 480, TRANSLATOR_DEFAULT_HEIGHT, 1.0),
            480
        );
    }

    #[test]
    fn scaled_default_when_unseen() {
        assert_eq!(
            resolve_park_height(None, 0, TRANSLATOR_DEFAULT_HEIGHT, 1.5),
            540
        );
        assert_eq!(
            resolve_park_height(Some(0), 0, TRANSLATOR_DEFAULT_HEIGHT, 1.0),
            360
        );
    }

    #[test]
    fn above_main_y_clamps_to_screen_top() {
        assert_eq!(above_main_y(400, 360), 40);
        assert_eq!(above_main_y(200, 360), 0);
    }
}
