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
import { emit } from "@tauri-apps/api/event";
import { mockTemplates } from "./mocks";
import { DEFAULT_SETTINGS, type AppData, type Template } from "./types";

const DELAY_RANK_MS = 900;
const DELAY_EDIT_MS = 1400;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function daysAgo(n: number): string {
  return new Date(Date.now() - n * 86_400_000).toISOString();
}

// Enrich the flat CSV seed so every UI state has something to render:
// folders, pins, usage stats, placeholders, and version history.
function seedData(): AppData {
  const templates: Template[] = mockTemplates.map((t, i) => {
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
      ai_enabled: true,
      onboarding_complete: true,
      close_hint_shown: true,
      global_signature: "Best regards,\nNoel",
      snippets: { me_name: "Noel" },
      context_sources: ["C:\\dev-mock\\notes"],
    },
  };
}

interface ContextFileSeed {
  name: string;
  ext: string;
  summary: string;
  tags: string[];
  status: "ingested" | "failed" | "pending";
  error: string | null;
}

const CONTEXT_FILES: ContextFileSeed[] = [
  {
    name: "tone-guide.md",
    ext: "md",
    summary: "House style for support replies — tone, sign-offs, escalation wording.",
    tags: ["style", "support"],
    status: "ingested",
    error: null,
  },
  {
    name: "promotions-2026.xlsx",
    ext: "xlsx",
    summary: "Current promotion calendar with bonus terms per product.",
    tags: ["promotions", "bonuses"],
    status: "ingested",
    error: null,
  },
  {
    name: "kyc-policy.pdf",
    ext: "pdf",
    summary: "KYC escalation policy: when to route players to the VIP desk.",
    tags: ["kyc", "policy"],
    status: "ingested",
    error: null,
  },
  {
    name: "legacy-notes.pdf",
    ext: "pdf",
    summary: "",
    tags: [],
    status: "failed",
    error: "text extraction failed: encrypted PDF",
  },
  // The capture-memory flow polls for this exact file, so it must exist for
  // the "Indexing… → Indexed" badge to resolve.
  {
    name: "memories.md",
    ext: "md",
    summary: "Captured memories: durable signals distilled from Slack threads and emails.",
    tags: ["memories"],
    status: "ingested",
    error: null,
  },
];

function contextFiles(root: string) {
  return CONTEXT_FILES.map((f, i) => ({
    path: `${root}\\${f.name}`,
    source_root: root,
    ext: f.ext,
    mtime_ms: Date.now() - i * 3_600_000,
    size_bytes: 12_000 + i * 4_500,
    summary: f.summary,
    tags: f.tags,
    status: f.status,
    error: f.error,
    ingested_at: f.status === "ingested" ? Date.now() - i * 3_600_000 : null,
  }));
}

function contextStatus(sources: string[]) {
  return {
    sources: sources.map((path) => ({
      path,
      file_count: CONTEXT_FILES.length,
      ingested_count: CONTEXT_FILES.filter((f) => f.status === "ingested").length,
      failed_count: CONTEXT_FILES.filter((f) => f.status === "failed").length,
      pending_count: CONTEXT_FILES.filter((f) => f.status === "pending").length,
      last_ingested_at: Date.now() - 1_800_000,
      exists: true,
    })),
    in_flight: 0,
  };
}

// Naive lexical overlap so paste-match returns plausible, stable rankings.
function rankCatalog(pasted: string, catalog: { id: string; name: string; body: string }[]) {
  const words = new Set(
    pasted
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 3),
  );
  return catalog
    .map((t) => {
      const hay = `${t.name} ${t.body}`.toLowerCase();
      let hits = 0;
      for (const w of words) if (hay.includes(w)) hits++;
      return { template_id: t.id, score: hits / Math.max(words.size, 1) };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 8)
    .map((r, i) => ({ ...r, score: Math.max(0.15, Math.min(0.97, r.score + 0.4 - i * 0.06)) }));
}

function fakeEdit(draft: { opening: string; body: string }, prompt: string) {
  const p = prompt.toLowerCase();
  let body = draft.body;
  if (p.includes("short")) {
    const lines = body.split("\n").filter((l) => l.trim().length > 0);
    body = lines.slice(0, Math.max(2, Math.ceil(lines.length / 2))).join("\n");
  } else if (p.includes("formal")) {
    body = body.replace(/\bThanks\b/g, "Thank you").replace(/\bfeel free to\b/gi, "please do not hesitate to");
  } else {
    body = `${body}\n\n(Dev mock applied: "${prompt}")`;
  }
  return {
    reasoning: `Dev mock: applied "${prompt}" to the draft. In the packaged app this comes from Claude.`,
    updated: { opening: draft.opening, body },
  };
}

async function streamEditProgress(result: { reasoning: string; updated: { opening: string; body: string } }) {
  const full = JSON.stringify(result);
  for (const fraction of [0.2, 0.45, 0.7, 0.9]) {
    await sleep(DELAY_EDIT_MS / 5);
    void emit("sidecar-progress", { id: "dev", progress: { text: full.slice(0, Math.floor(full.length * fraction)) } });
  }
  await sleep(DELAY_EDIT_MS / 5);
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
        case "get_env_warnings":
          return { api_key_override: false };
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

        // ---- AI ops ----------------------------------------------------
        case "rank_templates":
          await sleep(DELAY_RANK_MS);
          return { ok: true, rankings: rankCatalog(args.pasted as string, args.catalog as never) };
        case "edit_template": {
          const result = fakeEdit(args.draft as never, args.prompt as string);
          await streamEditProgress(result);
          return { ok: true, ...result };
        }
        case "adapt_template": {
          const result = fakeEdit(args.draft as never, `adapt to: ${String(args.inbound).slice(0, 60)}…`);
          await streamEditProgress(result);
          return {
            ok: true,
            ...result,
            context_used: [
              {
                path: "C:\\dev-mock\\notes\\tone-guide.md",
                summary: CONTEXT_FILES[0].summary,
                reason: "Matches the requested tone adjustments.",
              },
            ],
          };
        }

        // ---- context corpus -------------------------------------------
        case "context_set_sources":
        case "context_rescan":
        case "context_status":
          return { ok: true, status: contextStatus(data?.settings.context_sources ?? []) };
        case "context_list_files":
          return {
            ok: true,
            files: (data?.settings.context_sources ?? []).flatMap((s) => contextFiles(s)),
          };
        case "context_read_file":
          return {
            ok: true,
            path: args.path,
            text: `# ${String(args.path).split("\\").pop()}\n\nDev-mock file contents. In the packaged app this shows the extracted text of the real file.`,
            truncated: false,
          };
        case "context_search": {
          const q = String(args.query ?? "").toLowerCase();
          const files = (data?.settings.context_sources ?? []).flatMap((s) => contextFiles(s));
          return {
            ok: true,
            files: files
              .filter((f) => f.status === "ingested")
              .filter((f) => q.length === 0 || `${f.summary} ${f.tags.join(" ")} ${f.path}`.toLowerCase().includes(q))
              .map((f) => ({ ...f, score: 0.8 })),
          };
        }
        case "context_capture_memory":
          await sleep(800);
          return {
            ok: true,
            appendedTo: `${String(args.source)}\\memories.md`,
            signal: "Player-facing bonus terms changed on 1 March; older templates that cite the 150% welcome bonus need review.",
            title: "Bonus terms changed 1 March",
          };
        case "get_sidecar_diagnostics":
          return {
            state: "active",
            state_reason: null,
            entries: [
              { op: "rank", started_at_ms: Date.now() - 60_000, duration_ms: 1180, ok: true, error: null },
              { op: "edit-template", started_at_ms: Date.now() - 32_000, duration_ms: 4900, ok: true, error: null },
              { op: "rank", started_at_ms: Date.now() - 8_000, duration_ms: 1320, ok: false, error: "sidecar request timed out" },
            ],
            stats: [
              { op: "rank", count: 14, p50: 1150, p95: 2400, fail: 1 },
              { op: "edit-template", count: 3, p50: 4200, p95: 6100, fail: 0 },
            ],
          };

        // ---- window/shell commands (no-ops in a browser) ---------------
        case "set_hotkey":
        case "set_quick_capture_hotkey":
        case "open_data_dir":
        case "open_path":
        case "open_claude_login":
        case "reset_window_position":
        case "export_template":
          return null;

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
