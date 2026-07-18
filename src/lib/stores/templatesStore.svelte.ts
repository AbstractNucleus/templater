import { save as saveDialog, open as openDialog } from "@tauri-apps/plugin-dialog";
import {
  loadAppData,
  saveAppData,
  exportTemplate,
  exportTemplates,
  exportTemplatesSubset,
  bulkAddTemplateTag,
  bulkDeleteTemplates,
  bulkRemoveTemplateTag,
  importTemplates,
  restoreTemplateBackup,
} from "$lib/api";
import { starterTemplates } from "$lib/starterTemplates";
import { normalizeTag } from "$lib/tags";
import {
  DEFAULT_SETTINGS,
  TEMPLATE_HISTORY_CAP,
  type Settings,
  type Template,
  type TemplateVersion,
} from "$lib/types";

const DATA_VERSION = 1;
const MAX_UNDO = 20;

interface UndoSnapshot {
  templates: Template[];
  placeholderValues: Record<string, Record<string, string>>;
  label: string;
}

function omitKey<T extends object>(obj: T, key: string): T {
  const copy = { ...obj } as Record<string, unknown>;
  delete copy[key];
  return copy as T;
}

function dedupe(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    if (seen.has(item)) continue;
    seen.add(item);
    out.push(item);
  }
  return out;
}

function pushHistorySnapshot(cur: Template, savedAt: string): TemplateVersion[] {
  if (cur.opening.length === 0 && cur.body.length === 0 && cur.tags.length === 0) return cur.history;
  const snapshot = { saved_at: savedAt, opening: cur.opening, body: cur.body, tags: [...cur.tags] };
  const next = [...cur.history, snapshot];
  return next.length > TEMPLATE_HISTORY_CAP ? next.slice(-TEMPLATE_HISTORY_CAP) : next;
}

class TemplatesStore {
  templates = $state<Template[]>([]);
  settings = $state<Settings>({ ...DEFAULT_SETTINGS });
  loaded = $state(false);
  loadError = $state<string | null>(null);
  undoToast = $state<string | null>(null);

  // Only permit writes after the initial load (or deliberate first-run bootstrap) succeeds.
  // This prevents an IPC/load failure from overwriting existing data with an empty list.
  #loadSucceeded = $state(false);

  #undoStack: UndoSnapshot[] = $state([]);
  #undoToastTimer: ReturnType<typeof setTimeout> | null = null;

  get isEditorMode(): boolean {
    return this.settings.mode === "editor";
  }

  /** Initial load. Returns the on-disk record (or null for fresh installs)
   *  so the caller can react to first-run state. */
  async load(): Promise<void> {
    try {
      const data = await loadAppData();
      if (data === null) {
        this.templates = starterTemplates;
        this.settings = { ...DEFAULT_SETTINGS };
        await saveAppData({
          version: DATA_VERSION,
          templates: starterTemplates,
          settings: this.settings,
        });
      } else {
        this.templates = data.templates;
        this.settings = data.settings;
        // Existing users who dismissed the legacy "minimises to tray" banner
        // shouldn't be surprised by the new onboarding tour. Auto-graduate
        // them so the tour only fires for genuinely fresh installs.
        if (this.settings.close_hint_shown && !this.settings.onboarding_complete) {
          this.settings = { ...this.settings, onboarding_complete: true };
          await saveAppData({
            version: DATA_VERSION,
            templates: this.templates,
            settings: this.settings,
          });
        }
      }
      this.#loadSucceeded = true;
    } catch (e) {
      // Surface the error and leave templates empty — DON'T fall back to
      // starter templates here. Any subsequent persist would overwrite the
      // user's (presumably recoverable) on-disk file with the starter set.
      this.loadError = String(e);
    } finally {
      this.loaded = true;
    }
  }

  async persist(
    nextTemplates: Template[],
    nextSettings: Settings = this.settings,
  ): Promise<void> {
    if (!this.#loadSucceeded) {
      this.loadError = "save blocked: initial data load did not complete";
      return;
    }
    // Rust's ColumnWidths is u32. Pointer events emit fractional pixel deltas
    // on high-DPI displays, so coerce here as the last line of defence before
    // serde rejects the save with "expected u32".
    const cw = nextSettings.column_widths;
    const safeSettings: Settings = {
      ...nextSettings,
      column_widths: {
        tags: Math.round(cw.tags),
        templates: Math.round(cw.templates),
      },
    };
    this.templates = nextTemplates;
    this.settings = safeSettings;
    try {
      await saveAppData({
        version: DATA_VERSION,
        templates: nextTemplates,
        settings: safeSettings,
      });
    } catch (e) {
      this.loadError = `save failed: ${e}`;
    }
  }

  pushUndo(label: string): void {
    const snapshot: UndoSnapshot = {
      templates: [...this.templates],
      placeholderValues: { ...this.settings.placeholder_values },
      label,
    };
    this.#undoStack = [...this.#undoStack.slice(-(MAX_UNDO - 1)), snapshot];
  }

  async performUndo(): Promise<void> {
    if (this.#undoStack.length === 0) return;
    const snap = this.#undoStack[this.#undoStack.length - 1];
    this.#undoStack = this.#undoStack.slice(0, -1);
    await this.persist(snap.templates, {
      ...this.settings,
      placeholder_values: snap.placeholderValues,
    });
    this.#showUndoToast(`Undid ${snap.label}`);
  }

  #showUndoToast(msg: string): void {
    this.undoToast = msg;
    if (this.#undoToastTimer) clearTimeout(this.#undoToastTimer);
    this.#undoToastTimer = setTimeout(() => (this.undoToast = null), 2000);
  }

  async handleSave(updated: Template): Promise<void> {
    if (!this.isEditorMode) return;
    this.pushUndo("edit");
    // Snapshot the pre-edit opening+body+tags so per-template history can revert.
    // Only when something actually changed — otherwise a no-op save would
    // shove an identical entry into the ring.
    const prior = this.templates.find((t) => t.id === updated.id);
    let withHistory = updated;
    if (
      prior &&
      (prior.opening !== updated.opening ||
        prior.body !== updated.body ||
        prior.tags.join("\0") !== updated.tags.join("\0"))
    ) {
      withHistory = { ...updated, history: pushHistorySnapshot(prior, updated.updated_at) };
    }
    const next = this.templates.map((t) => (t.id === updated.id ? withHistory : t));
    await this.persist(next);
  }

  async duplicateTemplateById(id: string): Promise<string | null> {
    if (!this.isEditorMode) return null;
    const src = this.templates.find((t) => t.id === id);
    if (!src) return null;
    this.pushUndo("duplicate");
    const now = new Date().toISOString();
    const copy: Template = {
      ...src,
      id: crypto.randomUUID(),
      name: `${src.name} (copy)`,
      created_at: now,
      updated_at: now,
    };
    const idx = this.templates.findIndex((t) => t.id === id);
    const next = [...this.templates];
    next.splice(idx + 1, 0, copy);
    await this.persist(next);
    return copy.id;
  }

  async deleteTemplateById(id: string): Promise<void> {
    if (!this.isEditorMode) return;
    const idx = this.templates.findIndex((t) => t.id === id);
    if (idx < 0) return;
    this.pushUndo("delete");
    const next = this.templates.filter((t) => t.id !== id);
    const nextSettings = this.settings.placeholder_values[id] !== undefined
      ? { ...this.settings, placeholder_values: omitKey(this.settings.placeholder_values, id) }
      : this.settings;
    await this.persist(next, nextSettings);
  }

  async togglePin(id: string): Promise<void> {
    if (!this.isEditorMode) return;
    this.pushUndo("pin");
    const next = this.templates.map((t) =>
      t.id === id ? { ...t, pinned: !t.pinned } : t,
    );
    await this.persist(next);
  }

  // Drag-reorder writes through the templates array directly. Sort mode is
  // forced to "manual" here — if a user explicitly drags, they expect that
  // order to stick over the recency sort.
  async handleTemplatesReorder(newOrderIds: string[]): Promise<void> {
    if (!this.isEditorMode) return;
    this.pushUndo("reorder");
    const byId = new Map(this.templates.map((t) => [t.id, t]));
    const next: Template[] = [];
    for (const id of newOrderIds) {
      const t = byId.get(id);
      if (t) next.push(t);
    }
    // Defensive: any id that fell out of the new order keeps its trailing
    // position so we never lose a template.
    for (const t of this.templates) if (!newOrderIds.includes(t.id)) next.push(t);
    await this.persist(next, { ...this.settings, sort_mode: "manual" });
  }

  // Bumped from MainPanel after a successful copy. Updates last_used_at so
  // the browse-order sort surfaces recently-used templates near the top, and
  // increments copy_count for the "most-used" sort.
  async recordCopy(id: string): Promise<void> {
    const now = new Date().toISOString();
    const next = this.templates.map((t) =>
      t.id === id ? { ...t, last_used_at: now, copy_count: t.copy_count + 1 } : t,
    );
    await this.persist(next);
  }

  async bulkDelete(ids: Set<string>): Promise<void> {
    if (!this.isEditorMode || ids.size === 0) return;
    this.pushUndo(`delete ${ids.size}`);
    const next = this.templates.filter((t) => !ids.has(t.id));
    const nextPlaceholders = { ...this.settings.placeholder_values };
    for (const id of ids) delete nextPlaceholders[id];
    try {
      const saved = await bulkDeleteTemplates([...ids]);
      this.templates = saved;
      this.settings = { ...this.settings, placeholder_values: nextPlaceholders };
    } catch (e) {
      this.loadError = `bulk delete failed: ${e}`;
    }
  }

  async bulkAddTag(ids: Set<string>, tag: string): Promise<void> {
    if (!this.isEditorMode || ids.size === 0) return;
    // Mirror TagPicker's normalization so bulk-add doesn't create case-variant
    // duplicates (e.g. "Email" alongside an existing "email").
    const trimmed = normalizeTag(tag);
    if (trimmed.length === 0) return;
    this.pushUndo(`tag ${ids.size}`);
    try {
      this.templates = await bulkAddTemplateTag([...ids], trimmed);
    } catch (e) {
      this.loadError = `bulk tag failed: ${e}`;
    }
  }

  async bulkRemoveTag(ids: Set<string>, tag: string): Promise<void> {
    if (!this.isEditorMode || ids.size === 0) return;
    const trimmed = normalizeTag(tag);
    if (trimmed.length === 0) return;
    this.pushUndo(`untag ${ids.size}`);
    try {
      this.templates = await bulkRemoveTemplateTag([...ids], trimmed);
    } catch (e) {
      this.loadError = `bulk untag failed: ${e}`;
    }
  }

  async moveToFolder(ids: Set<string>, folder: string | null): Promise<void> {
    if (!this.isEditorMode || ids.size === 0) return;
    this.pushUndo("move folder");
    const normalized = folder !== null && folder.trim().length > 0 ? folder.trim() : null;
    const next = this.templates.map((t) =>
      ids.has(t.id) ? { ...t, folder: normalized, updated_at: new Date().toISOString() } : t,
    );
    await this.persist(next);
  }

  async bulkExport(ids: Set<string>): Promise<void> {
    if (ids.size === 0) return;
    try {
      const today = new Date().toISOString().slice(0, 10);
      const path = await saveDialog({
        defaultPath: `templates-bulk-${today}.json`,
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      if (!path) return;
      await exportTemplatesSubset([...ids], path);
    } catch (e) {
      this.loadError = `bulk export failed: ${e}`;
    }
  }

  // Restore a prior version of a template. Treated as a regular edit — the
  // current state is pushed onto history first so revert is itself revertible.
  async revertHistory(templateId: string, versionIdx: number): Promise<void> {
    if (!this.isEditorMode) return;
    const cur = this.templates.find((t) => t.id === templateId);
    if (!cur) return;
    const v = cur.history[versionIdx];
    if (!v) return;
    this.pushUndo("revert");
    const now = new Date().toISOString();
    const newHistory = pushHistorySnapshot(cur, now);
    const restored: Template = {
      ...cur,
      opening: v.opening,
      body: v.body,
      tags: [...v.tags],
      updated_at: now,
      history: newHistory,
    };
    const next = this.templates.map((t) => (t.id === templateId ? restored : t));
    await this.persist(next);
  }

  async recordPlaceholderValues(
    templateId: string,
    values: Record<string, string>,
  ): Promise<void> {
    // The debounced flush from MainPanel can fire AFTER the template is
    // deleted (handleDelete races the persistTimer). Skip to avoid
    // resurrecting a placeholder entry for a template that no longer exists.
    if (!this.templates.some((t) => t.id === templateId)) return;
    // Strip empty entries to keep the persisted map lean.
    const cleaned: Record<string, string> = {};
    for (const [k, v] of Object.entries(values)) {
      if (v.length > 0) cleaned[k] = v;
    }
    const nextMap = { ...this.settings.placeholder_values };
    if (Object.keys(cleaned).length === 0) {
      delete nextMap[templateId];
    } else {
      nextMap[templateId] = cleaned;
    }
    await this.persist(this.templates, { ...this.settings, placeholder_values: nextMap });
  }

  async handleTagsReorder(newOrder: string[]): Promise<void> {
    await this.persist(this.templates, { ...this.settings, tag_order: newOrder });
  }

  handleSortModeToggle(): void {
    // Cycle manual → recent → most_used → never_used → manual.
    const next =
      this.settings.sort_mode === "manual"
        ? "recent"
        : this.settings.sort_mode === "recent"
          ? "most_used"
          : this.settings.sort_mode === "most_used"
            ? "never_used"
          : "manual";
    void this.persist(this.templates, { ...this.settings, sort_mode: next });
  }

  async handleRenameTag(
    from: string,
    to: string,
    selectedTagIds: Set<string>,
    excludedTagIds: Set<string>,
  ): Promise<{ selected: Set<string>; excluded: Set<string> }> {
    // Returns the (possibly remapped) filter sets so the caller can sync its
    // own reactive state — the filter sets stay in +page.svelte.
    if (!this.isEditorMode) return { selected: selectedTagIds, excluded: excludedTagIds };
    if (from === to || to.length === 0) return { selected: selectedTagIds, excluded: excludedTagIds };
    this.pushUndo("rename tag");
    const next = this.templates.map((t) =>
      t.tags.includes(from)
        ? { ...t, tags: dedupe(t.tags.map((tag) => (tag === from ? to : tag))) }
        : t,
    );
    // Update tag_order so the renamed tag keeps its position.
    const newOrder = this.settings.tag_order.map((t) => (t === from ? to : t));
    // Mirror into the active filter sets — without this, a tag selected as a
    // filter keeps its old name in the set and silently matches zero rows.
    let nextSelected = selectedTagIds;
    let nextExcluded = excludedTagIds;
    if (selectedTagIds.has(from)) {
      nextSelected = new Set(selectedTagIds);
      nextSelected.delete(from);
      nextSelected.add(to);
    }
    if (excludedTagIds.has(from)) {
      nextExcluded = new Set(excludedTagIds);
      nextExcluded.delete(from);
      nextExcluded.add(to);
    }
    await this.persist(next, { ...this.settings, tag_order: dedupe(newOrder) });
    return { selected: nextSelected, excluded: nextExcluded };
  }

  async handleDeleteTag(
    tag: string,
    selectedTagIds: Set<string>,
    excludedTagIds: Set<string>,
  ): Promise<{ selected: Set<string>; excluded: Set<string> }> {
    if (!this.isEditorMode) return { selected: selectedTagIds, excluded: excludedTagIds };
    this.pushUndo("remove tag");
    const next = this.templates.map((t) =>
      t.tags.includes(tag) ? { ...t, tags: t.tags.filter((x) => x !== tag) } : t,
    );
    const newOrder = this.settings.tag_order.filter((t) => t !== tag);
    const nextSelected = new Set(selectedTagIds);
    nextSelected.delete(tag);
    const nextExcluded = new Set(excludedTagIds);
    nextExcluded.delete(tag);
    await this.persist(next, { ...this.settings, tag_order: newOrder });
    return { selected: nextSelected, excluded: nextExcluded };
  }

  async handleRestoreBackup(name: string): Promise<void> {
    this.pushUndo("restore");
    const data = await restoreTemplateBackup(name);
    // Rust already wrote the restored data to disk; sync local state.
    this.templates = data.templates;
    this.settings = data.settings;
  }

  async exportSingleTemplate(id: string): Promise<void> {
    const tpl = this.templates.find((t) => t.id === id);
    if (!tpl) return;
    try {
      const path = await saveDialog({
        defaultPath: `template-${slugify(tpl.name)}.json`,
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      if (!path) return;
      await exportTemplate(id, path);
    } catch (e) {
      this.loadError = `export failed: ${e}`;
    }
  }
}

function slugify(s: string): string {
  const slug = s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return slug.length > 0 ? slug : "template";
}

export const templatesStore = new TemplatesStore();

export type PortResult =
  | { kind: "ok"; message: string }
  | { kind: "cancelled" }
  | { kind: "err"; error: string };

function pluralise(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/** Wraps the OS save dialog + `exportTemplates`. Returned tagged-union mirrors
 *  the original +page.svelte handler so SettingsModal still gets a uniform
 *  shape for the "Exported N templates." status line. */
export async function handleExportTemplates(): Promise<PortResult> {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const path = await saveDialog({
      defaultPath: `templates-export-${today}.json`,
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (!path) return { kind: "cancelled" };
    const count = await exportTemplates(path);
    return { kind: "ok", message: `Exported ${pluralise(count, "template")}.` };
  } catch (e) {
    return { kind: "err", error: String(e) };
  }
}

export async function handleImportTemplates(overwrite: boolean): Promise<PortResult> {
  if (!templatesStore.isEditorMode) return { kind: "err", error: "import disabled in User mode" };
  try {
    const path = await openDialog({
      multiple: false,
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (path === null || Array.isArray(path)) return { kind: "cancelled" };
    templatesStore.pushUndo("import");
    const result = await importTemplates(path, overwrite);
    // Rust has already persisted the merged list; just sync local state.
    templatesStore.templates = result.templates;
    const notes: string[] = [];
    if (result.overwritten > 0) notes.push(`${pluralise(result.overwritten, "duplicate")} overwritten`);
    if (result.skipped > 0) notes.push(`${pluralise(result.skipped, "duplicate")} skipped`);
    const suffix = notes.length > 0 ? ` (${notes.join(", ")})` : "";
    return {
      kind: "ok",
      message: `Imported ${pluralise(result.added, "template")}${suffix}.`,
    };
  } catch (e) {
    return { kind: "err", error: String(e) };
  }
}
