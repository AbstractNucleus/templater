import {
  loadAppData,
  saveAppData,
  resetCorruptSettings,
  readTemplateBackup,
} from "$lib/api/data";
import { starterTemplates } from "$lib/starterTemplates";
import { pushHistorySnapshot } from "$lib/templateHistory";
import { normalizeTag } from "$lib/tags";
import { selectionStore } from "$lib/stores/selectionStore.svelte";
import { appErrors } from "$lib/stores/appErrors.svelte";
import { captureUndoSnapshot, UndoStack } from "$lib/stores/undoStack";
import { exportTemplatesToDialog, slugify } from "$lib/templateIo";
import {
  DEFAULT_SETTINGS,
  type Settings,
  type Template,
  type TemplateDraft,
} from "$lib/types";

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

class TemplatesStore {
  templates = $state<Template[]>([]);
  settings = $state<Settings>({ ...DEFAULT_SETTINGS });
  loaded = $state(false);
  /** Saves refused until user resets settings (matches Rust fail-closed lock). */
  settingsCorrupt = $state(false);
  undoToast = $state<string | null>(null);

  // Only permit writes after the initial load (or deliberate first-run bootstrap) succeeds.
  // This prevents an IPC/load failure from overwriting existing data with an empty list.
  #loadSucceeded = false;

  #undo = new UndoStack();
  #undoToastTimer: ReturnType<typeof setTimeout> | null = null;
  /** Serialize disk writes so concurrent persist callers cannot last-write-wins drop mutations. */
  #writeChain: Promise<void> = Promise.resolve();

  get isEditorMode(): boolean {
    return this.settings.mode === "editor";
  }

  /** Snapshot (optional) then persist. `label: null` skips undo (usage/settings noise). */
  async apply(
    label: string | null,
    next: { templates?: Template[]; settings?: Settings },
  ): Promise<void> {
    if (label !== null) {
      this.#undo.push(captureUndoSnapshot(this.templates, this.settings, label));
    }
    await this.persist(next.templates ?? this.templates, next.settings ?? this.settings);
  }

  async load(): Promise<void> {
    try {
      const outcome = await loadAppData();
      if (outcome.status === "empty") {
        this.templates = starterTemplates;
        this.settings = { ...DEFAULT_SETTINGS };
        this.settingsCorrupt = false;
        appErrors.clearLoad();
        await saveAppData({
          templates: starterTemplates,
          settings: this.settings,
        });
      } else if (outcome.status === "settings_corrupt") {
        this.templates = outcome.templates;
        this.settings = { ...DEFAULT_SETTINGS };
        this.settingsCorrupt = true;
        appErrors.setLoad(
          `Settings file is corrupt (${outcome.message}). Saves are blocked until you reset settings.`,
        );
      } else {
        this.templates = outcome.data.templates;
        this.settings = outcome.data.settings;
        this.settingsCorrupt = false;
        appErrors.clearLoad();
        // Existing users who dismissed the legacy "minimises to tray" banner
        // shouldn't be surprised by the new onboarding tour. Auto-graduate
        // them so the tour only fires for genuinely fresh installs.
        if (this.settings.close_hint_shown && !this.settings.onboarding_complete) {
          this.settings = { ...this.settings, onboarding_complete: true };
          await saveAppData({
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
      appErrors.setLoad(String(e));
    } finally {
      this.loaded = true;
    }
  }

  async resetCorruptSettings(): Promise<void> {
    try {
      await resetCorruptSettings();
      this.settings = { ...DEFAULT_SETTINGS };
      this.settingsCorrupt = false;
      appErrors.clearLoad();
    } catch (e) {
      appErrors.setAction(`reset settings failed: ${e}`);
    }
  }

  async persist(
    nextTemplates: Template[],
    nextSettings: Settings = this.settings,
  ): Promise<void> {
    if (!this.#loadSucceeded) {
      appErrors.setLoad("save blocked: initial data load did not complete");
      return;
    }
    if (this.settingsCorrupt) {
      appErrors.setLoad(
        "Saves blocked: settings file is corrupt. Reset settings to continue.",
      );
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
    const prevTemplates = this.templates;
    const prevSettings = this.settings;
    this.templates = nextTemplates;
    this.settings = safeSettings;

    const run = async () => {
      try {
        await saveAppData({
          templates: nextTemplates,
          settings: safeSettings,
        });
      } catch (e) {
        // Roll back only if nothing newer has replaced our optimistic assign.
        if (this.templates === nextTemplates && this.settings === safeSettings) {
          this.templates = prevTemplates;
          this.settings = prevSettings;
        }
        appErrors.setAction(`save failed: ${e}`);
      }
    };

    // Keep the chain alive after failures so later persists still serialize.
    const queued = this.#writeChain.then(run, run);
    this.#writeChain = queued.then(
      () => undefined,
      () => undefined,
    );
    await queued;
  }

  async performUndo(): Promise<void> {
    const snap = this.#undo.pop();
    if (!snap) return;
    await this.persist(snap.templates, {
      ...this.settings,
      placeholder_values: snap.placeholderValues,
      tag_order: snap.tagOrder,
      sort_mode: snap.sortMode,
    });
    this.#showUndoToast(`Undid ${snap.label}`);
  }

  #showUndoToast(msg: string): void {
    this.undoToast = msg;
    if (this.#undoToastTimer) clearTimeout(this.#undoToastTimer);
    this.#undoToastTimer = setTimeout(() => (this.undoToast = null), 2000);
  }

  async createTemplate(draft: TemplateDraft): Promise<string | null> {
    if (!this.isEditorMode) return null;
    const now = new Date().toISOString();
    const folder =
      draft.folder !== null && draft.folder.trim().length > 0 ? draft.folder.trim() : null;
    const newTemplate: Template = {
      id: crypto.randomUUID(),
      name: draft.name.trim() || "Untitled",
      tags: draft.tags,
      opening: draft.opening,
      body: draft.body,
      created_at: now,
      updated_at: now,
      pinned: false,
      last_used_at: null,
      copy_count: 0,
      folder,
      history: [],
    };
    await this.apply("create", { templates: [newTemplate, ...this.templates] });
    return newTemplate.id;
  }

  async handleSave(updated: Template): Promise<void> {
    if (!this.isEditorMode) return;
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
    await this.apply("edit", { templates: next });
  }

  async duplicateId(id: string): Promise<string | null> {
    if (!this.isEditorMode) return null;
    const src = this.templates.find((t) => t.id === id);
    if (!src) return null;
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
    await this.apply("duplicate", { templates: next });
    selectionStore.selectedTemplateId = copy.id;
    return copy.id;
  }

  async deleteIds(ids: Iterable<string>): Promise<void> {
    if (!this.isEditorMode) return;
    const idSet = ids instanceof Set ? ids : new Set(ids);
    if (idSet.size === 0) return;
    if (!this.templates.some((t) => idSet.has(t.id))) return;
    const nextTemplates = this.templates.filter((t) => !idSet.has(t.id));
    const nextPlaceholders = { ...this.settings.placeholder_values };
    for (const id of idSet) delete nextPlaceholders[id];
    await this.apply(idSet.size === 1 ? "delete" : `delete ${idSet.size}`, {
      templates: nextTemplates,
      settings: { ...this.settings, placeholder_values: nextPlaceholders },
    });
    selectionStore.syncAfterRemoval(idSet, nextTemplates[0]?.id ?? null);
  }

  async togglePin(id: string): Promise<void> {
    if (!this.isEditorMode) return;
    const next = this.templates.map((t) =>
      t.id === id ? { ...t, pinned: !t.pinned } : t,
    );
    await this.apply("pin", { templates: next });
  }

  async handleTemplatesReorder(newOrderIds: string[]): Promise<void> {
    if (!this.isEditorMode) return;
    const byId = new Map(this.templates.map((t) => [t.id, t]));
    const next: Template[] = [];
    for (const id of newOrderIds) {
      const t = byId.get(id);
      if (t) next.push(t);
    }
    for (const t of this.templates) if (!newOrderIds.includes(t.id)) next.push(t);
    await this.apply("reorder", {
      templates: next,
      settings: { ...this.settings, sort_mode: "manual" },
    });
  }

  async recordCopy(id: string): Promise<void> {
    const now = new Date().toISOString();
    const next = this.templates.map((t) =>
      t.id === id ? { ...t, last_used_at: now, copy_count: t.copy_count + 1 } : t,
    );
    await this.apply(null, { templates: next });
  }

  async bulkAddTag(ids: Set<string>, tag: string): Promise<void> {
    if (!this.isEditorMode || ids.size === 0) return;
    const trimmed = normalizeTag(tag);
    if (trimmed.length === 0) return;
    const next = this.templates.map((t) => {
      if (!ids.has(t.id)) return t;
      if (t.tags.some((existing) => existing.toLowerCase() === trimmed)) return t;
      return { ...t, tags: [...t.tags, trimmed] };
    });
    await this.apply(`tag ${ids.size}`, { templates: next });
  }

  async bulkRemoveTag(ids: Set<string>, tag: string): Promise<void> {
    if (!this.isEditorMode || ids.size === 0) return;
    const trimmed = normalizeTag(tag);
    if (trimmed.length === 0) return;
    const next = this.templates.map((t) => {
      if (!ids.has(t.id)) return t;
      return {
        ...t,
        tags: t.tags.filter((existing) => existing.toLowerCase() !== trimmed),
      };
    });
    await this.apply(`untag ${ids.size}`, { templates: next });
  }

  async moveToFolder(ids: Set<string>, folder: string | null): Promise<void> {
    if (!this.isEditorMode || ids.size === 0) return;
    const normalized = folder !== null && folder.trim().length > 0 ? folder.trim() : null;
    const next = this.templates.map((t) =>
      ids.has(t.id) ? { ...t, folder: normalized, updated_at: new Date().toISOString() } : t,
    );
    await this.apply("move folder", { templates: next });
  }

  async bulkExport(ids: Set<string>): Promise<void> {
    if (ids.size === 0) return;
    try {
      const today = new Date().toISOString().slice(0, 10);
      const subset = this.templates.filter((t) => ids.has(t.id));
      await exportTemplatesToDialog(subset, `templates-bulk-${today}.json`);
    } catch (e) {
      appErrors.setAction(`bulk export failed: ${e}`);
    }
  }

  async revertHistory(templateId: string, versionIdx: number): Promise<void> {
    if (!this.isEditorMode) return;
    const cur = this.templates.find((t) => t.id === templateId);
    if (!cur) return;
    const v = cur.history[versionIdx];
    if (!v) return;
    const now = new Date().toISOString();
    const restored: Template = {
      ...cur,
      opening: v.opening,
      body: v.body,
      tags: [...v.tags],
      updated_at: now,
      history: pushHistorySnapshot(cur, now),
    };
    const next = this.templates.map((t) => (t.id === templateId ? restored : t));
    await this.apply("revert", { templates: next });
  }

  async recordPlaceholderValues(
    templateId: string,
    values: Record<string, string>,
  ): Promise<void> {
    if (!this.templates.some((t) => t.id === templateId)) return;
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
    await this.apply(null, {
      settings: { ...this.settings, placeholder_values: nextMap },
    });
  }

  async handleTagsReorder(newOrder: string[]): Promise<void> {
    await this.apply(null, {
      settings: { ...this.settings, tag_order: newOrder },
    });
  }

  handleSortModeToggle(): void {
    const next =
      this.settings.sort_mode === "manual"
        ? "recent"
        : this.settings.sort_mode === "recent"
          ? "most_used"
          : this.settings.sort_mode === "most_used"
            ? "never_used"
            : "manual";
    void this.apply(null, {
      settings: { ...this.settings, sort_mode: next },
    });
  }

  async handleRenameTag(from: string, to: string): Promise<void> {
    if (!this.isEditorMode) return;
    if (from === to || to.length === 0) return;
    const next = this.templates.map((t) =>
      t.tags.includes(from)
        ? { ...t, tags: dedupe(t.tags.map((tag) => (tag === from ? to : tag))) }
        : t,
    );
    const newOrder = this.settings.tag_order.map((t) => (t === from ? to : t));
    await this.apply("rename tag", {
      templates: next,
      settings: { ...this.settings, tag_order: dedupe(newOrder) },
    });
    selectionStore.remapTag(from, to);
  }

  async handleDeleteTag(tag: string): Promise<void> {
    if (!this.isEditorMode) return;
    const next = this.templates.map((t) =>
      t.tags.includes(tag) ? { ...t, tags: t.tags.filter((x) => x !== tag) } : t,
    );
    const newOrder = this.settings.tag_order.filter((t) => t !== tag);
    await this.apply("remove tag", {
      templates: next,
      settings: { ...this.settings, tag_order: newOrder },
    });
    selectionStore.removeTag(tag);
  }

  async handleRestoreBackup(name: string): Promise<void> {
    const templates = await readTemplateBackup(name);
    await this.apply("restore", { templates });
  }

  async exportSingleTemplate(id: string): Promise<void> {
    const tpl = this.templates.find((t) => t.id === id);
    if (!tpl) return;
    try {
      await exportTemplatesToDialog([tpl], `template-${slugify(tpl.name)}.json`);
    } catch (e) {
      appErrors.setAction(`export failed: ${e}`);
    }
  }
}

export const templatesStore = new TemplatesStore();

// Re-export ports so existing DialogsHost imports keep working.
export {
  handleExportTemplates,
  handleImportTemplates,
} from "$lib/stores/templatePorts";
