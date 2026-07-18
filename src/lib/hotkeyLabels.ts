/** Friendly labels for DOM `KeyboardEvent.code` values in accelerators. */

const KEY_LABELS: Record<string, string> = {
  Backslash: "\\",
  Slash: "/",
  Period: ".",
  Comma: ",",
  Semicolon: ";",
  Quote: "'",
  Backquote: "`",
  Minus: "-",
  Equal: "=",
  BracketLeft: "[",
  BracketRight: "]",
  Space: "Space",
  Enter: "Enter",
  Tab: "Tab",
  Backspace: "⌫",
  Escape: "Esc",
  ArrowUp: "↑",
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
};

/** Map a single accelerator part (`KeyA`, `Ctrl`, `Space`) to a display label. */
export function keyLabel(code: string): string {
  if (code in KEY_LABELS) return KEY_LABELS[code];
  if (code.startsWith("Key") && code.length === 4) return code.slice(3);
  if (code.startsWith("Digit") && code.length === 6) return code.slice(5);
  if (code.startsWith("Numpad") && code.length === 7) return code.slice(6);
  return code;
}

/** Format a full accelerator string (`Ctrl+Shift+KeyP`) for display. */
export function formatAccelerator(s: string): string {
  return s
    .split("+")
    .filter((p) => p.length > 0)
    .map(keyLabel)
    .join("+");
}

export function splitAccelerator(s: string): string[] {
  return s.split("+").filter((p) => p.length > 0);
}
