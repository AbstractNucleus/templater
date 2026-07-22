//! On-disk app data store. Two JSON files in the app data dir:
//!
//! - `catalog.json` — `{ version, templates, placeholder_values, sort_mode, tag_order }`
//! - `preferences.json` — `{ version, preferences: {...} }`
//!
//! Legacy `templates.json` / `settings.json` are read on load and retired after
//! the first successful save of the new layout. The in-memory shape exposed to
//! callers is the merged [`AppData`].

mod models;
mod persist;

#[allow(unused_imports)] // public API re-exports for commands / future callers
pub use models::{
    AppData, BackupEntry, CatalogMeta, ColumnWidths, LoadOutcome, Mode, Preferences, Settings,
    SortMode, Template, TemplateVersion, Theme, WindowGeometry, DATA_VERSION, DEFAULT_HOTKEY,
};
pub use persist::parse_templates_json;
pub(crate) use persist::commit_temp as commit_temp_file;

use persist::{
    clear_corrupt_lock, collect_backups, corrupt_lock_present, prepare_temp, quarantine_file,
    read_catalog_file, read_legacy_settings_file, read_preferences_file, retire_legacy_files,
    write_catalog_file, write_corrupt_lock, write_preferences_file, write_preferences_only,
    ParsedCatalog,
};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

/// Export / one-off writers: backup existing target then write temp.
pub(crate) fn prepare_temp_file<F>(path: &Path, render: F) -> Result<PathBuf, String>
where
    F: FnOnce(&mut std::fs::File) -> Result<(), String>,
{
    prepare_temp(path, true, render)
}

struct StoreInner {
    data_dir: PathBuf,
    catalog_path: PathBuf,
    preferences_path: PathBuf,
    legacy_templates_path: PathBuf,
    legacy_settings_path: PathBuf,
    /// When set, catalog/preferences saves refuse writes so defaults cannot
    /// overwrite a quarantined preferences file. Cleared by reset.
    settings_corrupt: bool,
}

/// On-disk app data. All load/save paths take the mutex so FE saves cannot
/// interleave with Rust preferences-only geometry writes.
pub struct Store {
    inner: Mutex<StoreInner>,
}

impl Store {
    pub fn new(data_dir: PathBuf) -> Self {
        Self {
            inner: Mutex::new(StoreInner {
                catalog_path: data_dir.join("catalog.json"),
                preferences_path: data_dir.join("preferences.json"),
                legacy_templates_path: data_dir.join("templates.json"),
                legacy_settings_path: data_dir.join("settings.json"),
                data_dir,
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
        let has_catalog = guard.catalog_path.exists() || guard.legacy_templates_path.exists();
        let has_prefs = guard.preferences_path.exists() || guard.legacy_settings_path.exists();
        if !has_catalog && !has_prefs {
            if corrupt_lock_present(&guard.preferences_path) {
                guard.settings_corrupt = true;
                return Ok(LoadOutcome::SettingsCorrupt {
                    templates: vec![],
                    message: "preferences were corrupt and quarantined; reset required"
                        .to_string(),
                });
            }
            guard.settings_corrupt = false;
            return Ok(LoadOutcome::Empty);
        }

        let using_new_catalog = guard.catalog_path.exists();
        let catalog = if using_new_catalog {
            read_catalog_file(&guard.catalog_path)?
        } else if guard.legacy_templates_path.exists() {
            read_catalog_file(&guard.legacy_templates_path)?
        } else {
            ParsedCatalog::default()
        };
        let templates = catalog.templates.clone();

        if guard.preferences_path.exists() {
            match read_preferences_file(&guard.preferences_path) {
                Ok((_, preferences)) => {
                    clear_corrupt_lock(&guard.preferences_path);
                    guard.settings_corrupt = false;
                    Ok(LoadOutcome::Ready {
                        data: AppData {
                            version: DATA_VERSION,
                            templates,
                            settings: Settings::from_parts(preferences, catalog.meta),
                        },
                    })
                }
                Err(e) => Self::preferences_read_error(&mut guard, templates, e),
            }
        } else if guard.legacy_settings_path.exists() {
            match read_legacy_settings_file(&guard.legacy_settings_path) {
                Ok((_, legacy)) => {
                    clear_corrupt_lock(&guard.preferences_path);
                    guard.settings_corrupt = false;
                    let meta = if using_new_catalog {
                        catalog.meta
                    } else {
                        legacy.catalog_meta()
                    };
                    Ok(LoadOutcome::Ready {
                        data: AppData {
                            version: DATA_VERSION,
                            templates,
                            settings: Settings::from_parts(legacy.preferences(), meta),
                        },
                    })
                }
                Err(e) => Self::preferences_read_error(&mut guard, templates, e),
            }
        } else if corrupt_lock_present(&guard.preferences_path) {
            guard.settings_corrupt = true;
            Ok(LoadOutcome::SettingsCorrupt {
                templates,
                message: "preferences were corrupt and quarantined; reset required".to_string(),
            })
        } else {
            let settings = if let Some(legacy) = catalog.legacy_settings {
                let meta = if using_new_catalog {
                    catalog.meta
                } else {
                    legacy.catalog_meta()
                };
                Settings::from_parts(legacy.preferences(), meta)
            } else {
                Settings::from_parts(Preferences::default(), catalog.meta)
            };
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

    fn preferences_read_error(
        guard: &mut StoreInner,
        templates: Vec<Template>,
        e: String,
    ) -> Result<LoadOutcome, String> {
        if e.contains("unsupported schema version") {
            return Err(e);
        }
        let message = e.clone();
        let quarantine_target = if guard.preferences_path.exists() {
            guard.preferences_path.clone()
        } else {
            guard.legacy_settings_path.clone()
        };
        if let Err(q) = quarantine_file(&quarantine_target) {
            eprintln!("failed to quarantine preferences: {q}");
        }
        if let Err(q) = write_corrupt_lock(&guard.preferences_path) {
            eprintln!("failed to write preferences corrupt-lock: {q}");
        }
        guard.settings_corrupt = true;
        eprintln!("preferences unreadable (quarantined): {message}");
        Ok(LoadOutcome::SettingsCorrupt { templates, message })
    }

    /// Write both catalog and preferences (bootstrap / full sync).
    pub fn save(&self, data: &AppData) -> Result<(), String> {
        self.save_catalog(&data.templates, &data.settings.catalog_meta())?;
        self.save_preferences(&data.settings.preferences())?;
        Ok(())
    }

    /// Atomic catalog commit: templates + coupled metadata. Does not touch preferences.
    pub fn save_catalog(&self, templates: &[Template], meta: &CatalogMeta) -> Result<(), String> {
        let guard = self.lock()?;
        if guard.settings_corrupt {
            return Err(
                "settings_corrupt: refuse save until settings are reset".to_string(),
            );
        }
        fs::create_dir_all(&guard.data_dir)
            .map_err(|e| format!("mkdir {}: {e}", guard.data_dir.display()))?;
        write_catalog_file(&guard.catalog_path, templates, meta)?;
        if guard.preferences_path.exists()
            && (guard.legacy_templates_path.exists() || guard.legacy_settings_path.exists())
        {
            retire_legacy_files(&guard.data_dir);
        }
        Ok(())
    }

    /// Preferences-only commit. Does not rewrite or back up the catalog.
    pub fn save_preferences(&self, preferences: &Preferences) -> Result<(), String> {
        let guard = self.lock()?;
        if guard.settings_corrupt {
            return Err(
                "settings_corrupt: refuse save until settings are reset".to_string(),
            );
        }
        fs::create_dir_all(&guard.data_dir)
            .map_err(|e| format!("mkdir {}: {e}", guard.data_dir.display()))?;
        write_preferences_file(&guard.preferences_path, preferences)?;
        if guard.catalog_path.exists()
            && (guard.legacy_templates_path.exists() || guard.legacy_settings_path.exists())
        {
            retire_legacy_files(&guard.data_dir);
        }
        Ok(())
    }

    /// OpenRouter key + model from on-disk preferences (never trust FE IPC for the key).
    pub fn translation_config(&self) -> Result<(String, String), String> {
        let guard = self.lock()?;
        if guard.settings_corrupt {
            return Err(
                "settings_corrupt: configure translation after resetting settings".to_string(),
            );
        }
        let preferences = Self::load_preferences_unlocked(&guard)?;
        Ok((
            preferences.openrouter_api_key,
            preferences.translation_model,
        ))
    }

    fn load_preferences_unlocked(guard: &StoreInner) -> Result<Preferences, String> {
        if guard.preferences_path.exists() {
            Ok(read_preferences_file(&guard.preferences_path)?.1)
        } else if guard.legacy_settings_path.exists() {
            Ok(read_legacy_settings_file(&guard.legacy_settings_path)?
                .1
                .preferences())
        } else {
            Ok(Preferences::default())
        }
    }

    /// Patch `window_geometry` in preferences only — never rewrites catalog.
    pub fn set_window_geometry(&self, geo: Option<WindowGeometry>) -> Result<(), String> {
        let guard = self.lock()?;
        if guard.settings_corrupt {
            return Ok(());
        }
        // Seed preferences from legacy settings when migrating so a geometry
        // write does not wipe other preference fields to defaults.
        if !guard.preferences_path.exists() && guard.legacy_settings_path.exists() {
            let prefs = read_legacy_settings_file(&guard.legacy_settings_path)?
                .1
                .preferences();
            write_preferences_file(&guard.preferences_path, &prefs)?;
        }
        write_preferences_only(&guard.preferences_path, |preferences| {
            preferences.window_geometry = geo;
        })
    }

    /// After a corrupt preferences load: write defaults and clear the save lock.
    pub fn reset_corrupt_settings(&self) -> Result<(), String> {
        let mut guard = self.lock()?;
        fs::create_dir_all(&guard.data_dir)
            .map_err(|e| format!("mkdir {}: {e}", guard.data_dir.display()))?;
        write_preferences_file(&guard.preferences_path, &Preferences::default())?;
        clear_corrupt_lock(&guard.preferences_path);
        guard.settings_corrupt = false;
        Ok(())
    }

    /// Backups of `catalog.json` (and legacy `templates.json` if still present), newest first.
    pub fn list_template_backups(&self) -> Result<Vec<BackupEntry>, String> {
        let guard = self.lock()?;
        let mut backups = collect_backups(&guard.catalog_path)?;
        if guard.legacy_templates_path.exists() || backups.is_empty() {
            let legacy = collect_backups(&guard.legacy_templates_path)?;
            backups.extend(legacy);
            backups.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| b.0.cmp(&a.0)));
        }
        let mut out = Vec::with_capacity(backups.len());
        let mut seen = std::collections::HashSet::new();
        for (path, ts) in backups {
            let name = path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("")
                .to_string();
            if !seen.insert(name.clone()) {
                continue;
            }
            let size = fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
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
        let backup_path = guard.data_dir.join(name);
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
        Store::new(dir.to_path_buf())
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
            corrupt_lock_path(&dir.join("preferences.json")).exists(),
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
        assert!(!corrupt_lock_path(&dir.join("preferences.json")).exists());
        store
            .save(&AppData {
                version: DATA_VERSION,
                templates: vec![],
                settings: Settings::default(),
            })
            .unwrap();
        assert!(dir.join("catalog.json").exists());
        assert!(dir.join("preferences.json").exists());

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn set_window_geometry_does_not_touch_catalog() {
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
        assert_eq!(before, after, "geometry write must not rewrite catalog/templates");
        assert!(!dir.join("catalog.json").exists());

        let prefs_text = fs::read_to_string(dir.join("preferences.json")).unwrap();
        assert!(prefs_text.contains("\"x\": 10"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn save_catalog_does_not_rewrite_preferences() {
        let dir = std::env::temp_dir().join(format!("templater-cat-{}", now_epoch_secs()));
        fs::create_dir_all(&dir).unwrap();
        let store = temp_store(&dir);
        store
            .save(&AppData {
                version: DATA_VERSION,
                templates: vec![],
                settings: Settings {
                    global_hotkey: "Alt+X".into(),
                    ..Settings::default()
                },
            })
            .unwrap();
        let prefs_before = fs::read_to_string(dir.join("preferences.json")).unwrap();

        store
            .save_catalog(
                &[],
                &CatalogMeta {
                    tag_order: vec!["a".into()],
                    ..CatalogMeta::default()
                },
            )
            .unwrap();

        let prefs_after = fs::read_to_string(dir.join("preferences.json")).unwrap();
        assert_eq!(prefs_before, prefs_after);
        let catalog = fs::read_to_string(dir.join("catalog.json")).unwrap();
        assert!(catalog.contains("\"tag_order\""));
        assert!(catalog.contains("\"a\""));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn save_preferences_does_not_rewrite_catalog() {
        let dir = std::env::temp_dir().join(format!("templater-pref-{}", now_epoch_secs()));
        fs::create_dir_all(&dir).unwrap();
        let store = temp_store(&dir);
        store
            .save(&AppData {
                version: DATA_VERSION,
                templates: vec![],
                settings: Settings {
                    tag_order: vec!["keep".into()],
                    ..Settings::default()
                },
            })
            .unwrap();
        let catalog_before = fs::read_to_string(dir.join("catalog.json")).unwrap();

        let mut prefs = Preferences::default();
        prefs.theme = Theme::Light;
        store.save_preferences(&prefs).unwrap();

        let catalog_after = fs::read_to_string(dir.join("catalog.json")).unwrap();
        assert_eq!(catalog_before, catalog_after);
        let prefs_text = fs::read_to_string(dir.join("preferences.json")).unwrap();
        assert!(prefs_text.contains("\"light\""));
        assert!(!prefs_text.contains("tag_order"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn legacy_load_migrates_coupled_fields_into_catalog_on_save() {
        let dir = std::env::temp_dir().join(format!("templater-mig-{}", now_epoch_secs()));
        fs::create_dir_all(&dir).unwrap();
        fs::write(
            dir.join("templates.json"),
            r#"{"version":1,"templates":[{"id":"a","name":"A","tags":["t"],"opening":"","body":"","created_at":"","updated_at":""}]}"#,
        )
        .unwrap();
        fs::write(
            dir.join("settings.json"),
            r#"{"version":1,"settings":{"always_on_top_default":true,"global_hotkey":"Ctrl+A","tag_order":["t"],"sort_mode":"manual","placeholder_values":{"a":{"x":"1"}}}}"#,
        )
        .unwrap();

        let store = temp_store(&dir);
        let data = match store.load().unwrap() {
            LoadOutcome::Ready { data } => data,
            other => panic!("expected Ready, got {other:?}"),
        };
        assert_eq!(data.settings.tag_order, vec!["t"]);
        assert!(data.settings.always_on_top_default);
        assert_eq!(data.settings.sort_mode, SortMode::Manual);

        store.save(&data).unwrap();
        assert!(dir.join("catalog.json").exists());
        assert!(dir.join("preferences.json").exists());
        assert!(
            !dir.join("templates.json").exists(),
            "legacy templates should be retired"
        );
        assert!(
            !dir.join("settings.json").exists(),
            "legacy settings should be retired"
        );

        let catalog = fs::read_to_string(dir.join("catalog.json")).unwrap();
        assert!(catalog.contains("\"tag_order\""));
        assert!(catalog.contains("placeholder_values"));
        let prefs = fs::read_to_string(dir.join("preferences.json")).unwrap();
        assert!(prefs.contains("always_on_top_default"));
        assert!(!prefs.contains("tag_order"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn forward_settings_version_rejects_without_quarantine() {
        let dir = std::env::temp_dir().join(format!("templater-ver-{}", now_epoch_secs()));
        fs::create_dir_all(&dir).unwrap();
        fs::write(
            dir.join("templates.json"),
            r#"{"version":1,"templates":[]}"#,
        )
        .unwrap();
        let settings_json = r#"{"version":99,"settings":{"always_on_top_default":false,"global_hotkey":"Ctrl+Shift+Backslash"}}"#;
        fs::write(dir.join("settings.json"), settings_json).unwrap();

        let store = temp_store(&dir);
        let err = store.load().expect_err("forward settings version must fail load");
        assert!(
            err.contains("unsupported schema version 99"),
            "got: {err}"
        );
        let on_disk = fs::read_to_string(dir.join("settings.json")).unwrap();
        assert_eq!(on_disk, settings_json, "must not quarantine or rewrite");
        assert!(!corrupt_lock_path(&dir.join("preferences.json")).exists());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn forward_templates_version_rejects_load() {
        let dir = std::env::temp_dir().join(format!("templater-tpl-ver-{}", now_epoch_secs()));
        fs::create_dir_all(&dir).unwrap();
        fs::write(
            dir.join("templates.json"),
            r#"{"version":99,"templates":[]}"#,
        )
        .unwrap();
        fs::write(
            dir.join("settings.json"),
            r#"{"version":1,"settings":{"always_on_top_default":false,"global_hotkey":"Ctrl+Shift+Backslash"}}"#,
        )
        .unwrap();

        let store = temp_store(&dir);
        let err = store.load().expect_err("forward templates version must fail load");
        assert!(
            err.contains("unsupported schema version 99"),
            "got: {err}"
        );
        let on_disk = fs::read_to_string(dir.join("templates.json")).unwrap();
        assert!(on_disk.contains(r#""version":99"#));
        let _ = fs::remove_dir_all(&dir);
    }
}
