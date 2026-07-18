//! Atomic file I/O, backups, and JSON parsers for the on-disk store.
//!
//! **Dual-file layout:** `templates.json` and `settings.json` are committed
//! separately. A crash between the two commits can leave versions or contents
//! briefly out of sync — [`Store::load`] logs a version mismatch when both
//! files exist with differing `version` fields. Full cross-file transactions
//! are intentionally out of scope; geometry uses settings-only writes to
//! reduce RMW races with the FE template writer.

use super::models::{Settings, Template, DATA_VERSION};
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

/// How many timestamped backups to keep per file.
pub(super) const MAX_BACKUPS: usize = 5;

/// Parsed templates.json (or export / backup / bare array).
#[derive(Debug, Default)]
pub struct ParsedTemplates {
    pub version: u32,
    pub templates: Vec<Template>,
    /// Only set when reading a legacy unified file that embedded settings.
    pub legacy_settings: Option<Settings>,
}

/// On-disk shape for `templates.json`. Optional `legacy_settings` is accepted
/// on read (unified → split migration) and dropped on write.
#[derive(Debug, Default, Deserialize)]
struct TemplatesFileRead {
    #[serde(default = "default_version")]
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
pub(super) struct TemplatesFileWrite<'a> {
    pub version: u32,
    pub templates: &'a [Template],
}

#[derive(Debug, Deserialize)]
pub(super) struct SettingsFileRead {
    #[serde(default = "default_version")]
    pub version: u32,
    #[serde(default)]
    pub settings: Settings,
}

#[derive(Debug, Serialize)]
pub(super) struct SettingsFileWrite<'a> {
    pub version: u32,
    pub settings: &'a Settings,
}

/// One parser for object-shaped `{ templates }` and legacy bare `[...]` arrays.
/// Used by load, backup restore, and export import.
pub fn parse_templates_json(text: &str) -> Result<ParsedTemplates, String> {
    if let Ok(file) = serde_json::from_str::<TemplatesFileRead>(text) {
        return Ok(ParsedTemplates {
            version: file.version,
            templates: file.templates,
            legacy_settings: file.legacy_settings,
        });
    }
    let templates: Vec<Template> = serde_json::from_str(text)
        .map_err(|e| format!("not valid templates JSON: {e}"))?;
    Ok(ParsedTemplates {
        version: DATA_VERSION,
        templates,
        legacy_settings: None,
    })
}

pub(super) fn read_templates_file(path: &Path) -> Result<ParsedTemplates, String> {
    let text = fs::read_to_string(path).map_err(|e| format!("read {}: {e}", path.display()))?;
    parse_templates_json(&text).map_err(|e| format!("parse {}: {e}", path.display()))
}

pub(super) fn read_settings_file(path: &Path) -> Result<SettingsFileRead, String> {
    let text = fs::read_to_string(path).map_err(|e| format!("read {}: {e}", path.display()))?;
    serde_json::from_str::<SettingsFileRead>(&text)
        .map_err(|e| format!("parse {}: {e}", path.display()))
}

pub(super) fn write_settings_file(path: &Path, settings: &Settings) -> Result<(), String> {
    let tmp = prepare_temp(path, |w| {
        let payload = SettingsFileWrite {
            version: DATA_VERSION,
            settings,
        };
        serde_json::to_writer_pretty(w, &payload).map_err(|e| e.to_string())
    })?;
    commit_temp(&tmp, path)
}

/// Load-or-default settings, apply `patch`, write settings.json only.
pub(super) fn write_settings_only<F>(settings_path: &Path, patch: F) -> Result<(), String>
where
    F: FnOnce(&mut Settings),
{
    if let Some(parent) = settings_path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("mkdir {}: {e}", parent.display()))?;
    }
    let mut settings = if settings_path.exists() {
        read_settings_file(settings_path)?.settings
    } else {
        Settings::default()
    };
    patch(&mut settings);
    write_settings_file(settings_path, &settings)
}

/// Rename `path` → `<path>.corrupt.<epoch>`.
pub(super) fn quarantine_file(path: &Path) -> Result<(), String> {
    if !path.exists() {
        return Ok(());
    }
    let epoch = now_epoch_secs();
    let dest = path.with_extension(
        path.extension()
            .map(|e| format!("{}.corrupt.{epoch}", e.to_string_lossy()))
            .unwrap_or_else(|| format!("corrupt.{epoch}")),
    );
    fs::rename(path, &dest).map_err(|e| format!("quarantine {}: {e}", path.display()))
}

pub(super) fn corrupt_lock_path(settings_path: &Path) -> PathBuf {
    settings_path.with_file_name("settings.corrupt-lock")
}

pub(super) fn write_corrupt_lock(settings_path: &Path) -> Result<(), String> {
    let lock = corrupt_lock_path(settings_path);
    fs::write(&lock, b"1").map_err(|e| format!("write {}: {e}", lock.display()))
}

pub(super) fn clear_corrupt_lock(settings_path: &Path) {
    let _ = fs::remove_file(corrupt_lock_path(settings_path));
}

pub(super) fn corrupt_lock_present(settings_path: &Path) -> bool {
    corrupt_lock_path(settings_path).exists()
}

pub(crate) fn prepare_temp<F>(path: &Path, render: F) -> Result<PathBuf, String>
where
    F: FnOnce(&mut fs::File) -> Result<(), String>,
{
    if path.exists() {
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

pub(super) fn now_epoch_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn backup_path_for(path: &Path) -> PathBuf {
    let epoch = now_epoch_secs();
    path.with_extension(
        path.extension()
            .map(|e| format!("{}.bak.{epoch}", e.to_string_lossy()))
            .unwrap_or_else(|| format!("bak.{epoch}")),
    )
}

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
    let epoched: Vec<_> = all.into_iter().filter(|(_, e)| *e > 0).collect();
    for (old, _) in epoched.into_iter().skip(MAX_BACKUPS) {
        let _ = fs::remove_file(&old);
    }
    Ok(())
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
    fn parse_rejects_garbage() {
        assert!(parse_templates_json("{nope").is_err());
    }
}
