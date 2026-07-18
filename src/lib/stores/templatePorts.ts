import { save as saveDialog, open as openDialog } from "@tauri-apps/plugin-dialog";
import { exportTemplates, readTemplatesExport } from "$lib/api";
import { mergeImportedTemplates } from "$lib/mergeImportedTemplates";
import { templatesStore } from "$lib/stores/templatesStore.svelte";
import type { PortResult } from "$lib/types";

function pluralise(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/** OS save dialog + export of the full in-memory template list. */
export async function handleExportTemplates(): Promise<PortResult> {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const path = await saveDialog({
      defaultPath: `templates-export-${today}.json`,
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (!path) return { kind: "cancelled" };
    const count = await exportTemplates(path, templatesStore.templates);
    return { kind: "ok", message: `Exported ${pluralise(count, "template")}.` };
  } catch (e) {
    return { kind: "err", error: String(e) };
  }
}

/** OS open dialog + merge into the store (validate before undo). */
export async function handleImportTemplates(overwrite: boolean): Promise<PortResult> {
  if (!templatesStore.isEditorMode) return { kind: "err", error: "import disabled in User mode" };
  try {
    const path = await openDialog({
      multiple: false,
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (path === null || Array.isArray(path)) return { kind: "cancelled" };
    const incoming = await readTemplatesExport(path);
    const result = mergeImportedTemplates(templatesStore.templates, incoming, overwrite);
    await templatesStore.apply("import", { templates: result.templates });
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
