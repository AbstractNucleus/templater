import { invoke } from "@tauri-apps/api/core";
import type { AppData, Template } from "./types";

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

export function makeBlankTemplate(): Template {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    name: "Untitled",
    tags: [],
    opening: "",
    body: "",
    created_at: now,
    updated_at: now,
  };
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
): Promise<Ranking[]> {
  const res = await invoke<RankResponse>("rank_templates", { pasted, catalog });
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
): Promise<{ reasoning: string; updated: EditedDraft }> {
  const res = await invoke<EditResponse>("edit_template", { draft, history, prompt });
  if (!res.ok || !res.updated) {
    throw new Error(res.error ?? "edit failed");
  }
  return { reasoning: res.reasoning ?? "", updated: res.updated };
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
  if (lower.includes("sidecar closed") || lower.includes("sidecar write")) {
    return "Sidecar process is down. Restart the app.";
  }
  return raw;
}
