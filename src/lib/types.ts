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
}

export type Theme = "dark" | "light";

export type Mode = "editor" | "user";

export type PasteBackend = "agent" | "api";

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
  paste_backend: PasteBackend;
  /** Per-template placeholder fill-ins. Outer key: template id; inner: var → value. */
  placeholder_values: Record<string, Record<string, string>>;
}

export const DEFAULT_COLUMN_WIDTHS: ColumnWidths = {
  tags: 180,
  templates: 260,
  agent: 340,
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
  paste_backend: "agent",
  placeholder_values: {},
};
