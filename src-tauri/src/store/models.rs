//! Domain types for on-disk app data (templates + settings).

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

pub const DATA_VERSION: u32 = 1;
pub const DEFAULT_HOTKEY: &str = "Ctrl+Shift+Backslash";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TemplateVersion {
    pub saved_at: String,
    #[serde(default)]
    pub opening: String,
    #[serde(default)]
    pub body: String,
    #[serde(default)]
    pub tags: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Template {
    pub id: String,
    pub name: String,
    pub tags: Vec<String>,
    pub opening: String,
    pub body: String,
    pub created_at: String,
    pub updated_at: String,
    #[serde(default)]
    pub pinned: bool,
    #[serde(default)]
    pub last_used_at: Option<String>,
    #[serde(default)]
    pub copy_count: u64,
    #[serde(default)]
    pub folder: Option<String>,
    #[serde(default)]
    pub history: Vec<TemplateVersion>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct WindowGeometry {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct ColumnWidths {
    pub tags: u32,
    pub templates: u32,
}

impl Default for ColumnWidths {
    fn default() -> Self {
        Self {
            tags: 180,
            templates: 260,
        }
    }
}

/// Unknown values fail deserialize (no silent coerce-to-default).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum Theme {
    #[default]
    Dark,
    Light,
}

/// Unknown values fail deserialize (no silent coerce-to-default).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum Mode {
    #[default]
    Editor,
    User,
}

/// Unknown values fail deserialize (no silent coerce-to-default).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum SortMode {
    Manual,
    #[default]
    Recent,
    MostUsed,
    NeverUsed,
}

/// Template-coupled metadata stored atomically with templates in `catalog.json`.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct CatalogMeta {
    #[serde(default)]
    pub placeholder_values: HashMap<String, HashMap<String, String>>,
    #[serde(default)]
    pub sort_mode: SortMode,
    #[serde(default)]
    pub tag_order: Vec<String>,
}

/// Independent preferences stored in `preferences.json` (patched, not catalog-backed-up).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Preferences {
    pub always_on_top_default: bool,
    pub global_hotkey: String,
    #[serde(default)]
    pub start_minimised_to_tray: bool,
    #[serde(default)]
    pub window_geometry: Option<WindowGeometry>,
    #[serde(default)]
    pub close_hint_shown: bool,
    #[serde(default)]
    pub global_signature: String,
    #[serde(default)]
    pub theme: Theme,
    #[serde(default)]
    pub mode: Mode,
    #[serde(default = "default_zoom")]
    pub zoom: f32,
    #[serde(default)]
    pub column_widths: ColumnWidths,
    #[serde(default)]
    pub onboarding_complete: bool,
    #[serde(default)]
    pub snippets: HashMap<String, String>,
    #[serde(default)]
    pub minimal: bool,
    #[serde(default = "default_preview_hotkey")]
    pub preview_hotkey: String,
    #[serde(default)]
    pub openrouter_api_key: String,
    #[serde(default = "default_translation_model")]
    pub translation_model: String,
}

impl Default for Preferences {
    fn default() -> Self {
        Self {
            always_on_top_default: false,
            global_hotkey: DEFAULT_HOTKEY.to_string(),
            start_minimised_to_tray: false,
            window_geometry: None,
            close_hint_shown: false,
            global_signature: String::new(),
            theme: Theme::default(),
            mode: Mode::default(),
            zoom: default_zoom(),
            column_widths: ColumnWidths::default(),
            onboarding_complete: false,
            snippets: HashMap::new(),
            minimal: false,
            preview_hotkey: default_preview_hotkey(),
            openrouter_api_key: String::new(),
            translation_model: default_translation_model(),
        }
    }
}

/// Merged in-memory / IPC settings (preferences + catalog meta). Disk splits them.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Settings {
    pub always_on_top_default: bool,
    pub global_hotkey: String,
    #[serde(default)]
    pub start_minimised_to_tray: bool,
    #[serde(default)]
    pub window_geometry: Option<WindowGeometry>,
    #[serde(default)]
    pub close_hint_shown: bool,
    #[serde(default)]
    pub global_signature: String,
    #[serde(default)]
    pub theme: Theme,
    #[serde(default)]
    pub mode: Mode,
    #[serde(default = "default_zoom")]
    pub zoom: f32,
    #[serde(default)]
    pub column_widths: ColumnWidths,
    #[serde(default)]
    pub placeholder_values: HashMap<String, HashMap<String, String>>,
    #[serde(default)]
    pub sort_mode: SortMode,
    #[serde(default)]
    pub tag_order: Vec<String>,
    #[serde(default)]
    pub onboarding_complete: bool,
    #[serde(default)]
    pub snippets: HashMap<String, String>,
    #[serde(default)]
    pub minimal: bool,
    #[serde(default = "default_preview_hotkey")]
    pub preview_hotkey: String,
    #[serde(default)]
    pub openrouter_api_key: String,
    #[serde(default = "default_translation_model")]
    pub translation_model: String,
}

impl Settings {
    pub fn catalog_meta(&self) -> CatalogMeta {
        CatalogMeta {
            placeholder_values: self.placeholder_values.clone(),
            sort_mode: self.sort_mode,
            tag_order: self.tag_order.clone(),
        }
    }

    pub fn preferences(&self) -> Preferences {
        Preferences {
            always_on_top_default: self.always_on_top_default,
            global_hotkey: self.global_hotkey.clone(),
            start_minimised_to_tray: self.start_minimised_to_tray,
            window_geometry: self.window_geometry,
            close_hint_shown: self.close_hint_shown,
            global_signature: self.global_signature.clone(),
            theme: self.theme,
            mode: self.mode,
            zoom: self.zoom,
            column_widths: self.column_widths,
            onboarding_complete: self.onboarding_complete,
            snippets: self.snippets.clone(),
            minimal: self.minimal,
            preview_hotkey: self.preview_hotkey.clone(),
            openrouter_api_key: self.openrouter_api_key.clone(),
            translation_model: self.translation_model.clone(),
        }
    }

    pub fn from_parts(preferences: Preferences, meta: CatalogMeta) -> Self {
        Self {
            always_on_top_default: preferences.always_on_top_default,
            global_hotkey: preferences.global_hotkey,
            start_minimised_to_tray: preferences.start_minimised_to_tray,
            window_geometry: preferences.window_geometry,
            close_hint_shown: preferences.close_hint_shown,
            global_signature: preferences.global_signature,
            theme: preferences.theme,
            mode: preferences.mode,
            zoom: preferences.zoom,
            column_widths: preferences.column_widths,
            placeholder_values: meta.placeholder_values,
            sort_mode: meta.sort_mode,
            tag_order: meta.tag_order,
            onboarding_complete: preferences.onboarding_complete,
            snippets: preferences.snippets,
            minimal: preferences.minimal,
            preview_hotkey: preferences.preview_hotkey,
            openrouter_api_key: preferences.openrouter_api_key,
            translation_model: preferences.translation_model,
        }
    }
}

fn default_zoom() -> f32 {
    1.0
}

fn default_preview_hotkey() -> String {
    "Space".to_string()
}

fn default_translation_model() -> String {
    "openrouter/free".to_string()
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            always_on_top_default: false,
            global_hotkey: DEFAULT_HOTKEY.to_string(),
            start_minimised_to_tray: false,
            window_geometry: None,
            close_hint_shown: false,
            global_signature: String::new(),
            theme: Theme::default(),
            mode: Mode::default(),
            zoom: default_zoom(),
            column_widths: ColumnWidths::default(),
            placeholder_values: HashMap::new(),
            sort_mode: SortMode::default(),
            tag_order: Vec::new(),
            onboarding_complete: false,
            snippets: HashMap::new(),
            minimal: false,
            preview_hotkey: default_preview_hotkey(),
            openrouter_api_key: String::new(),
            translation_model: default_translation_model(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppData {
    /// Echoed on load as [`DATA_VERSION`]. Ignored on save — Rust stamps the disk.
    #[serde(default = "default_app_version")]
    pub version: u32,
    pub templates: Vec<Template>,
    pub settings: Settings,
}

fn default_app_version() -> u32 {
    DATA_VERSION
}

/// Result of [`super::Store::load`]. Corrupt settings never become silent defaults.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum LoadOutcome {
    Empty,
    Ready { data: AppData },
    SettingsCorrupt {
        templates: Vec<Template>,
        message: String,
    },
}

#[derive(Debug, Serialize)]
pub struct BackupEntry {
    pub name: String,
    pub timestamp_secs: u64,
    pub size: u64,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unknown_theme_fails_closed() {
        let err = serde_json::from_str::<Settings>(
            r#"{"always_on_top_default":false,"global_hotkey":"x","theme":"neon"}"#,
        )
        .unwrap_err();
        assert!(err.to_string().contains("neon") || err.to_string().contains("theme"));
    }

    #[test]
    fn unknown_sort_mode_fails_closed() {
        let err = serde_json::from_str::<Settings>(
            r#"{"always_on_top_default":false,"global_hotkey":"x","sort_mode":"popularity"}"#,
        )
        .unwrap_err();
        assert!(
            err.to_string().contains("popularity") || err.to_string().contains("sort_mode")
        );
    }

    #[test]
    fn known_enums_round_trip() {
        let s: Settings = serde_json::from_str(
            r#"{"always_on_top_default":false,"global_hotkey":"x","theme":"light","mode":"user","sort_mode":"most_used"}"#,
        )
        .unwrap();
        assert_eq!(s.theme, Theme::Light);
        assert_eq!(s.mode, Mode::User);
        assert_eq!(s.sort_mode, SortMode::MostUsed);
    }
}
