import { buildTemplateList, canReorder } from "$lib/browse";
import { templatesStore } from "$lib/stores/templatesStore.svelte";
import { selectionStore, type SelectModifier } from "$lib/stores/selectionStore.svelte";
import { editorSession } from "$lib/stores/editorSession.svelte";

/**
 * Browse session: search query + derived list model. Sidebars and keyboard
 * read this instead of the page recomputing `buildTemplateList`.
 */
class BrowseSession {
  searchQuery = $state("");
  searchInputEl = $state<HTMLInputElement | undefined>(undefined);

  results = $derived(
    buildTemplateList({
      templates: templatesStore.templates,
      sortMode: templatesStore.settings.sort_mode,
      selectedTagIds: selectionStore.selectedTagIds,
      excludedTagIds: selectionStore.excludedTagIds,
      combinator: selectionStore.tagCombinator,
      query: this.searchQuery,
    }),
  );

  canReorderTemplates = $derived(
    canReorder({
      isEditorMode: templatesStore.isEditorMode,
      searchQuery: this.searchQuery,
      selectedTagIds: selectionStore.selectedTagIds,
      excludedTagIds: selectionStore.excludedTagIds,
      sortMode: templatesStore.settings.sort_mode,
    }),
  );

  visibleIds = $derived(this.results.map((h) => h.template.id));

  setSearchQuery(q: string): void {
    this.searchQuery = q;
  }

  clearSearch(): void {
    this.searchQuery = "";
    this.searchInputEl?.focus();
  }

  clearFilters(): void {
    selectionStore.clearTags();
    this.clearSearch();
  }

  selectTemplate(id: string, modifier: SelectModifier = "none"): void {
    editorSession.clearEditOnSelect();
    selectionStore.selectTemplate(id, this.visibleIds, modifier);
  }

  moveSelection(delta: number): void {
    selectionStore.moveSelection(this.visibleIds, delta);
  }
}

export const browseSession = new BrowseSession();
