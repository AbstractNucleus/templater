import { buildBrowseListModel, canReorder } from "$lib/browse";
import { templatesStore } from "$lib/stores/templatesStore.svelte";
import { selectionStore, type SelectModifier } from "$lib/stores/selectionStore.svelte";
import { editorSession } from "$lib/stores/editorSession.svelte";

/**
 * Browse session: search query + one list model (hits, groups, visibleIds).
 * Sidebars and keyboard consume this model — not a second ad-hoc grouping.
 */
class BrowseSession {
  searchQuery = $state("");
  searchInputEl = $state<HTMLInputElement | undefined>(undefined);
  collapsedFolders = $state<Set<string>>(new Set());

  listModel = $derived(
    buildBrowseListModel({
      templates: templatesStore.templates,
      sortMode: templatesStore.settings.sort_mode,
      selectedTagIds: selectionStore.selectedTagIds,
      excludedTagIds: selectionStore.excludedTagIds,
      combinator: selectionStore.tagCombinator,
      query: this.searchQuery,
      collapsedFolders: this.collapsedFolders,
    }),
  );

  results = $derived(this.listModel.hits);
  groups = $derived(this.listModel.groups);
  visibleIds = $derived(this.listModel.visibleIds);

  canReorderTemplates = $derived(
    canReorder({
      isEditorMode: templatesStore.isEditorMode,
      searchQuery: this.searchQuery,
      selectedTagIds: selectionStore.selectedTagIds,
      excludedTagIds: selectionStore.excludedTagIds,
      sortMode: templatesStore.settings.sort_mode,
    }),
  );

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

  toggleFolder(label: string): void {
    const next = new Set(this.collapsedFolders);
    if (next.has(label)) next.delete(label);
    else next.add(label);
    this.collapsedFolders = next;
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
