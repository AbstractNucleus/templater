import type { Settings, SortMode, Template } from "$lib/types";

/** Mutation-relevant settings restored by undo (not window geometry / theme / etc.). */
export type UndoSnapshot = {
  templates: Template[];
  placeholderValues: Record<string, Record<string, string>>;
  tagOrder: string[];
  sortMode: SortMode;
  label: string;
};

export function captureUndoSnapshot(
  templates: Template[],
  settings: Settings,
  label: string,
): UndoSnapshot {
  return {
    templates: [...templates],
    placeholderValues: { ...settings.placeholder_values },
    tagOrder: [...settings.tag_order],
    sortMode: settings.sort_mode,
    label,
  };
}

/** Bounded LIFO of undo snapshots. Not reactive — toast is owned by the store. */
export class UndoStack {
  #stack: UndoSnapshot[] = [];

  constructor(private readonly max = 20) {}

  push(snap: UndoSnapshot): void {
    this.#stack = [...this.#stack.slice(-(this.max - 1)), snap];
  }

  pop(): UndoSnapshot | undefined {
    if (this.#stack.length === 0) return undefined;
    const snap = this.#stack[this.#stack.length - 1];
    this.#stack = this.#stack.slice(0, -1);
    return snap;
  }

  get length(): number {
    return this.#stack.length;
  }
}
