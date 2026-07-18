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

export async function restoreTemplateBackup(name: string): Promise<AppData> {
  return await invoke<AppData>("restore_template_backup", { name });
}

export async function openPreviewWindow(): Promise<void> {
  await invoke<void>("open_preview_window");
}

export async function closePreviewWindow(): Promise<void> {
  await invoke<void>("close_preview_window");
}

export async function isPreviewOpen(): Promise<boolean> {
  return await invoke<boolean>("is_preview_open");
}

export async function openTranslatorWindow(): Promise<void> {
  await invoke<void>("open_translator_window");
}

export async function closeTranslatorWindow(): Promise<void> {
  await invoke<void>("close_translator_window");
}

export async function isTranslatorOpen(): Promise<boolean> {
  return await invoke<boolean>("is_translator_open");
}

export async function translateText(text: string, apiKey: string, model: string): Promise<string> {
  return await invoke<string>("translate_text", { text, apiKey, model });
}