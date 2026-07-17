// Dev-only Tauri IPC mock so the full UI runs in a plain browser
// (`npm run dev`, open http://localhost:1420) for fast visual iteration.
// Never shipped: the only import site (+layout.ts) is guarded by
// `import.meta.env.DEV`, so production builds dead-code-eliminate the dynamic
// import. Inside the real Tauri webview `__TAURI_INTERNALS__` already exists
// and the layout guard skips installation entirely.
//
// `?fresh=1` simulates a first run: load_app_data returns null, so the app
// seeds starter templates and shows the onboarding tour.
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { starterTemplates } from "./starterTemplates";
import { DEFAULT_SETTINGS, type AppData, type Template } from "./types";

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

export function installDevMocks(): void {
  const fresh = new URLSearchParams(window.location.search).has("fresh");
  let data: AppData | null = fresh ? null : seedData();

  mockWindows("main");
  mockIPC(
    async (cmd, payload) => {
      const args = (payload ?? {}) as Record<string, unknown>;
      switch (cmd) {
        // ---- store -----------------------------------------------------
        case "load_app_data":
          return data;
        case "save_app_data":
          data = args.data as AppData;
          return null;
        case "list_template_backups":
          return [1, 2, 3].map((n) => ({
            name: `templates.json.bak.${Math.floor(Date.now() / 1000) - n * 86_400}`,
            timestamp_secs: Math.floor(Date.now() / 1000) - n * 86_400,
            size: 48_120 - n * 900,
          }));
        case "restore_template_backup":
          return data ?? seedData();
        case "import_templates":
          return { added: 0, overwritten: 0, skipped: 0, templates: data?.templates ?? [] };
        case "export_templates":
        case "export_templates_subset":
          return ((args.ids as string[] | undefined)?.length ?? data?.templates.length) ?? 0;
        case "bulk_delete_templates": {
          const ids = new Set(args.ids as string[]);
          if (data) data = { ...data, templates: data.templates.filter((t) => !ids.has(t.id)) };
          return data?.templates ?? [];
        }
        case "bulk_add_template_tag": {
          const ids = new Set(args.ids as string[]);
          const tag = args.tag as string;
          if (data)
            data = {
              ...data,
              templates: data.templates.map((t) =>
                ids.has(t.id) && !t.tags.includes(tag) ? { ...t, tags: [...t.tags, tag] } : t,
              ),
            };
          return data?.templates ?? [];
        }
        case "bulk_remove_template_tag": {
          const ids = new Set(args.ids as string[]);
          const tag = args.tag as string;
          if (data)
            data = {
              ...data,
              templates: data.templates.map((t) =>
                ids.has(t.id) ? { ...t, tags: t.tags.filter((x) => x !== tag) } : t,
              ),
            };
          return data?.templates ?? [];
        }

        // ---- window/shell commands (no-ops in a browser) ---------------
        case "set_hotkey":
        case "open_data_dir":
        case "open_path":
        case "reset_window_position":
        case "export_template":
        case "open_translator_window":
        case "close_translator_window":
          return null;

        case "is_translator_open":
          return false;

        case "translate_text": {
          const text = args.text as string;
          await sleep(600);
          return `[DEV MOCK] Translated to English:\n\n${text}`;
        }

        // ---- plugins ---------------------------------------------------
        case "plugin:clipboard-manager|write_text":
          try {
            await navigator.clipboard.writeText(args.text as string);
          } catch {
            /* browser clipboard needs focus; treat as success anyway */
          }
          return null;
        case "plugin:clipboard-manager|read_text":
          return "Hey Noel — quick one: a player is asking why their withdrawable balance is lower than their total balance after claiming the casino bonus. Can you send the usual explanation?";
        case "plugin:dialog|open": {
          const opts = (args.options ?? {}) as { directory?: boolean };
          return opts.directory ? "C:\\dev-mock\\notes-extra" : null;
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