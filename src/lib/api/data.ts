import { invoke } from "@tauri-apps/api/core";
import type { AppData, LoadAppDataResult, Settings, Template } from "$lib/types";

export async function loadAppData(): Promise<LoadAppDataResult> {
  return await invoke<LoadAppDataResult>("load_app_data");
}

export async function saveAppData(data: {
  templates: Template[];
  settings: Settings;
}): Promise<void> {
  await invoke<void>("save_app_data", { data });
}

/** Clear fail-closed corrupt-settings lock (writes Settings::default on disk). */
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
