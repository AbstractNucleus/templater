/** True when `el` is a text field or contenteditable (shortcuts / menus should yield). */
export function isEditableTarget(el: Element | null | undefined): boolean {
  if (!el || el.tagName === "BODY") return false;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA") return true;
  if ((el as HTMLElement).isContentEditable) return true;
  return false;
}

/** True when focus is in a text field or contenteditable. */
export function isInputFocused(): boolean {
  return isEditableTarget(document.activeElement);
}
