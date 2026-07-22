import { invoke } from "@tauri-apps/api/core";
import type { AppData, LoadAppDataResult, Settings, SortMode, Template } from "$lib/types";

/** Independent preferences (no catalog-coupled fields). */
export type Preferences = Omit<Settings, "placeholder_values" | "tag_order" | "sort_mode">;

export function toPreferences(settings: Settings): Preferences {
  const { placeholder_values: _pv, tag_order: _to, sort_mode: _sm, ...prefs } = settings;
  return prefs;
}

export function catalogPayload(
  templates: Template[],
  settings: Settings,
): {
  templates: Template[];
  placeholder_values: Settings["placeholder_values"];
  tag_order: string[];
  sort_mode: SortMode;
} {
  return {
    templates,
    placeholder_values: settings.placeholder_values,
    tag_order: settings.tag_order,
    sort_mode: settings.sort_mode,
  };
}

export async function loadAppData(): Promise<LoadAppDataResult> {
  return await invoke<LoadAppDataResult>("load_app_data");
}

/** Full sync (bootstrap / migration). Prefer saveCatalog / savePreferences. */
export async function saveAppData(data: {
  templates: Template[];
  settings: Settings;
}): Promise<void> {
  await invoke<void>("save_app_data", { data });
}

export async function saveCatalog(data: {
  templates: Template[];
  placeholder_values: Settings["placeholder_values"];
  tag_order: string[];
  sort_mode: SortMode;
}): Promise<void> {
  await invoke<void>("save_catalog", { data });
}

export async function savePreferences(preferences: Preferences): Promise<void> {
  await invoke<void>("save_preferences", { preferences });
}

/** Clear fail-closed corrupt-settings lock (writes Preferences::default on disk). */
export async function resetCorruptSettings(): Promise<void> {
  await invoke<void>("reset_corrupt_settings");
}

export async function exportTemplates(path: string, templates: Template[]): Promise<number> {
  return await invoke<number>("export_templates", { path, templates });
}

/** Read-only parse of a templates export file. Caller merges + persists. */
export async function readTemplatesExport(path: string): Promise<Template[]> {
  return await invoke<Template[]>("read_templates_export", { path });
}

export interface BackupEntry {
  name: string;
  timestamp_secs: number;
  size: number;
}

export async function listTemplateBackups(): Promise<BackupEntry[]> {
  return await invoke<BackupEntry[]>("list_template_backups");
}

/** Read templates from a named backup. Caller persists (mirrors import). */
export async function readTemplateBackup(name: string): Promise<Template[]> {
  return await invoke<Template[]>("read_template_backup", { name });
}

export async function translateText(text: string): Promise<string> {
  return await invoke<string>("translate_text", { text });
}
