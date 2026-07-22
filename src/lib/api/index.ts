/** Facade re-exports — prefer importing from `$lib/api/data`, `windows`, or `updater`. */
export {
  loadAppData,
  saveAppData,
  saveCatalog,
  savePreferences,
  toPreferences,
  catalogPayload,
  resetCorruptSettings,
  exportTemplates,
  readTemplatesExport,
  listTemplateBackups,
  readTemplateBackup,
  translateText,
  type BackupEntry,
  type Preferences,
} from "./data";

export {
  setHotkey,
  openDataDir,
  openPath,
  resetWindowPosition,
  setSatellite,
  isSatellite,
  type SatelliteKind,
} from "./windows";

export { checkForUpdate, getAppVersion, type UpdateInfo } from "./updater";
