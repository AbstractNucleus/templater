import type { DialogMenuItem } from "$lib/stores/uiDialogs.svelte";
import { isEditableTarget } from "$lib/domFocus";

/** Clipboard ops bound at the call site — keeps this module free of side effects. */
export type ContextMenuClipboard = {
  readText: () => Promise<string | null>;
  writeText: (text: string) => Promise<void>;
};

/** Pure menu descriptor: what to show, not how to run it. */
export type ContextMenuDescriptor =
  | { kind: "paste"; target: HTMLInputElement | HTMLTextAreaElement }
  | { kind: "copy-text"; text: string; disabled?: boolean }
  | { kind: "select-all"; target: HTMLInputElement | HTMLTextAreaElement };

/** Outcome of inspecting a right-click target:
 *  - `menu`: the caller should `preventDefault()` and open a context menu;
 *  - `suppress`: the caller should `preventDefault()` and show nothing;
 *  - `default`: the caller should leave the native menu alone (no
 *    `preventDefault()`). */
export type ContextMenuResult =
  | { action: "menu"; items: ContextMenuDescriptor[] }
  | { action: "suppress" }
  | { action: "default" };

/** Pure menu-building logic for the global `contextmenu` handler. Decides what
 *  (if anything) to show for a right-click; the caller binds actions and owns
 *  positioning (`e.clientX/Y`) / `preventDefault()`. */
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
        { kind: "paste", target: input },
        {
          kind: "copy-text",
          text: input.value.slice(start, end),
          disabled: !hasSelection,
        },
        { kind: "select-all", target: input },
      ],
    };
  }

  // Outside an input: contenteditable still gets default menu;
  // otherwise show Copy when there's a text selection, else suppress.
  if (isEditableTarget(target)) return { action: "default" };

  const selectedText = window.getSelection()?.toString() ?? "";
  if (selectedText.length > 0) {
    return {
      action: "menu",
      items: [{ kind: "copy-text", text: selectedText }],
    };
  }
  return { action: "suppress" };
}

/** Bind pure descriptors to clickable menu items (side effects live here). */
export function bindContextMenuItems(
  items: ContextMenuDescriptor[],
  clipboard: ContextMenuClipboard,
): DialogMenuItem[] {
  return items.map((item) => {
    switch (item.kind) {
      case "paste":
        return {
          label: "Paste",
          onClick: () => void pasteInto(item.target, clipboard),
        };
      case "copy-text":
        return {
          label: "Copy",
          disabled: item.disabled ?? item.text.length === 0,
          onClick: () => {
            if (item.text.length > 0) void clipboard.writeText(item.text);
          },
        };
      case "select-all":
        return {
          label: "Select all",
          onClick: () => {
            item.target.focus();
            item.target.select();
          },
        };
    }
  });
}

async function pasteInto(
  input: HTMLInputElement | HTMLTextAreaElement,
  clipboard: ContextMenuClipboard,
): Promise<void> {
  let text: string | null;
  try {
    text = await clipboard.readText();
  } catch {
    return;
  }
  if (text == null || text.length === 0) return;
  input.focus();
  // execCommand("insertText") feeds through the native input pipeline,
  // preserving the browser undo stack so Ctrl+Z works afterwards.
  const ok = document.execCommand("insertText", false, text);
  if (!ok) {
    const s = input.selectionStart ?? input.value.length;
    const en = input.selectionEnd ?? input.value.length;
    input.value = input.value.slice(0, s) + text + input.value.slice(en);
    const caret = s + text.length;
    input.setSelectionRange(caret, caret);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }
}
