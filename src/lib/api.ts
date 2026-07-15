import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { AppData, Template } from "./types";

export async function loadAppData(): Promise<AppData | null> {
  return await invoke<AppData | null>("load_app_data");
}

export async function saveAppData(data: AppData): Promise<void> {
  await invoke<void>("save_app_data", { data });
}

export async function setHotkey(accelerator: string): Promise<void> {
  await invoke<void>("set_hotkey", { accelerator });
}

export async function openDataDir(): Promise<void> {
  await invoke<void>("open_data_dir");
}

export async function openPath(path: string): Promise<void> {
  await invoke<void>("open_path", { path });
}

export async function resetWindowPosition(): Promise<void> {
  await invoke<void>("reset_window_position");
}

export async function exportTemplates(path: string): Promise<number> {
  return await invoke<number>("export_templates", { path });
}

export async function exportTemplate(id: string, path: string): Promise<void> {
  await invoke<void>("export_template", { id, path });
}

export async function exportTemplatesSubset(ids: string[], path: string): Promise<number> {
  return await invoke<number>("export_templates_subset", { ids, path });
}

export async function bulkDeleteTemplates(ids: string[]): Promise<Template[]> {
  return await invoke<Template[]>("bulk_delete_templates", { ids });
}

export async function bulkAddTemplateTag(ids: string[], tag: string): Promise<Template[]> {
  return await invoke<Template[]>("bulk_add_template_tag", { ids, tag });
}

export async function bulkRemoveTemplateTag(ids: string[], tag: string): Promise<Template[]> {
  return await invoke<Template[]>("bulk_remove_template_tag", { ids, tag });
}

import { check, type Update, type DownloadEvent } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { getVersion } from "@tauri-apps/api/app";

export interface UpdateInfo {
  version: string;
  currentVersion: string;
  notes: string;
  /** Downloads, installs, then triggers relaunch. */
  install: (onProgress?: (received: number, total: number | null) => void) => Promise<void>;
}

/** Returns null when already on the latest version, throws on network / signature error. */
export async function checkForUpdate(): Promise<UpdateInfo | null> {
  const update: Update | null = await check();
  if (!update) return null;

  return {
    version: update.version,
    currentVersion: update.currentVersion,
    notes: update.body ?? "",
    install: async (onProgress) => {
      let received = 0;
      let total: number | null = null;
      await update.downloadAndInstall((event: DownloadEvent) => {
        if (event.event === "Started") {
          total = event.data.contentLength ?? null;
          received = 0;
          onProgress?.(received, total);
        } else if (event.event === "Progress") {
          received += event.data.chunkLength;
          onProgress?.(received, total);
        } else if (event.event === "Finished") {
          onProgress?.(total ?? received, total);
        }
      });
      // Most Windows installers (NSIS/MSI) close + relaunch the app themselves,
      // but explicit relaunch is harmless and covers the edge case.
      await relaunch();
    },
  };
}

export async function getAppVersion(): Promise<string> {
  return await getVersion();
}

export interface ImportTemplatesResult {
  added: number;
  /** Number of duplicates whose content was replaced by the import file
   *  (only nonzero when called with `overwrite = true`). */
  overwritten: number;
  /** Number of duplicates left untouched (nonzero only when `overwrite = false`). */
  skipped: number;
  templates: Template[];
}

export async function importTemplates(
  path: string,
  overwrite: boolean,
): Promise<ImportTemplatesResult> {
  return await invoke<ImportTemplatesResult>("import_templates", { path, overwrite });
}

export interface BackupEntry {
  name: string;
  timestamp_secs: number;
  size: number;
}

export async function listTemplateBackups(): Promise<BackupEntry[]> {
  return await invoke<BackupEntry[]>("list_template_backups");
}

export async function restoreTemplateBackup(name: string): Promise<AppData> {
  return await invoke<AppData>("restore_template_backup", { name });
}