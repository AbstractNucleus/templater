/**
 * Shared list drag-to-reorder logic for the Templates and Tags sidebars.
 *
 * Tracks the dragged item, the current hover target, and which half of that
 * target the cursor is over (top/bottom) so the drop indicator renders on the
 * correct edge. The reorder fires on drop: the dragged id is spliced out and
 * reinserted before/after the hover target, producing a fresh id order that's
 * handed to `onReorder`.
 *
 * Reactive ($state-backed) so consuming components can read `draggingId`,
 * `dragOverId`, and `dragOverHalf` directly in markup. `enabled` and
 * `currentIds` are read live (functions) so callers can gate on reactive state
 * (e.g. the Templates sidebar only allows drag in unfiltered browse mode).
 */
export interface DragReorder {
  readonly draggingId: string | null;
  readonly dragOverId: string | null;
  readonly dragOverHalf: "top" | "bottom";
  handleDragStart(e: DragEvent, id: string): void;
  handleDragOver(e: DragEvent, overId: string): void;
  handleDragLeave(overId: string): void;
  handleDrop(e: DragEvent, overId: string): void;
  handleDragEnd(): void;
  /** Clear dragging/hover state without firing a reorder. Lets callers reset
   *  from their own handlers (e.g. a folder drop) and tack on extra cleanup. */
  reset(): void;
}

export function createDragReorder(opts: {
  /** Whether dragging is currently allowed. Read live on every handler. */
  enabled: () => boolean;
  /** The visible ids in display order. Read live at drop time. */
  currentIds: () => string[];
  /** Receives the new id order after a successful drop. */
  onReorder: (newOrderIds: string[]) => void;
}): DragReorder {
  let draggingId = $state<string | null>(null);
  let dragOverId = $state<string | null>(null);
  let dragOverHalf = $state<"top" | "bottom">("top");

  return {
    get draggingId() {
      return draggingId;
    },
    get dragOverId() {
      return dragOverId;
    },
    get dragOverHalf() {
      return dragOverHalf;
    },
    handleDragStart(e: DragEvent, id: string): void {
      if (!opts.enabled()) return;
      draggingId = id;
      if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = "move";
        // Required for Firefox to actually start the drag.
        e.dataTransfer.setData("text/plain", id);
      }
    },
    handleDragOver(e: DragEvent, overId: string): void {
      if (!opts.enabled() || draggingId === null) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      dragOverHalf = e.clientY < rect.top + rect.height / 2 ? "top" : "bottom";
      dragOverId = overId;
    },
    handleDragLeave(overId: string): void {
      if (dragOverId === overId) dragOverId = null;
    },
    handleDrop(e: DragEvent, overId: string): void {
      if (!opts.enabled() || draggingId === null) return;
      e.preventDefault();
      const fromId = draggingId;
      const half = dragOverHalf;
      draggingId = null;
      dragOverId = null;
      if (fromId === overId) return;
      const ids = opts.currentIds();
      const fromIdx = ids.indexOf(fromId);
      if (fromIdx < 0) return;
      ids.splice(fromIdx, 1);
      let toIdx = ids.indexOf(overId);
      if (toIdx < 0) return;
      if (half === "bottom") toIdx += 1;
      ids.splice(toIdx, 0, fromId);
      opts.onReorder(ids);
    },
    handleDragEnd(): void {
      draggingId = null;
      dragOverId = null;
    },
    reset(): void {
      draggingId = null;
      dragOverId = null;
    },
  };
}
