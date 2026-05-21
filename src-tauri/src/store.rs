//! On-disk app data store. Two JSON files in the app data dir:
//!
//! - `templates.json` — `{ "version": 1, "templates": [...] }`
//! - `settings.json`  — `{ "version": 1, "settings": {...} }`
//!
//! The in-memory shape exposed to callers is the merged [`AppData`]
//! (`version`, `templates`, `settings`). The split exists so the templates
//! file is portable on its own — it round-trips through the import/export
//! flow with no machine-specific noise.
//!
//! Migration from the legacy unified format (everything in `templates.json`,
//! including a `settings` field) happens transparently on read: if
//! `settings.json` is absent we fall back to the embedded settings, and the
//! next [`Store::save`] rewrites both files in the new shape.
//!
//! Save protocol per file (atomic):
//!   1. Copy current file → `<file>.bak` if present.
//!   2. Serialize to `<file>.tmp` and `sync_all()`.
//!   3. Rename `<file>.tmp` → `<file>`.

use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

pub const DATA_VERSION: u32 = 1;
pub const DEFAULT_HOTKEY: &str = "Ctrl+Shift+Backslash";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Template {
    pub id: String,
    pub name: String,
    pub tags: Vec<String>,
    pub opening: String,
    pub body: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct WindowGeometry {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

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
    #[serde(default = "default_theme")]
    pub theme: String,
    #[serde(default = "default_mode")]
    pub mode: String,
}

fn default_theme() -> String {
    "dark".to_string()
}

fn default_mode() -> String {
    "editor".to_string()
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
            theme: default_theme(),
            mode: default_mode(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppData {
    pub version: u32,
    pub templates: Vec<Template>,
    pub settings: Settings,
}

impl AppData {
    pub fn new(templates: Vec<Template>) -> Self {
        Self {
            version: DATA_VERSION,
            templates,
            settings: Settings::default(),
        }
    }
}

/// On-disk shape for `templates.json`. The optional `legacy_settings` field is
/// only used during the unified → split migration; it's accepted on read,
/// dropped on write.
#[derive(Debug, Default, Deserialize)]
struct TemplatesFileRead {
    #[serde(default = "default_version")]
    #[allow(dead_code)]
    version: u32,
    #[serde(default)]
    templates: Vec<Template>,
    #[serde(default, rename = "settings")]
    legacy_settings: Option<Settings>,
}

fn default_version() -> u32 {
    DATA_VERSION
}

#[derive(Debug, Serialize)]
struct TemplatesFileWrite<'a> {
    version: u32,
    templates: &'a [Template],
}

#[derive(Debug, Deserialize)]
struct SettingsFileRead {
    #[serde(default = "default_version")]
    #[allow(dead_code)]
    version: u32,
    #[serde(default)]
    settings: Settings,
}

#[derive(Debug, Serialize)]
struct SettingsFileWrite<'a> {
    version: u32,
    settings: &'a Settings,
}

pub struct Store {
    templates_path: PathBuf,
    settings_path: PathBuf,
}

impl Store {
    pub fn new(templates_path: PathBuf, settings_path: PathBuf) -> Self {
        Self {
            templates_path,
            settings_path,
        }
    }

    pub fn load(&self) -> Result<Option<AppData>, String> {
        let templates_exists = self.templates_path.exists();
        let settings_exists = self.settings_path.exists();
        if !templates_exists && !settings_exists {
            return Ok(None);
        }

        let templates_file = if templates_exists {
            Some(read_templates_file(&self.templates_path)?)
        } else {
            None
        };

        let settings = if settings_exists {
            let f = read_settings_file(&self.settings_path)?;
            f.settings
        } else {
            // No settings.json yet — fall back to legacy settings embedded in
            // templates.json if present, otherwise the defaults.
            templates_file
                .as_ref()
                .and_then(|t| t.legacy_settings.clone())
                .unwrap_or_default()
        };

        let templates = templates_file.map(|t| t.templates).unwrap_or_default();

        Ok(Some(AppData {
            version: DATA_VERSION,
            templates,
            settings,
        }))
    }

    pub fn save(&self, data: &AppData) -> Result<(), String> {
        if let Some(parent) = self.templates_path.parent() {
            fs::create_dir_all(parent).map_err(|e| format!("mkdir {}: {e}", parent.display()))?;
        }

        write_atomic(&self.templates_path, |w| {
            let payload = TemplatesFileWrite {
                version: DATA_VERSION,
                templates: &data.templates,
            };
            serde_json::to_writer_pretty(w, &payload).map_err(|e| e.to_string())
        })?;

        write_atomic(&self.settings_path, |w| {
            let payload = SettingsFileWrite {
                version: DATA_VERSION,
                settings: &data.settings,
            };
            serde_json::to_writer_pretty(w, &payload).map_err(|e| e.to_string())
        })?;

        Ok(())
    }
}

fn read_templates_file(path: &Path) -> Result<TemplatesFileRead, String> {
    let text = fs::read_to_string(path).map_err(|e| format!("read {}: {e}", path.display()))?;

    if let Ok(file) = serde_json::from_str::<TemplatesFileRead>(&text) {
        return Ok(file);
    }
    // Legacy v0: bare array of templates.
    let legacy: Vec<Template> =
        serde_json::from_str(&text).map_err(|e| format!("parse {}: {e}", path.display()))?;
    Ok(TemplatesFileRead {
        version: DATA_VERSION,
        templates: legacy,
        legacy_settings: None,
    })
}

fn read_settings_file(path: &Path) -> Result<SettingsFileRead, String> {
    let text = fs::read_to_string(path).map_err(|e| format!("read {}: {e}", path.display()))?;
    serde_json::from_str::<SettingsFileRead>(&text)
        .map_err(|e| format!("parse {}: {e}", path.display()))
}

fn write_atomic<F>(path: &Path, render: F) -> Result<(), String>
where
    F: FnOnce(&mut fs::File) -> Result<(), String>,
{
    if path.exists() {
        let bak = path.with_extension(
            path.extension()
                .map(|e| format!("{}.bak", e.to_string_lossy()))
                .unwrap_or_else(|| "bak".to_string()),
        );
        fs::copy(path, &bak).map_err(|e| format!("backup {}: {e}", bak.display()))?;
    }

    let tmp = path.with_extension(
        path.extension()
            .map(|e| format!("{}.tmp", e.to_string_lossy()))
            .unwrap_or_else(|| "tmp".to_string()),
    );
    {
        let mut f =
            fs::File::create(&tmp).map_err(|e| format!("create {}: {e}", tmp.display()))?;
        render(&mut f)?;
        f.flush()
            .map_err(|e| format!("flush {}: {e}", tmp.display()))?;
        f.sync_all()
            .map_err(|e| format!("fsync {}: {e}", tmp.display()))?;
    }

    fs::rename(&tmp, path)
        .map_err(|e| format!("rename {} -> {}: {e}", tmp.display(), path.display()))?;
    Ok(())
}
