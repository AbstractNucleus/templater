import type { Template } from "$lib/types";

export type SelectModifier = "none" | "ctrl" | "shift";
export type TagCombinator = "and" | "or";

class SelectionStore {
  selectedTemplateId = $state<string | null>(null);
  bulkSelectedIds = $state<Set<string>>(new Set());
  selectedTagIds = $state<Set<string>>(new Set());
  excludedTagIds = $state<Set<string>>(new Set());
  tagCombinator = $state<TagCombinator>("and");

  selectInitial(templates: Template[]): void {
    this.selectedTemplateId = templates[0]?.id ?? null;
    this.bulkSelectedIds = new Set();
  }

  moveSelection(visibleIds: string[], delta: number): void {
    if (visibleIds.length === 0) return;
    const cur = this.selectedTemplateId;
    const idx = cur === null ? -1 : visibleIds.indexOf(cur);
    let next: number;
    if (idx < 0) {
      next = delta > 0 ? 0 : visibleIds.length - 1;
    } else {
      next = Math.max(0, Math.min(visibleIds.length - 1, idx + delta));
    }
    this.selectedTemplateId = visibleIds[next];
    this.bulkSelectedIds = new Set();
  }

  ensureSelection(visibleIds: string[]): void {
    if (visibleIds.length === 0) {
      this.selectedTemplateId = null;
      this.bulkSelectedIds = new Set();
      return;
    }
    if (this.selectedTemplateId === null || !visibleIds.includes(this.selectedTemplateId)) {
      this.selectedTemplateId = visibleIds[0];
      this.bulkSelectedIds = new Set();
    }
  }

  selectTemplate(id: string, visibleIds: string[], modifier: SelectModifier): void {
    const cur = this.selectedTemplateId;
    if (modifier === "ctrl") {
      const next = new Set(this.bulkSelectedIds.size > 0 ? this.bulkSelectedIds : cur ? [cur] : []);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      this.bulkSelectedIds = next;
      this.selectedTemplateId = next.has(id) ? id : (next.values().next().value ?? null);
      return;
    }
    if (modifier === "shift" && cur) {
      const a = visibleIds.indexOf(cur);
      const b = visibleIds.indexOf(id);
      if (a >= 0 && b >= 0) {
        const [lo, hi] = a < b ? [a, b] : [b, a];
        this.bulkSelectedIds = new Set(visibleIds.slice(lo, hi + 1));
        this.selectedTemplateId = id;
        return;
      }
    }
    this.bulkSelectedIds = new Set();
    this.selectedTemplateId = cur === id ? null : id;
  }

  pruneBulkSelection(removedIds: Set<string>): void {
    if (this.bulkSelectedIds.size === 0) return;
    const next = new Set<string>();
    for (const id of this.bulkSelectedIds) if (!removedIds.has(id)) next.add(id);
    this.bulkSelectedIds = next;
  }

  /** After deleteIds: drop removed bulk ids and reselect if the current row is gone. */
  syncAfterRemoval(removedIds: Set<string>, fallbackId: string | null): void {
    this.pruneBulkSelection(removedIds);
    if (
      this.selectedTemplateId !== null &&
      removedIds.has(this.selectedTemplateId)
    ) {
      this.selectedTemplateId = fallbackId;
    }
  }

  toggleTag(tag: string): void {
    const selected = new Set(this.selectedTagIds);
    if (this.excludedTagIds.has(tag)) {
      const excluded = new Set(this.excludedTagIds);
      excluded.delete(tag);
      this.excludedTagIds = excluded;
      selected.add(tag);
    } else if (selected.has(tag)) {
      selected.delete(tag);
    } else {
      selected.add(tag);
    }
    this.selectedTagIds = selected;
  }

  excludeTag(tag: string): void {
    const excluded = new Set(this.excludedTagIds);
    if (this.selectedTagIds.has(tag)) {
      const selected = new Set(this.selectedTagIds);
      selected.delete(tag);
      this.selectedTagIds = selected;
      excluded.add(tag);
    } else if (excluded.has(tag)) {
      excluded.delete(tag);
    } else {
      excluded.add(tag);
    }
    this.excludedTagIds = excluded;
  }

  clearTags(): void {
    this.selectedTagIds = new Set();
    this.excludedTagIds = new Set();
  }

  toggleTagCombinator(): void {
    this.tagCombinator = this.tagCombinator === "and" ? "or" : "and";
  }

  remapTag(from: string, to: string): void {
    if (this.selectedTagIds.has(from)) {
      const selected = new Set(this.selectedTagIds);
      selected.delete(from);
      selected.add(to);
      this.selectedTagIds = selected;
    }
    if (this.excludedTagIds.has(from)) {
      const excluded = new Set(this.excludedTagIds);
      excluded.delete(from);
      excluded.add(to);
      this.excludedTagIds = excluded;
    }
  }

  removeTag(tag: string): void {
    const selected = new Set(this.selectedTagIds);
    selected.delete(tag);
    this.selectedTagIds = selected;
    const excluded = new Set(this.excludedTagIds);
    excluded.delete(tag);
    this.excludedTagIds = excluded;
  }
}

export const selectionStore = new SelectionStore();
