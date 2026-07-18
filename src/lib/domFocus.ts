/** True when focus is in a text field or contenteditable (keyboard shortcuts should yield). */
export function isInputFocused(): boolean {
  const ae = document.activeElement;
  if (!ae || ae === document.body) return false;
  const tag = ae.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA") return true;
  if ((ae as HTMLElement).isContentEditable) return true;
  return false;
}
