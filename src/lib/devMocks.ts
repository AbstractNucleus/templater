// Dev-only Tauri IPC mock so the full UI runs in a plain browser
// (`npm run dev`, open http://localhost:1420) for fast visual iteration.
// Never shipped: the only import site (+layout.ts) is guarded by
// `import.meta.env.DEV`, so production builds dead-code-eliminate the dynamic
// import. Inside the real Tauri webview `__TAURI_INTERNALS__` already exists
// and the layout guard skips installation entirely.
//
// `?fresh=1` simulates a first run: load_app_data returns { status: "empty" }, so the app
// seeds starter templates and shows the onboarding tour.
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { starterTemplates } from "./starterTemplates";
import {
  DEFAULT_SETTINGS,
  type AppData,
  type LoadAppDataResult,
  type Settings,
  type Template,
} from "./types";

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function daysAgo(n: number): string {
  return new Date(Date.now() - n * 86_400_000).toISOString();
}

// Enrich the flat CSV seed so every UI state has something to render:
// folders, pins, usage stats, placeholders, and version history.
function seedData(): AppData {
  const templates: Template[] = starterTemplates.map((t, i) => {
    const next = { ...t, history: [...t.history] };
    if (t.tags.includes("poker")) next.folder = "Poker FAQ";
    if (t.tags.includes("jm")) next.folder = "Sportsbook";
    if (i % 3 === 0) {
      next.copy_count = ((i * 7) % 40) + 1;
      next.last_used_at = daysAgo((i % 14) + 1);
    }
    return next;
  });
  templates[0].pinned = true;
  templates[5].pinned = true;
  templates[1].history = [
    { saved_at: daysAgo(9), opening: "Hi,", body: "Older draft of this reply.", tags: ["poker"] },
    { saved_at: daysAgo(3), opening: "Hello,", body: "Slightly newer draft of this reply.", tags: ["poker"] },
  ];
  templates.push({
    id: "tpl-dev-placeholders",
    name: "Follow-up with placeholders",
    tags: ["networking"],
    opening: "Hi {{name}},",
    body:
      "Great speaking with you on {{date:long}}. As discussed, I'll send the {{choice:proposal|contract|deck}} by {{time}}.\n\nLooking forward to it, {{name}}!",
    created_at: daysAgo(20),
    updated_at: daysAgo(2),
    pinned: false,
    last_used_at: daysAgo(1),
    copy_count: 12,
    folder: null,
    history: [],
  });
  return {
    version: 1,
    templates,
    settings: {
      ...DEFAULT_SETTINGS,
      onboarding_complete: true,
      close_hint_shown: true,
      global_signature: "Best regards,\nNoel",
      snippets: { me_name: "Noel" },
    },
  };
}

type DialogOpenOpts = { directory?: boolean };
type SaveAppPayload = { data: { templates: Template[]; settings: Settings } };
type ExportPayload = { path?: string; templates?: Template[] };
type BackupPayload = { name?: string };
type TranslatePayload = { text?: string };
type ClipboardPayload = { text?: string };
type DialogPayload = { options?: DialogOpenOpts };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

export function installDevMocks(): void {
  const fresh = new URLSearchParams(window.location.search).has("fresh");
  let data: AppData | null = fresh ? null : seedData();

  mockWindows("main");
  mockIPC(
    async (cmd, payload) => {
      switch (cmd) {
        // ---- store -----------------------------------------------------
        case "load_app_data": {
          const result: LoadAppDataResult = data
            ? { status: "ready", data }
            : { status: "empty" };
          return result;
        }
        case "save_app_data": {
          const args = (isRecord(payload) ? payload : {}) as SaveAppPayload;
          if (args.data) {
            data = {
              version: data?.version ?? 1,
              templates: args.data.templates,
              settings: args.data.settings,
            };
          }
          return null;
        }
        case "save_catalog": {
          const args = (isRecord(payload) ? payload : {}) as {
            data?: {
              templates: Template[];
              placeholder_values: Settings["placeholder_values"];
              tag_order: string[];
              sort_mode: Settings["sort_mode"];
            };
          };
          if (args.data && data) {
            data = {
              ...data,
              templates: args.data.templates,
              settings: {
                ...data.settings,
                placeholder_values: args.data.placeholder_values,
                tag_order: args.data.tag_order,
                sort_mode: args.data.sort_mode,
              },
            };
          } else if (args.data) {
            data = {
              version: 1,
              templates: args.data.templates,
              settings: {
                ...DEFAULT_SETTINGS,
                placeholder_values: args.data.placeholder_values,
                tag_order: args.data.tag_order,
                sort_mode: args.data.sort_mode,
              },
            };
          }
          return null;
        }
        case "save_preferences": {
          const args = (isRecord(payload) ? payload : {}) as {
            preferences?: Omit<Settings, "placeholder_values" | "tag_order" | "sort_mode">;
          };
          if (args.preferences) {
            const meta = data
              ? {
                  placeholder_values: data.settings.placeholder_values,
                  tag_order: data.settings.tag_order,
                  sort_mode: data.settings.sort_mode,
                }
              : {
                  placeholder_values: DEFAULT_SETTINGS.placeholder_values,
                  tag_order: DEFAULT_SETTINGS.tag_order,
                  sort_mode: DEFAULT_SETTINGS.sort_mode,
                };
            data = {
              version: data?.version ?? 1,
              templates: data?.templates ?? [],
              settings: { ...args.preferences, ...meta },
            };
          }
          return null;
        }
        case "reset_corrupt_settings":
          if (data) {
            data = { ...data, settings: { ...DEFAULT_SETTINGS } };
          }
          return null;
        case "list_template_backups":
          return [1, 2, 3].map((n) => ({
            name: `catalog.json.bak.${Math.floor(Date.now() / 1000) - n * 86_400}`,
            timestamp_secs: Math.floor(Date.now() / 1000) - n * 86_400,
            size: 48_120 - n * 900,
          }));
        case "read_template_backup": {
          const args = (isRecord(payload) ? payload : {}) as BackupPayload;
          void args.name;
          return data?.templates ?? [];
        }
        case "read_templates_export":
          return data?.templates ?? [];
        case "export_templates": {
          const args = (isRecord(payload) ? payload : {}) as ExportPayload;
          return args.templates?.length ?? data?.templates.length ?? 0;
        }

        // ---- window/shell commands (no-ops in a browser) ---------------
        case "set_hotkey":
        case "open_data_dir":
        case "open_path":
        case "reset_window_position":
        case "set_satellite":
          return null;

        case "is_satellite":
          return false;

        case "translate_text": {
          const args = (isRecord(payload) ? payload : {}) as TranslatePayload;
          const text = args.text ?? "";
          await sleep(600);
          return `[DEV MOCK] Translated to English:\n\n${text}`;
        }

        // ---- plugins ---------------------------------------------------
        case "plugin:clipboard-manager|write_text": {
          const args = (isRecord(payload) ? payload : {}) as ClipboardPayload;
          try {
            if (args.text) await navigator.clipboard.writeText(args.text);
          } catch {
            /* browser clipboard needs focus; treat as success anyway */
          }
          return null;
        }
        case "plugin:clipboard-manager|read_text":
          return "Hey Noel — quick one: a player is asking why their withdrawable balance is lower than their total balance after claiming the casino bonus. Can you send the usual explanation?";
        case "plugin:dialog|open": {
          const args = (isRecord(payload) ? payload : {}) as DialogPayload;
          return args.options?.directory ? "C:\\dev-mock\\notes-extra" : null;
        }
        case "plugin:dialog|save":
          return null; // behave like a cancelled save dialog
        case "plugin:updater|check":
          await sleep(700);
          return null; // "already up to date"
        case "plugin:app|version":
          return "0.7.0";
        case "plugin:window|is_always_on_top":
          return false;
        default:
          if (!cmd.startsWith("plugin:")) {
            console.warn(`[devMocks] unhandled command: ${cmd}`, payload);
          }
          return null;
      }
    },
    { shouldMockEvents: true },
  );

  console.info("[devMocks] Tauri IPC mocked — browser preview mode. Append ?fresh=1 for the first-run flow.");
}
