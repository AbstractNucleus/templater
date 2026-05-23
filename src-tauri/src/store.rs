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
//!   1. Copy current file → `<file>.bak.<epoch>` if present, then prune to
//!      the [`MAX_BACKUPS`] newest. Past versions used a single overwritten
//!      `<file>.bak`; legacy files are listed for restore but never removed.
//!   2. Serialize to `<file>.tmp` and `sync_all()`.
//!   3. Rename `<file>.tmp` → `<file>`.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

pub const DATA_VERSION: u32 = 1;
pub const DEFAULT_HOTKEY: &str = "Ctrl+Shift+Backslash";

/// How many timestamped backups to keep per file. Older ones are pruned on
/// each save. Small enough to not eat disk; large enough to recover from a
/// run of bad edits.
const MAX_BACKUPS: usize = 5;

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
    pub agent: u32,
}

impl Default for ColumnWidths {
    fn default() -> Self {
        Self {
            tags: 180,
            templates: 260,
            agent: 340,
        }
    }
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
    #[serde(default = "default_zoom")]
    pub zoom: f32,
    #[serde(default)]
    pub column_widths: ColumnWidths,
    #[serde(default = "default_paste_backend")]
    pub paste_backend: String,
    #[serde(default)]
    pub placeholder_values: HashMap<String, HashMap<String, String>>,
}

fn default_theme() -> String {
    "dark".to_string()
}

fn default_mode() -> String {
    "editor".to_string()
}

fn default_zoom() -> f32 {
    1.0
}

fn default_paste_backend() -> String {
    "agent".to_string()
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
            zoom: default_zoom(),
            column_widths: ColumnWidths::default(),
            paste_backend: default_paste_backend(),
            placeholder_values: HashMap::new(),
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
        let bak = backup_path_for(path);
        fs::copy(path, &bak).map_err(|e| format!("backup {}: {e}", bak.display()))?;
        prune_backups(path).ok(); // best-effort, don't fail the save
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

fn now_epoch_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// Build `<path>.bak.<epoch>` next to `path`. Two saves within the same
/// second would collide; the second `fs::copy` would overwrite the first,
/// which is acceptable (both backups represent state from the same second).
fn backup_path_for(path: &Path) -> PathBuf {
    let epoch = now_epoch_secs();
    path.with_extension(
        path.extension()
            .map(|e| format!("{}.bak.{epoch}", e.to_string_lossy()))
            .unwrap_or_else(|| format!("bak.{epoch}")),
    )
}

/// Enumerate `<dir>/<stem>.bak.*` entries, sorted by epoch descending.
/// Legacy single-file `<stem>.bak` (no epoch suffix) is included with
/// timestamp 0 so it sorts last — preserved for restore, never auto-pruned.
fn collect_backups(path: &Path) -> Result<Vec<(PathBuf, u64)>, String> {
    let Some(parent) = path.parent() else { return Ok(Vec::new()) };
    let Some(file_name) = path.file_name().and_then(|n| n.to_str()) else {
        return Ok(Vec::new());
    };
    let prefix = format!("{file_name}.bak");

    let entries = match fs::read_dir(parent) {
        Ok(e) => e,
        Err(_) => return Ok(Vec::new()),
    };
    let mut out: Vec<(PathBuf, u64)> = Vec::new();
    for entry in entries.flatten() {
        let name = match entry.file_name().into_string() {
            Ok(s) => s,
            Err(_) => continue,
        };
        if !name.starts_with(&prefix) {
            continue;
        }
        let suffix = &name[prefix.len()..];
        let epoch: u64 = if suffix.is_empty() {
            0 // legacy `.bak` without epoch
        } else if let Some(rest) = suffix.strip_prefix('.') {
            rest.parse().unwrap_or(0)
        } else {
            continue;
        };
        out.push((entry.path(), epoch));
    }
    out.sort_by(|a, b| b.1.cmp(&a.1));
    Ok(out)
}

fn prune_backups(path: &Path) -> Result<(), String> {
    let all = collect_backups(path)?;
    // Only prune epoch-suffixed entries; the legacy `.bak` (epoch 0) stays.
    let epoched: Vec<_> = all.into_iter().filter(|(_, e)| *e > 0).collect();
    for (old, _) in epoched.into_iter().skip(MAX_BACKUPS) {
        let _ = fs::remove_file(&old);
    }
    Ok(())
}

#[derive(Debug, Serialize)]
pub struct BackupEntry {
    pub name: String,
    pub timestamp_secs: u64,
    pub size: u64,
}

impl Store {
    /// Backups of `templates.json`, newest first. Used by Settings → Backups.
    pub fn list_template_backups(&self) -> Result<Vec<BackupEntry>, String> {
        let backups = collect_backups(&self.templates_path)?;
        let mut out = Vec::with_capacity(backups.len());
        for (path, ts) in backups {
            let size = fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
            let name = path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("")
                .to_string();
            out.push(BackupEntry {
                name,
                timestamp_secs: ts,
                size,
            });
        }
        Ok(out)
    }

    /// Replace `templates.json` with the contents of the named backup. The
    /// current file is preserved as a fresh backup (via the standard save
    /// path), so a mistaken restore is itself undoable.
    pub fn restore_template_backup(&self, name: &str) -> Result<AppData, String> {
        // Reject path-traversal — names must come from list_template_backups
        // and contain only the filename.
        if name.contains('/') || name.contains('\\') || name.contains("..") {
            return Err(format!("invalid backup name: {name}"));
        }
        let parent = self
            .templates_path
            .parent()
            .ok_or_else(|| "templates path has no parent".to_string())?;
        let backup_path = parent.join(name);
        if !backup_path.exists() {
            return Err(format!("backup not found: {name}"));
        }

        let text = fs::read_to_string(&backup_path)
            .map_err(|e| format!("read {}: {e}", backup_path.display()))?;
        // Parse to validate before clobbering the live file.
        let file: TemplatesFileRead = serde_json::from_str(&text)
            .or_else(|_| {
                serde_json::from_str::<Vec<Template>>(&text).map(|templates| TemplatesFileRead {
                    version: DATA_VERSION,
                    templates,
                    legacy_settings: None,
                })
            })
            .map_err(|e| format!("backup is not valid templates JSON: {e}"))?;

        // Preserve current settings; only templates are restored.
        let current_settings = self
            .load()
            .ok()
            .flatten()
            .map(|d| d.settings)
            .unwrap_or_default();

        let data = AppData {
            version: DATA_VERSION,
            templates: file.templates,
            settings: current_settings,
        };
        self.save(&data)?;
        Ok(data)
    }
}
