import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { AppData, PasteBackend, Template } from "./types";

export async function loadAppData(): Promise<AppData | null> {
  return await invoke<AppData | null>("load_app_data");
}

export async function saveAppData(data: AppData): Promise<void> {
  await invoke<void>("save_app_data", { data });
}

export async function getEnvWarnings(): Promise<{ api_key_override: boolean }> {
  return await invoke("get_env_warnings");
}

export async function setHotkey(accelerator: string): Promise<void> {
  await invoke<void>("set_hotkey", { accelerator });
}

export async function openDataDir(): Promise<void> {
  await invoke<void>("open_data_dir");
}

export async function exportTemplates(path: string): Promise<number> {
  return await invoke<number>("export_templates", { path });
}

export async function exportTemplate(id: string, path: string): Promise<void> {
  await invoke<void>("export_template", { id, path });
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
  skipped: number;
  templates: Template[];
}

export async function importTemplates(path: string): Promise<ImportTemplatesResult> {
  return await invoke<ImportTemplatesResult>("import_templates", { path });
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

export interface Ranking {
  template_id: string;
  score: number;
}

interface RankResponse {
  ok: boolean;
  rankings?: Ranking[];
  error?: string;
}

export async function rankTemplates(
  pasted: string,
  catalog: Template[],
  backend: PasteBackend,
): Promise<Ranking[]> {
  const res = await invoke<RankResponse>("rank_templates", { pasted, catalog, backend });
  if (!res.ok) throw new Error(res.error ?? "rank failed");
  return res.rankings ?? [];
}

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

export interface EditedDraft {
  opening: string;
  body: string;
}

interface EditResponse {
  ok: boolean;
  reasoning?: string;
  updated?: EditedDraft;
  error?: string;
}

export async function editTemplate(
  draft: EditedDraft,
  history: ChatTurn[],
  prompt: string,
  backend: PasteBackend,
): Promise<{ reasoning: string; updated: EditedDraft }> {
  const res = await invoke<EditResponse>("edit_template", { draft, history, prompt, backend });
  if (!res.ok || !res.updated) {
    throw new Error(res.error ?? "edit failed");
  }
  return { reasoning: res.reasoning ?? "", updated: res.updated };
}

export async function adaptTemplate(
  draft: EditedDraft,
  inbound: string,
  backend: PasteBackend,
): Promise<{ reasoning: string; updated: EditedDraft }> {
  const res = await invoke<EditResponse>("adapt_template", { draft, inbound, backend });
  if (!res.ok || !res.updated) {
    throw new Error(res.error ?? "adapt failed");
  }
  return { reasoning: res.reasoning ?? "", updated: res.updated };
}

export interface DiagEntry {
  op: string;
  started_at_ms: number;
  duration_ms: number;
  ok: boolean;
  error: string | null;
}

export interface SidecarDiagnostics {
  state: "active" | "unavailable";
  state_reason: string | null;
  entries: DiagEntry[];
}

export async function getSidecarDiagnostics(): Promise<SidecarDiagnostics> {
  return await invoke<SidecarDiagnostics>("get_sidecar_diagnostics");
}

export async function openClaudeLogin(): Promise<void> {
  await invoke<void>("open_claude_login");
}

/**
 * Subscribe to streaming sidecar progress events. The sidecar emits these for
 * agent edits — accumulated partial text as the model writes its structured
 * output (JSON chunks). Returns an unlisten function.
 */
export function onSidecarProgress(handler: (text: string) => void): Promise<UnlistenFn> {
  return listen<{ id: string; progress: { text: string } }>("sidecar-progress", (event) => {
    handler(event.payload.progress.text);
  });
}

export function explainRankError(raw: string): string {
  const lower = raw.toLowerCase();
  if (lower.includes("not authenticated") || lower.includes("login") || lower.includes("unauthorized") || lower.includes("401")) {
    return "Not signed in. Run `claude login` in a terminal to enable paste-match.";
  }
  if (lower.includes("quota") || lower.includes("rate limit") || lower.includes("429")) {
    return "Agent SDK quota exhausted. Check your Claude subscription plan.";
  }
  if (lower.includes("network") || lower.includes("econnref") || lower.includes("enotfound") || lower.includes("timeout")) {
    return "Network error. Check your connection and retry.";
  }
  if (lower.includes("sidecar unavailable")) {
    return "Paste-match unavailable. Install Node 18+ and restart the app.";
  }
  if (lower.includes("sidecar closed") || lower.includes("sidecar write")) {
    return "Sidecar process is down. Restart the app.";
  }
  return raw;
}
