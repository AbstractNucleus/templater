//! Atomic file I/O, backups, and JSON parsers for the on-disk store.
//!
//! **Layout:**
//! - `catalog.json` — templates + template-coupled metadata (one atomic commit)
//! - `preferences.json` — independent preferences (patched; no catalog backup churn)
//!
//! Legacy `templates.json` / `settings.json` are still read on load and retired
//! after the first successful write of the new layout.

use super::models::{
    CatalogMeta, Preferences, Settings, SortMode, Template, DATA_VERSION,
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

/// How many timestamped backups to keep per catalog file.
pub(super) const MAX_BACKUPS: usize = 5;

static BACKUP_SEQ: AtomicU64 = AtomicU64::new(0);

/// Parsed catalog (or legacy templates.json / export / bare array).
/// Schema version is validated at parse time; callers always write `DATA_VERSION`.
#[derive(Debug, Default)]
pub struct ParsedCatalog {
    pub templates: Vec<Template>,
    pub meta: CatalogMeta,
    /// Only set when reading a legacy unified file that embedded settings.
    pub legacy_settings: Option<Settings>,
}

/// On-disk `catalog.json` (and legacy `templates.json` with optional meta).
#[derive(Debug, Deserialize)]
struct CatalogFileRead {
    version: u32,
    templates: Vec<Template>,
    #[serde(default)]
    placeholder_values: HashMap<String, HashMap<String, String>>,
    #[serde(default)]
    sort_mode: SortMode,
    #[serde(default)]
    tag_order: Vec<String>,
    #[serde(default, rename = "settings")]
    legacy_settings: Option<Settings>,
}

#[derive(Debug, Serialize)]
pub(super) struct CatalogFileWrite<'a> {
    pub version: u32,
    pub templates: &'a [Template],
    pub placeholder_values: &'a HashMap<String, HashMap<String, String>>,
    pub sort_mode: SortMode,
    pub tag_order: &'a [String],
}

/// Legacy `settings.json` — full merged Settings (coupled fields may be present).
#[derive(Debug, Deserialize)]
struct LegacySettingsFileRead {
    pub version: u32,
    pub settings: Settings,
}

/// `preferences.json` — independent preferences only.
#[derive(Debug, Deserialize)]
struct PreferencesFileRead {
    pub version: u32,
    pub preferences: Preferences,
}

#[derive(Debug, Serialize)]
pub(super) struct PreferencesFileWrite<'a> {
    pub version: u32,
    pub preferences: &'a Preferences,
}

/// Reject unknown future schemas. Known older versions would migrate here.
pub(super) fn validate_schema_version(version: u32) -> Result<(), String> {
    if version == 0 {
        return Err("invalid schema version 0".into());
    }
    if version > DATA_VERSION {
        return Err(format!(
            "unsupported schema version {version} (this build supports up to {DATA_VERSION}); refusing to load"
        ));
    }
    Ok(())
}

/// Parse catalog / legacy templates / export JSON.
pub fn parse_templates_json(text: &str) -> Result<ParsedCatalog, String> {
    let trimmed = text.trim_start();
    if trimmed.starts_with('[') {
        let templates: Vec<Template> = serde_json::from_str(text)
            .map_err(|e| format!("not valid templates JSON: {e}"))?;
        return Ok(ParsedCatalog {
            templates,
            meta: CatalogMeta::default(),
            legacy_settings: None,
        });
    }
    let file: CatalogFileRead = serde_json::from_str(text)
        .map_err(|e| format!("not valid templates JSON: {e}"))?;
    validate_schema_version(file.version)?;
    Ok(ParsedCatalog {
        templates: file.templates,
        meta: CatalogMeta {
            placeholder_values: file.placeholder_values,
            sort_mode: file.sort_mode,
            tag_order: file.tag_order,
        },
        legacy_settings: file.legacy_settings,
    })
}

pub(super) fn read_catalog_file(path: &Path) -> Result<ParsedCatalog, String> {
    let text = fs::read_to_string(path).map_err(|e| format!("read {}: {e}", path.display()))?;
    parse_templates_json(&text).map_err(|e| format!("parse {}: {e}", path.display()))
}

pub(super) fn read_preferences_file(path: &Path) -> Result<(u32, Preferences), String> {
    let text = fs::read_to_string(path).map_err(|e| format!("read {}: {e}", path.display()))?;
    let file: PreferencesFileRead = serde_json::from_str(&text)
        .map_err(|e| format!("parse {}: {e}", path.display()))?;
    validate_schema_version(file.version)
        .map_err(|e| format!("parse {}: {e}", path.display()))?;
    Ok((file.version, file.preferences))
}

/// Legacy settings.json → full Settings (may still contain catalog meta).
pub(super) fn read_legacy_settings_file(path: &Path) -> Result<(u32, Settings), String> {
    let text = fs::read_to_string(path).map_err(|e| format!("read {}: {e}", path.display()))?;
    let file: LegacySettingsFileRead = serde_json::from_str(&text)
        .map_err(|e| format!("parse {}: {e}", path.display()))?;
    validate_schema_version(file.version)
        .map_err(|e| format!("parse {}: {e}", path.display()))?;
    Ok((file.version, file.settings))
}

pub(super) fn write_catalog_file(
    path: &Path,
    templates: &[Template],
    meta: &CatalogMeta,
) -> Result<(), String> {
    let tmp = prepare_temp(path, true, |w| {
        let payload = CatalogFileWrite {
            version: DATA_VERSION,
            templates,
            placeholder_values: &meta.placeholder_values,
            sort_mode: meta.sort_mode,
            tag_order: &meta.tag_order,
        };
        serde_json::to_writer_pretty(w, &payload).map_err(|e| e.to_string())
    })?;
    commit_temp(&tmp, path)
}

pub(super) fn write_preferences_file(path: &Path, preferences: &Preferences) -> Result<(), String> {
    // Preferences writes do not rotate catalog backups; they may still keep a
    // short preferences.bak trail for crash recovery, but never touch catalog.
    let tmp = prepare_temp(path, true, |w| {
        let payload = PreferencesFileWrite {
            version: DATA_VERSION,
            preferences,
        };
        serde_json::to_writer_pretty(w, &payload).map_err(|e| e.to_string())
    })?;
    commit_temp(&tmp, path)
}

/// Load-or-default preferences, apply `patch`, write preferences.json only.
pub(super) fn write_preferences_only<F>(preferences_path: &Path, patch: F) -> Result<(), String>
where
    F: FnOnce(&mut Preferences),
{
    if let Some(parent) = preferences_path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("mkdir {}: {e}", parent.display()))?;
    }
    let mut preferences = if preferences_path.exists() {
        read_preferences_file(preferences_path)?.1
    } else {
        Preferences::default()
    };
    patch(&mut preferences);
    write_preferences_file(preferences_path, &preferences)
}

/// Rename `path` → `<path>.corrupt.<id>`.
pub(super) fn quarantine_file(path: &Path) -> Result<(), String> {
    if !path.exists() {
        return Ok(());
    }
    let id = backup_id();
    let dest = path.with_extension(
        path.extension()
            .map(|e| format!("{}.corrupt.{id}", e.to_string_lossy()))
            .unwrap_or_else(|| format!("corrupt.{id}")),
    );
    fs::rename(path, &dest).map_err(|e| format!("quarantine {}: {e}", path.display()))
}

pub(super) fn corrupt_lock_path(preferences_path: &Path) -> PathBuf {
    preferences_path.with_file_name("preferences.corrupt-lock")
}

pub(super) fn legacy_corrupt_lock_path(data_dir: &Path) -> PathBuf {
    data_dir.join("settings.corrupt-lock")
}

pub(super) fn write_corrupt_lock(preferences_path: &Path) -> Result<(), String> {
    let lock = corrupt_lock_path(preferences_path);
    fs::write(&lock, b"1").map_err(|e| format!("write {}: {e}", lock.display()))
}

pub(super) fn clear_corrupt_lock(preferences_path: &Path) {
    let _ = fs::remove_file(corrupt_lock_path(preferences_path));
    if let Some(parent) = preferences_path.parent() {
        let _ = fs::remove_file(legacy_corrupt_lock_path(parent));
    }
}

pub(super) fn corrupt_lock_present(preferences_path: &Path) -> bool {
    if corrupt_lock_path(preferences_path).exists() {
        return true;
    }
    preferences_path
        .parent()
        .map(|p| legacy_corrupt_lock_path(p).exists())
        .unwrap_or(false)
}

/// Write a temp sibling. When `backup` is true and `path` exists, copy to a
/// collision-free `.bak.<id>` first and prune old backups.
pub(crate) fn prepare_temp<F>(path: &Path, backup: bool, render: F) -> Result<PathBuf, String>
where
    F: FnOnce(&mut fs::File) -> Result<(), String>,
{
    if backup && path.exists() {
        let bak = backup_path_for(path);
        fs::copy(path, &bak).map_err(|e| format!("backup {}: {e}", bak.display()))?;
        prune_backups(path).ok();
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
    Ok(tmp)
}

pub(crate) fn commit_temp(tmp: &Path, path: &Path) -> Result<(), String> {
    fs::rename(tmp, path)
        .map_err(|e| format!("rename {} -> {}: {e}", tmp.display(), path.display()))?;
    Ok(())
}

#[cfg(test)]
pub(super) fn now_epoch_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn now_epoch_nanos() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0)
}

/// Monotonic-enough backup id: nanos + process-local sequence (no second collisions).
fn backup_id() -> String {
    let seq = BACKUP_SEQ.fetch_add(1, Ordering::Relaxed);
    format!("{}-{}", now_epoch_nanos(), seq)
}

fn backup_path_for(path: &Path) -> PathBuf {
    let id = backup_id();
    path.with_extension(
        path.extension()
            .map(|e| format!("{}.bak.{id}", e.to_string_lossy()))
            .unwrap_or_else(|| format!("bak.{id}")),
    )
}

/// Collect `*.bak*` siblings. Epoch for sorting: leading decimal in the suffix
/// (supports legacy `bak.<secs>` and new `bak.<nanos>-<seq>`).
pub(super) fn collect_backups(path: &Path) -> Result<Vec<(PathBuf, u64)>, String> {
    let Some(parent) = path.parent() else {
        return Ok(Vec::new());
    };
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
            0
        } else if let Some(rest) = suffix.strip_prefix('.') {
            // "123456" or "123456789-0" → take leading digits / nanos→secs
            let head = rest.split('-').next().unwrap_or(rest);
            if let Ok(n) = head.parse::<u128>() {
                // nanos are >= 1e12 for modern clocks; secs are ~1e9
                if n >= 1_000_000_000_000 {
                    (n / 1_000_000_000) as u64
                } else {
                    n as u64
                }
            } else {
                0
            }
        } else {
            continue;
        };
        out.push((entry.path(), epoch));
    }
    out.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| b.0.cmp(&a.0)));
    Ok(out)
}

fn prune_backups(path: &Path) -> Result<(), String> {
    let all = collect_backups(path)?;
    let epoched: Vec<_> = all.into_iter().filter(|(_, e)| *e > 0).collect();
    for (old, _) in epoched.into_iter().skip(MAX_BACKUPS) {
        let _ = fs::remove_file(&old);
    }
    Ok(())
}

/// Retire legacy filenames after a successful catalog+preferences write.
pub(super) fn retire_legacy_files(data_dir: &Path) {
    for name in ["templates.json", "settings.json"] {
        let path = data_dir.join(name);
        if path.exists() {
            let retired = data_dir.join(format!("{name}.pre-catalog-migration"));
            let _ = fs::rename(&path, &retired);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_object_and_bare_array() {
        let obj = parse_templates_json(
            r#"{"version":1,"templates":[{"id":"a","name":"A","tags":[],"opening":"","body":"","created_at":"","updated_at":""}]}"#,
        )
        .unwrap();
        assert_eq!(obj.templates.len(), 1);
        assert!(obj.legacy_settings.is_none());

        let arr = parse_templates_json(
            r#"[{"id":"b","name":"B","tags":[],"opening":"","body":"","created_at":"","updated_at":""}]"#,
        )
        .unwrap();
        assert_eq!(arr.templates[0].id, "b");
    }

    #[test]
    fn parse_catalog_with_meta() {
        let parsed = parse_templates_json(
            r#"{"version":1,"templates":[],"placeholder_values":{"t1":{"n":"x"}},"sort_mode":"manual","tag_order":["a"]}"#,
        )
        .unwrap();
        assert_eq!(parsed.meta.tag_order, vec!["a"]);
        assert_eq!(parsed.meta.sort_mode, SortMode::Manual);
        assert_eq!(
            parsed.meta.placeholder_values.get("t1").unwrap().get("n").unwrap(),
            "x"
        );
    }

    #[test]
    fn parse_rejects_garbage() {
        assert!(parse_templates_json("{nope").is_err());
    }

    #[test]
    fn parse_requires_top_level_fields() {
        assert!(
            parse_templates_json(r#"{"templates":[]}"#).is_err(),
            "missing version must fail"
        );
        assert!(
            parse_templates_json(r#"{"version":1}"#).is_err(),
            "missing templates must fail"
        );
        assert!(
            parse_templates_json("{}").is_err(),
            "empty object must fail"
        );
    }

    #[test]
    fn parse_rejects_forward_schema_version() {
        let err = parse_templates_json(r#"{"version":99,"templates":[]}"#)
            .expect_err("version 99 must be rejected");
        assert!(
            err.contains("unsupported schema version 99"),
            "got: {err}"
        );
    }

    #[test]
    fn preferences_requires_top_level_fields_and_rejects_forward_version() {
        assert!(serde_json::from_str::<PreferencesFileRead>(r#"{"preferences":{}}"#).is_err());
        assert!(serde_json::from_str::<PreferencesFileRead>(r#"{"version":1}"#).is_err());

        let file: PreferencesFileRead = serde_json::from_str(
            r#"{"version":99,"preferences":{"always_on_top_default":false,"global_hotkey":"x"}}"#,
        )
        .unwrap();
        let err = validate_schema_version(file.version).expect_err("version 99 must fail");
        assert!(err.contains("unsupported schema version 99"));
    }

    #[test]
    fn backup_ids_are_unique_within_same_second() {
        let dir = std::env::temp_dir().join(format!("templater-bak-{}", now_epoch_secs()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("catalog.json");
        fs::write(&path, "{}").unwrap();
        let a = backup_path_for(&path);
        let b = backup_path_for(&path);
        assert_ne!(a, b, "same-second backups must not collide");
        let _ = fs::remove_dir_all(&dir);
    }
}
