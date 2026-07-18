import { getAppVersion } from "$lib/api";
import { templatesStore } from "$lib/stores/templatesStore.svelte";
import { selectionStore } from "$lib/stores/selectionStore.svelte";

export type BootstrapResult = {
  appVersion: string;
  tagsWidth: number;
  templatesWidth: number;
};

/** Initial load: version, templates/settings, selection, column widths. */
export async function bootstrapApp(): Promise<BootstrapResult> {
  const appVersion = await getAppVersion().catch(() => "0.0.0");
  await templatesStore.load();
  selectionStore.selectInitial(templatesStore.templates);
  const s = templatesStore.settings;
  return {
    appVersion,
    tagsWidth: s.column_widths.tags,
    templatesWidth: s.column_widths.templates,
  };
}
