/** Snapshot of a template body/opening/tags saved before an edit. Capped to
 *  TEMPLATE_HISTORY_CAP entries in app code so storage stays bounded. */
export interface TemplateVersion {
  /** ISO-8601 timestamp of when this revision was REPLACED (i.e. the save
   *  that created this snapshot). */
  saved_at: string;
  opening: string;
  body: string;
  tags: string[];
}

export const TEMPLATE_HISTORY_CAP = 10;

export interface Template {
  id: string;
  name: string;
  tags: string[];
  opening: string;
  body: string;
  created_at: string;
  updated_at: string;
  pinned: boolean;
  /** ISO-8601 timestamp of the last copy-to-clipboard, or null if never. */
  last_used_at: string | null;
  /** Lifetime copy count. Surfaced in the sidebar sort menu. */
  copy_count: number;
  /** Optional grouping name. Templates with the same non-null value render
   *  inside a collapsible folder header in the sidebar. */
  folder: string | null;
  /** Newest-last ring of prior versions. Each entry was the template's
   *  opening+body+tags at the time of the save that replaced it. */
  history: TemplateVersion[];
}

/** The editable subset of a template. Shared between the inline edit form
 *  (`MainPanel`) and the new-template form (replaces the old `SaveAsModal`
 *  popup). The hosting component owns id/timestamps/history/etc. */
export interface TemplateDraft {
  name: string;
  tags: string[];
  opening: string;
  body: string;
  folder: string | null;
}

export interface WindowGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ColumnWidths {
  tags: number;
  templates: number;
  agent: number;
  context: number;
}

export type Theme = "dark" | "light";

export type Mode = "editor" | "user";

export type PasteBackend = "agent" | "api";

/** Selectable model tier. Resolved to a concrete model id in the sidecar. */
export type ModelTier = "haiku" | "sonnet" | "opus";

/** Per-task model choice. `context` covers both ingest summaries and the
 *  relevance picker — the two background context-pipeline steps. */
export interface ModelSettings {
  rank: ModelTier;
  edit: ModelTier;
  adapt: ModelTier;
  memory: ModelTier;
  context: ModelTier;
}

/** Dropdown options, in display order. Hints describe the speed/cost tradeoff. */
export const MODEL_TIERS: { value: ModelTier; label: string; hint: string }[] = [
  { value: "haiku", label: "Haiku", hint: "Fastest, lightest" },
  { value: "sonnet", label: "Sonnet", hint: "Balanced" },
  { value: "opus", label: "Opus", hint: "Most capable, slowest" },
];

export const DEFAULT_MODEL_SETTINGS: ModelSettings = {
  rank: "haiku",
  edit: "haiku",
  adapt: "sonnet",
  memory: "haiku",
  context: "haiku",
};

export type SortMode = "manual" | "recent" | "most_used" | "never_used";

export interface Settings {
  always_on_top_default: boolean;
  global_hotkey: string;
  start_minimised_to_tray: boolean;
  window_geometry: WindowGeometry | null;
  close_hint_shown: boolean;
  global_signature: string;
  theme: Theme;
  mode: Mode;
  zoom: number;
  column_widths: ColumnWidths;
  /** Master switch for every Claude-powered feature. When false, no AI
   *  surface renders: paste-match ranking, agent sidebar, adapt, context
   *  sources, and memory capture are all hidden. */
  ai_enabled: boolean;
  paste_backend: PasteBackend;
  /** Per-task Claude model tier (resolved to a concrete id in the sidecar). */
  models: ModelSettings;
  /** Per-template placeholder fill-ins. Outer key: template id; inner: var → value. */
  placeholder_values: Record<string, Record<string, string>>;
  /** "recent" sorts non-pinned by last_used_at; "manual" preserves drag order. */
  sort_mode: SortMode;
  /** Persisted tag order from drag-reorder. Tags absent here fall back to count-desc. */
  tag_order: string[];
  onboarding_complete: boolean;
  /** Absolute paths to folders the AI may consult during adapt + edit. */
  context_sources: string[];
  /** Whether the context pane was open in the previous session. */
  context_open: boolean;
  /** Global snippet variables expanded at copy time alongside {{date}}/{{time}}.
   *  Key = placeholder name (e.g. "me_name"), value = literal expansion. */
  snippets: Record<string, string>;
  /** Optional second global hotkey. When set, fires a "quick capture" flow:
   *  reads the clipboard and opens the new-template form with body
   *  pre-filled. Null disables the feature. */
  quick_capture_hotkey: string | null;
}

export const DEFAULT_COLUMN_WIDTHS: ColumnWidths = {
  tags: 180,
  templates: 260,
  agent: 340,
  context: 360,
};

export interface AppData {
  version: number;
  templates: Template[];
  settings: Settings;
}

export const DEFAULT_SETTINGS: Settings = {
  always_on_top_default: false,
  global_hotkey: "Ctrl+Shift+Backslash",
  start_minimised_to_tray: false,
  window_geometry: null,
  close_hint_shown: false,
  global_signature: "",
  theme: "dark",
  mode: "editor",
  zoom: 1,
  column_widths: DEFAULT_COLUMN_WIDTHS,
  ai_enabled: false,
  paste_backend: "agent",
  models: DEFAULT_MODEL_SETTINGS,
  placeholder_values: {},
  sort_mode: "recent",
  tag_order: [],
  onboarding_complete: false,
  context_sources: [],
  context_open: false,
  snippets: {},
  quick_capture_hotkey: null,
};
