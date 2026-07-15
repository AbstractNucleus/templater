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
 *  (`MainPanel`) and the new-template form. The hosting component owns
 *  id/timestamps/history/etc. */
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
}

export type Theme = "dark" | "light";

export type Mode = "editor" | "user";

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
  /** Per-template placeholder fill-ins. Outer key: template id; inner: var → value. */
  placeholder_values: Record<string, Record<string, string>>;
  /** "recent" sorts non-pinned by last_used_at; "manual" preserves drag order. */
  sort_mode: SortMode;
  /** Persisted tag order from drag-reorder. Tags absent here fall back to count-desc. */
  tag_order: string[];
  onboarding_complete: boolean;
  /** Global snippet variables expanded at copy time alongside {{date}}/{{time}}.
   *  Key = placeholder name (e.g. "me_name"), value = literal expansion. */
  snippets: Record<string, string>;
}

export const DEFAULT_COLUMN_WIDTHS: ColumnWidths = {
  tags: 180,
  templates: 260,
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
  placeholder_values: {},
  sort_mode: "recent",
  tag_order: [],
  onboarding_complete: false,
  snippets: {},
};