import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import { exportTemplates } from "$lib/api";
import type { Template } from "$lib/types";

export function slugify(s: string): string {
  const slug = s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return slug.length > 0 ? slug : "template";
}

/** Save-dialog export of an arbitrary subset (bulk or single). */
export async function exportTemplatesToDialog(
  subset: Template[],
  defaultPath: string,
): Promise<"ok" | "cancelled"> {
  const path = await saveDialog({
    defaultPath,
    filters: [{ name: "JSON", extensions: ["json"] }],
  });
  if (!path) return "cancelled";
  await exportTemplates(path, subset);
  return "ok";
}
