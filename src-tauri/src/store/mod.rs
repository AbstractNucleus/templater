//! On-disk app data store. Two JSON files in the app data dir:
//!
//! - `templates.json` — `{ "version": 1, "templates": [...] }`
//! - `settings.json`  — `{ "version": 1, "settings": {...} }`
//!
//! The in-memory shape exposed to callers is the merged [`AppData`].
//! See [`persist`] for atomic save / backup / parse helpers.

mod models;
mod persist;

#[allow(unused_imports)] // public API re-exports for commands / future callers
pub use models::{
    AppData, BackupEntry, ColumnWidths, LoadOutcome, Mode, Settings, SortMode, Template,
    TemplateVersion, Theme, WindowGeometry, DATA_VERSION, DEFAULT_HOTKEY,
};
pub use persist::parse_templates_json;
pub(crate) use persist::{commit_temp as commit_temp_file, prepare_temp as prepare_temp_file};

use persist::{
    clear_corrupt_lock, collect_backups, commit_temp, corrupt_lock_present, prepare_temp,
    quarantine_file, read_settings_file, read_templates_file, write_corrupt_lock,
    write_settings_file, write_settings_only, SettingsFileWrite, TemplatesFileWrite,
};
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;

struct StoreInner {
    templates_path: PathBuf,
    settings_path: PathBuf,
    /// When set, [`Store::save`] refuses full AppData writes so defaults cannot
    /// overwrite a quarantined settings file. Cleared by [`Store::reset_corrupt_settings`].
    settings_corrupt: bool,
}

/// On-disk app data. All load/save paths take the mutex so FE `save_app_data`
/// cannot interleave with Rust settings-only geometry writes.
pub struct Store {
    inner: Mutex<StoreInner>,
}

impl Store {
    pub fn new(templates_path: PathBuf, settings_path: PathBuf) -> Self {
        Self {
            inner: Mutex::new(StoreInner {
                templates_path,
                settings_path,
                settings_corrupt: false,
            }),
        }
    }

    fn lock(&self) -> Result<std::sync::MutexGuard<'_, StoreInner>, String> {
        self.inner
            .lock()
            .map_err(|_| "store lock poisoned".to_string())
    }

    pub fn load(&self) -> Result<LoadOutcome, String> {
        let mut guard = self.lock()?;
        let templates_exists = guard.templates_path.exists();
        let settings_exists = guard.settings_path.exists();
        if !templates_exists && !settings_exists {
            guard.settings_corrupt = false;
            return Ok(LoadOutcome::Empty);
        }

        let templates_file = if templates_exists {
            Some(read_templates_file(&guard.templates_path)?)
        } else {
            None
        };
        let templates = templates_file
            .as_ref()
            .map(|t| t.templates.clone())
            .unwrap_or_default();

        if settings_exists {
            match read_settings_file(&guard.settings_path) {
                Ok(f) => {
                    clear_corrupt_lock(&guard.settings_path);
                    guard.settings_corrupt = false;
                    if let Some(tf) = &templates_file {
                        if tf.version != f.version {
                            eprintln!(
                                "warning: dual-file version mismatch (templates.json={}, settings.json={}); continuing with in-memory merge",
                                tf.version, f.version
                            );
                        }
                    }
                    Ok(LoadOutcome::Ready {
                        data: AppData {
                            version: DATA_VERSION,
                            templates,
                            settings: f.settings,
                        },
                    })
                }
                Err(e) => {
                    let message = e.clone();
                    if let Err(q) = quarantine_file(&guard.settings_path) {
                        eprintln!("failed to quarantine corrupt settings.json: {q}");
                    }
                    if let Err(q) = write_corrupt_lock(&guard.settings_path) {
                        eprintln!("failed to write settings corrupt-lock: {q}");
                    }
                    guard.settings_corrupt = true;
                    eprintln!("settings.json unreadable (quarantined): {message}");
                    Ok(LoadOutcome::SettingsCorrupt { templates, message })
                }
            }
        } else if corrupt_lock_present(&guard.settings_path) {
            guard.settings_corrupt = true;
            Ok(LoadOutcome::SettingsCorrupt {
                templates,
                message: "settings.json was corrupt and quarantined; reset required"
                    .to_string(),
            })
        } else {
            let settings = templates_file
                .and_then(|t| t.legacy_settings)
                .unwrap_or_default();
            guard.settings_corrupt = false;
            Ok(LoadOutcome::Ready {
                data: AppData {
                    version: DATA_VERSION,
                    templates,
                    settings,
                },
            })
        }
    }

    /// Persist templates + settings. Inbound `data.version` is ignored; both
    /// files are stamped with [`DATA_VERSION`] (FE does not own the disk schema).
    pub fn save(&self, data: &AppData) -> Result<(), String> {
        let guard = self.lock()?;
        if guard.settings_corrupt {
            return Err(
                "settings_corrupt: refuse save until settings are reset".to_string(),
            );
        }
        if let Some(parent) = guard.templates_path.parent() {
            fs::create_dir_all(parent).map_err(|e| format!("mkdir {}: {e}", parent.display()))?;
        }

        let templates_tmp = prepare_temp(&guard.templates_path, |w| {
            let payload = TemplatesFileWrite {
                version: DATA_VERSION,
                templates: &data.templates,
            };
            serde_json::to_writer_pretty(w, &payload).map_err(|e| e.to_string())
        })?;

        let settings_tmp = prepare_temp(&guard.settings_path, |w| {
            let payload = SettingsFileWrite {
                version: DATA_VERSION,
                settings: &data.settings,
            };
            serde_json::to_writer_pretty(w, &payload).map_err(|e| e.to_string())
        })?;

        commit_temp(&templates_tmp, &guard.templates_path)?;
        commit_temp(&settings_tmp, &guard.settings_path)?;

        Ok(())
    }

    /// OpenRouter key + model from on-disk settings (never trust FE IPC for the key).
    pub fn translation_config(&self) -> Result<(String, String), String> {
        let guard = self.lock()?;
        if guard.settings_corrupt {
            return Err(
                "settings_corrupt: configure translation after resetting settings".to_string(),
            );
        }
        let settings = if guard.settings_path.exists() {
            read_settings_file(&guard.settings_path)?.settings
        } else {
            Settings::default()
        };
        Ok((settings.openrouter_api_key, settings.translation_model))
    }

    /// Patch `window_geometry` in `settings.json` only — never rewrites templates.
    pub fn set_window_geometry(&self, geo: Option<WindowGeometry>) -> Result<(), String> {
        let guard = self.lock()?;
        if guard.settings_corrupt {
            return Ok(());
        }
        write_settings_only(&guard.settings_path, |settings| {
            settings.window_geometry = geo;
        })
    }

    /// After a corrupt settings load: write defaults and clear the save lock.
    pub fn reset_corrupt_settings(&self) -> Result<(), String> {
        let mut guard = self.lock()?;
        if let Some(parent) = guard.settings_path.parent() {
            fs::create_dir_all(parent).map_err(|e| format!("mkdir {}: {e}", parent.display()))?;
        }
        write_settings_file(&guard.settings_path, &Settings::default())?;
        clear_corrupt_lock(&guard.settings_path);
        guard.settings_corrupt = false;
        Ok(())
    }

    /// Backups of `templates.json`, newest first.
    pub fn list_template_backups(&self) -> Result<Vec<BackupEntry>, String> {
        let guard = self.lock()?;
        let backups = collect_backups(&guard.templates_path)?;
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

    /// Read templates from the named backup. Does not write.
    pub fn read_template_backup(&self, name: &str) -> Result<Vec<Template>, String> {
        if name.contains('/') || name.contains('\\') || name.contains("..") {
            return Err(format!("invalid backup name: {name}"));
        }
        let guard = self.lock()?;
        let parent = guard
            .templates_path
            .parent()
            .ok_or_else(|| "templates path has no parent".to_string())?;
        let backup_path = parent.join(name);
        if !backup_path.exists() {
            return Err(format!("backup not found: {name}"));
        }

        let text = fs::read_to_string(&backup_path)
            .map_err(|e| format!("read {}: {e}", backup_path.display()))?;
        Ok(parse_templates_json(&text)?.templates)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use persist::{corrupt_lock_path, now_epoch_secs};
    use std::fs;
    use std::path::Path;

    fn temp_store(dir: &Path) -> Store {
        Store::new(dir.join("templates.json"), dir.join("settings.json"))
    }

    #[test]
    fn corrupt_settings_quarantines_and_blocks_save() {
        let dir = std::env::temp_dir().join(format!("templater-test-{}", now_epoch_secs()));
        fs::create_dir_all(&dir).unwrap();
        let templates_path = dir.join("templates.json");
        let settings_path = dir.join("settings.json");

        fs::write(
            &templates_path,
            r#"{"version":1,"templates":[{"id":"a","name":"A","tags":[],"opening":"","body":"","created_at":"","updated_at":""}]}"#,
        )
        .unwrap();
        fs::write(&settings_path, "{not json").unwrap();

        let store = temp_store(&dir);
        let outcome = store.load().unwrap();
        match outcome {
            LoadOutcome::SettingsCorrupt { templates, .. } => {
                assert_eq!(templates.len(), 1);
                assert_eq!(templates[0].id, "a");
            }
            other => panic!("expected SettingsCorrupt, got {other:?}"),
        }
        assert!(!settings_path.exists(), "corrupt file should be quarantined");
        assert!(
            corrupt_lock_path(&settings_path).exists(),
            "corrupt-lock should remain for a second load"
        );
        match store.load().unwrap() {
            LoadOutcome::SettingsCorrupt { .. } => {}
            other => panic!("second load expected SettingsCorrupt, got {other:?}"),
        }
        assert!(
            store
                .save(&AppData {
                    version: DATA_VERSION,
                    templates: vec![],
                    settings: Settings::default(),
                })
                .unwrap_err()
                .contains("settings_corrupt")
        );

        store.reset_corrupt_settings().unwrap();
        assert!(!corrupt_lock_path(&settings_path).exists());
        store
            .save(&AppData {
                version: DATA_VERSION,
                templates: vec![],
                settings: Settings::default(),
            })
            .unwrap();

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn set_window_geometry_does_not_touch_templates() {
        let dir = std::env::temp_dir().join(format!("templater-geo-{}", now_epoch_secs()));
        fs::create_dir_all(&dir).unwrap();
        let templates_path = dir.join("templates.json");
        let settings_path = dir.join("settings.json");

        let templates_json = r#"{"version":1,"templates":[{"id":"keep","name":"Keep","tags":[],"opening":"","body":"x","created_at":"","updated_at":""}]}"#;
        fs::write(&templates_path, templates_json).unwrap();
        fs::write(
            &settings_path,
            r#"{"version":1,"settings":{"always_on_top_default":false,"global_hotkey":"Ctrl+Shift+Backslash"}}"#,
        )
        .unwrap();

        let before = fs::read_to_string(&templates_path).unwrap();
        let store = temp_store(&dir);
        store
            .set_window_geometry(Some(WindowGeometry {
                x: 10,
                y: 20,
                width: 800,
                height: 600,
            }))
            .unwrap();
        let after = fs::read_to_string(&templates_path).unwrap();
        assert_eq!(before, after, "geometry write must not rewrite templates.json");

        let settings_text = fs::read_to_string(&settings_path).unwrap();
        assert!(settings_text.contains("\"x\": 10"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn version_mismatch_still_loads() {
        let dir = std::env::temp_dir().join(format!("templater-ver-{}", now_epoch_secs()));
        fs::create_dir_all(&dir).unwrap();
        fs::write(
            dir.join("templates.json"),
            r#"{"version":1,"templates":[]}"#,
        )
        .unwrap();
        fs::write(
            dir.join("settings.json"),
            r#"{"version":99,"settings":{"always_on_top_default":false,"global_hotkey":"Ctrl+Shift+Backslash"}}"#,
        )
        .unwrap();

        let store = temp_store(&dir);
        match store.load().unwrap() {
            LoadOutcome::Ready { data } => {
                assert_eq!(data.version, DATA_VERSION);
            }
            other => panic!("expected Ready despite version mismatch, got {other:?}"),
        }
        let _ = fs::remove_dir_all(&dir);
    }
}
