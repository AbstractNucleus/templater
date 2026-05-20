//! On-disk app data store. Single JSON file in the app data dir.
//!
//! v1 shape: { "version": 1, "templates": [...], "settings": {...} }
//! v0 (legacy): a bare `[Template, ...]` array — migrated on read.
//!
//! Save protocol (atomic):
//!   1. Copy current `templates.json` -> `templates.json.bak` (if present).
//!   2. Serialize to `templates.json.tmp` and `sync_all()`.
//!   3. Rename `templates.json.tmp` -> `templates.json`.

use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Write;
use std::path::PathBuf;

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
}

fn default_theme() -> String {
    "dark".to_string()
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

pub struct Store {
    path: PathBuf,
}

impl Store {
    pub fn new(path: PathBuf) -> Self {
        Self { path }
    }

    pub fn load(&self) -> Result<Option<AppData>, String> {
        if !self.path.exists() {
            return Ok(None);
        }
        let text = fs::read_to_string(&self.path)
            .map_err(|e| format!("read {}: {e}", self.path.display()))?;

        if let Ok(data) = serde_json::from_str::<AppData>(&text) {
            return Ok(Some(data));
        }
        // Legacy v0: bare array of templates.
        let legacy: Vec<Template> = serde_json::from_str(&text)
            .map_err(|e| format!("parse {}: {e}", self.path.display()))?;
        Ok(Some(AppData::new(legacy)))
    }

    pub fn save(&self, data: &AppData) -> Result<(), String> {
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent).map_err(|e| format!("mkdir {}: {e}", parent.display()))?;
        }

        if self.path.exists() {
            let bak = self.path.with_extension("json.bak");
            fs::copy(&self.path, &bak).map_err(|e| format!("backup {}: {e}", bak.display()))?;
        }

        let tmp = self.path.with_extension("json.tmp");
        let text = serde_json::to_string_pretty(data).map_err(|e| e.to_string())?;
        {
            let mut f = fs::File::create(&tmp).map_err(|e| format!("create {}: {e}", tmp.display()))?;
            f.write_all(text.as_bytes())
                .map_err(|e| format!("write {}: {e}", tmp.display()))?;
            f.sync_all()
                .map_err(|e| format!("fsync {}: {e}", tmp.display()))?;
        }

        fs::rename(&tmp, &self.path)
            .map_err(|e| format!("rename {} -> {}: {e}", tmp.display(), self.path.display()))?;
        Ok(())
    }
}
