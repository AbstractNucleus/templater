import { writeText, readText } from "@tauri-apps/plugin-clipboard-manager";
import type { ContextMenuItem } from "./components/ContextMenu.svelte";

/** Outcome of inspecting a right-click target:
 *  - `menu`: the caller should `preventDefault()` and open a context menu;
 *  - `suppress`: the caller should `preventDefault()` and show nothing;
 *  - `default`: the caller should leave the native menu alone (no
 *    `preventDefault()`). */
export type ContextMenuResult =
  | { action: "menu"; items: ContextMenuItem[] }
  | { action: "suppress" }
  | { action: "default" };

/** Pure menu-building logic for the global `contextmenu` handler. Decides what
 *  (if anything) to show for a right-click and returns the menu items; the
 *  caller owns positioning (`e.clientX/Y`) and `preventDefault()`. */
export function buildContextMenu(e: MouseEvent): ContextMenuResult {
  const target = e.target as HTMLElement | null;
  if (!target) {
    return { action: "suppress" };
  }
  const tag = target.tagName;
  const isInputLike = tag === "INPUT" || tag === "TEXTAREA";

  if (isInputLike) {
    const input = target as HTMLInputElement | HTMLTextAreaElement;
    const start = input.selectionStart ?? 0;
    const end = input.selectionEnd ?? 0;
    const hasSelection = start !== end;
    return {
      action: "menu",
      items: [
        {
          label: "Paste",
          onClick: async () => {
            let text: string | null;
            try {
              text = await readText();
            } catch {
              return;
            }
            if (text == null || text.length === 0) return;
            input.focus();
            // execCommand("insertText") feeds through the native input
            // pipeline, preserving the browser undo stack so Ctrl+Z works
            // afterwards. Falls back to direct mutation if unsupported.
            const ok = document.execCommand("insertText", false, text);
            if (!ok) {
              const s = input.selectionStart ?? input.value.length;
              const en = input.selectionEnd ?? input.value.length;
              input.value = input.value.slice(0, s) + text + input.value.slice(en);
              const caret = s + text.length;
              input.setSelectionRange(caret, caret);
              input.dispatchEvent(new Event("input", { bubbles: true }));
            }
          },
        },
        {
          label: "Copy",
          disabled: !hasSelection,
          onClick: () => {
            const slice = input.value.slice(start, end);
            if (slice.length > 0) void writeText(slice);
          },
        },
        {
          label: "Select all",
          onClick: () => {
            input.focus();
            input.select();
          },
        },
      ],
    };
  }

  // Outside an input: contenteditable still gets default menu;
  // otherwise show Copy when there's a text selection, else suppress.
  if (target.isContentEditable) return { action: "default" };

  const selectedText = window.getSelection()?.toString() ?? "";
  if (selectedText.length > 0) {
    return {
      action: "menu",
      items: [
        {
          label: "Copy",
          onClick: () => {
            void writeText(selectedText);
          },
        },
      ],
    };
  }
  return { action: "suppress" };
}
