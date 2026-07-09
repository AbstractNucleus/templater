<script lang="ts">
  import TagsSidebar from "$lib/components/TagsSidebar.svelte";
  import TemplatesSidebar, { type SelectModifier } from "$lib/components/TemplatesSidebar.svelte";
  import MainPanel from "$lib/components/MainPanel.svelte";
  import TitleBar from "$lib/components/TitleBar.svelte";
  import SettingsModal from "$lib/components/SettingsModal.svelte";
  import ResizeHandles from "$lib/components/ResizeHandles.svelte";
  import AgentSidebar from "$lib/components/AgentSidebar.svelte";
  import EditorPane from "$lib/components/EditorPane.svelte";
  import ContextMenu, { type ContextMenuItem } from "$lib/components/ContextMenu.svelte";
  import ConfirmDialog from "$lib/components/ConfirmDialog.svelte";
  import CheatSheet from "$lib/components/CheatSheet.svelte";
  import OnboardingTour from "$lib/components/OnboardingTour.svelte";
  import ContextPane from "$lib/components/ContextPane.svelte";
  import MemoryCapturePopover from "$lib/components/MemoryCapturePopover.svelte";
  import { readText } from "@tauri-apps/plugin-clipboard-manager";
  import { getCurrentWebview } from "@tauri-apps/api/webview";
  import { listen } from "@tauri-apps/api/event";
  import { searchTemplates } from "$lib/search";
  import { orderedTagCounts } from "$lib/tags";
  import { buildContextMenu } from "$lib/contextMenu";
  import { createGlobalKeydownHandler } from "$lib/keyboard";
  import {
    getEnvWarnings,
    openDataDir,
    checkForUpdate,
    getAppVersion,
    onSidecarProgress,
    listTemplateBackups,
    setContextSources,
  } from "$lib/api";
  import {
    DEFAULT_COLUMN_WIDTHS,
    type Settings,
    type Template,
  } from "$lib/types";
  import {
    templatesStore,
    handleExportTemplates,
    handleImportTemplates,
  } from "$lib/stores/templatesStore.svelte";
  import { agentStore } from "$lib/stores/agentStore.svelte";
  import { selectionStore } from "$lib/stores/selectionStore.svelte";
  import { pasteMatchStore } from "$lib/stores/pasteMatchStore.svelte";

  const PASTE_THRESHOLD = 30;

  const ZOOM_MIN = 0.5;
  const ZOOM_MAX = 2.0;
  const ZOOM_STEP = 0.1;

  const TAGS_MIN = 100;
  const TAGS_MAX = 400;
  const TEMPLATES_MIN = 160;
  const TEMPLATES_MAX = 500;
  const CONTEXT_MIN = 280;
  const CONTEXT_MAX = 600;

  let tagsWidth = $state(DEFAULT_COLUMN_WIDTHS.tags);
  let templatesWidth = $state(DEFAULT_COLUMN_WIDTHS.templates);
  let contextWidth = $state(DEFAULT_COLUMN_WIDTHS.context);
  let contextOpen = $state(false);
  let captureOpen = $state(false);
  let searchInput: HTMLInputElement | undefined = $state();

  function clearSearch(): void {
    searchQuery = "";
    searchInput?.focus();
  }

  function handleGlobalContextMenu(e: MouseEvent): void {
    const result = buildContextMenu(e);
    if (result.action === "default") return;
    e.preventDefault();
    if (result.action === "menu") {
      contextMenu = { x: e.clientX, y: e.clientY, items: result.items };
    }
  }

  function setZoom(next: number): void {
    // Round to one decimal to avoid 0.1-step float drift (0.7 + 0.1 = 0.7999…).
    const clamped = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Math.round(next * 10) / 10));
    if (clamped === templatesStore.settings.zoom) return;
    void templatesStore.persist(templatesStore.templates, { ...templatesStore.settings, zoom: clamped });
  }

  function isInputFocused(): boolean {
    const ae = document.activeElement;
    if (!ae || ae === document.body) return false;
    const tag = ae.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") return true;
    if ((ae as HTMLElement).isContentEditable) return true;
    return false;
  }

  function moveSelection(delta: number): void {
    selectionStore.moveSelection(visibleTemplateIds, delta);
  }

  function copySelected(): void {
    if (selectionStore.selectedTemplateId === null) return;
    copyTrigger++;
  }

  function startResize(target: "tags" | "templates" | "agent" | "context"): (e: PointerEvent) => void {
    return (e) => {
      e.preventDefault();
      const handle = e.currentTarget as HTMLElement;
      const startX = e.clientX;
      const widthOf = (t: typeof target): number =>
        t === "tags" ? tagsWidth : t === "templates" ? templatesWidth : t === "agent" ? agentSidebarWidth : contextWidth;
      const startWidth = widthOf(target);
      const min =
        target === "tags"
          ? TAGS_MIN
          : target === "templates"
            ? TEMPLATES_MIN
            : target === "agent"
              ? AGENT_MIN
              : CONTEXT_MIN;
      const max =
        target === "tags"
          ? TAGS_MAX
          : target === "templates"
            ? TEMPLATES_MAX
            : target === "agent"
              ? AGENT_MAX
              : CONTEXT_MAX;
      // Context pane sits on the RIGHT; dragging its handle left should grow
      // the pane, which means inverting the X delta.
      const sign = target === "context" ? -1 : 1;
      handle.setPointerCapture(e.pointerId);
      handle.classList.add("dragging");

      function onMove(ev: PointerEvent): void {
        const next = Math.round(Math.max(min, Math.min(max, startWidth + sign * (ev.clientX - startX))));
        if (target === "tags") tagsWidth = next;
        else if (target === "templates") templatesWidth = next;
        else if (target === "agent") agentSidebarWidth = next;
        else contextWidth = next;
      }

      function onUp(): void {
        handle.removeEventListener("pointermove", onMove);
        handle.removeEventListener("pointerup", onUp);
        handle.removeEventListener("pointercancel", onUp);
        handle.releasePointerCapture(e.pointerId);
        handle.classList.remove("dragging");
        const final = widthOf(target);
        if (final !== templatesStore.settings.column_widths[target]) {
          void templatesStore.persist(templatesStore.templates, {
            ...templatesStore.settings,
            column_widths: { ...templatesStore.settings.column_widths, [target]: final },
          });
        }
      }

      handle.addEventListener("pointermove", onMove);
      handle.addEventListener("pointerup", onUp);
      handle.addEventListener("pointercancel", onUp);
    };
  }

  let envApiKeyOverride = $state(false);
  let appVersion = $state("0.0.0");

  let searchQuery = $state("");
  let includeOpening = $state(true);
  let includeSignature = $state(true);
  let editing = $state(false);
  let editAgentDraft = $state<{ opening: string; body: string }>({ opening: "", body: "" });
  let editBodyUpdateSeq = $state(0);
  let editBodyUpdate = $state<{ templateId: string; body: string; seq: number } | null>(null);
  // Agent → form body sync for the new-template flow. Mirrors editBodyUpdate
  // but uses templateId=null since no template exists yet. The form's
  // current body lives in agentStore.baseDraft (synced via onDraftChange).
  let createBodyUpdateSeq = $state(0);
  let createBodyUpdate = $state<{ templateId: string | null; body: string; seq: number } | null>(null);
  let settingsOpen = $state(false);
  let cheatSheetOpen = $state(false);

  let copyTrigger = $state(0);

  let agentSidebarWidth = $state(DEFAULT_COLUMN_WIDTHS.agent);
  let contextMenu = $state<{ x: number; y: number; items: ContextMenuItem[] } | null>(null);
  let contextDeleteTarget = $state<Template | null>(null);
  const AGENT_MIN = 240;
  const AGENT_MAX = 600;

  // Read-only aliases keep template + derivation code readable. Mutations go
  // directly through the stores so reactivity propagates back.
  const templates = $derived(templatesStore.templates);
  const settings = $derived(templatesStore.settings);
  const loaded = $derived(templatesStore.loaded);
  const undoToast = $derived(templatesStore.undoToast);

  const selectedTemplate = $derived(
    templates.find((t) => t.id === selectionStore.selectedTemplateId) ?? null,
  );

  const isEditorMode = $derived(templatesStore.isEditorMode);

  const availableTags = $derived.by(() => {
    const set = new Set<string>();
    for (const t of templates) for (const tag of t.tags) set.add(tag);
    return [...set].sort();
  });

  const availableFolders = $derived.by(() => {
    const set = new Set<string>();
    for (const t of templates) if (t.folder !== null) set.add(t.folder);
    return [...set].sort();
  });

  // Browse order: pinned first, then by sort mode. "manual" preserves array
  // order; "recent" by last_used_at desc; "most_used" by copy_count desc.
  const browseOrdered = $derived.by(() => {
    const mode = settings.sort_mode;
    return [...templates].sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      if (mode === "recent") {
        const aT = a.last_used_at ?? "";
        const bT = b.last_used_at ?? "";
        if (aT !== bT) return aT > bT ? -1 : 1;
        return 0;
      }
      if (mode === "most_used") {
        if (a.copy_count !== b.copy_count) return b.copy_count - a.copy_count;
        return 0;
      }
      if (mode === "never_used") {
        const aNever = a.copy_count === 0 && a.last_used_at === null;
        const bNever = b.copy_count === 0 && b.last_used_at === null;
        if (aNever !== bNever) return aNever ? -1 : 1;
        return 0;
      }
      return 0;
    });
  });

  const tagFiltered = $derived.by(() => {
    if (selectionStore.selectedTagIds.size === 0 && selectionStore.excludedTagIds.size === 0) return browseOrdered;
    return browseOrdered.filter((t) => {
      for (const tag of selectionStore.excludedTagIds) {
        if (t.tags.includes(tag)) return false;
      }
      if (selectionStore.selectedTagIds.size === 0) return true;
      if (selectionStore.tagCombinator === "or") {
        for (const tag of selectionStore.selectedTagIds) {
          if (t.tags.includes(tag)) return true;
        }
        return false;
      }
      for (const tag of selectionStore.selectedTagIds) {
        if (!t.tags.includes(tag)) return false;
      }
      return true;
    });
  });

  const rawHits = $derived(searchTemplates(searchQuery, tagFiltered));

  // Group pinned to the top regardless of search score. Within each tier the
  // searchTemplates ordering (full-match → score → name) is preserved.
  const searchResults = $derived.by(() => {
    const pinned: typeof rawHits = [];
    const others: typeof rawHits = [];
    for (const h of rawHits) {
      if (h.template.pinned) pinned.push(h);
      else others.push(h);
    }
    return [...pinned, ...others];
  });

  // Paste-match is an AI feature — with AI off, any query length is a plain
  // literal search and none of the paste-mode UI (ranked list, AI chip,
  // adapt button) can appear.
  const inPasteMode = $derived(
    settings.ai_enabled && searchQuery.trim().length >= PASTE_THRESHOLD,
  );

  // Drag-reorder is only safe when the visible order IS the underlying array
  // order. Any filter, search, or paste-mode ranking breaks that invariant.
  const canReorderTemplates = $derived(
    isEditorMode &&
      !inPasteMode &&
      searchQuery.trim().length === 0 &&
      selectionStore.selectedTagIds.size === 0 &&
      selectionStore.excludedTagIds.size === 0 &&
      settings.sort_mode === "manual",
  );

  // Tag counts shared between the Tags sidebar UI and the SettingsModal tag
  // manager.
  const settingsTagCounts = $derived(orderedTagCounts(templates, settings.tag_order));

  // Props the MainPanel takes identically in all three render modes (create /
  // edit / browse). Spread at each site with `{...sharedMainPanelProps}`;
  // per-branch props (template, editing, inboundText, the action callbacks,
  // aiBodyUpdate, onDraftChange) are passed explicitly alongside the spread.
  const sharedMainPanelProps = $derived({
    globalSignature: settings.global_signature,
    snippets: settings.snippets,
    canEdit: isEditorMode,
    availableTags,
    availableFolders,
    copyTrigger,
    savedPlaceholderValues: settings.placeholder_values,
    includeOpening,
    includeSignature,
    adaptBusy: agentStore.adaptBusy,
    adaptError: agentStore.adaptError,
    onClearAdaptError: () => (agentStore.adaptError = null),
    onToggleOpening: (v: boolean) => (includeOpening = v),
    onToggleSignature: (v: boolean) => (includeSignature = v),
    onCopySuccess: (id: string) => void templatesStore.recordCopy(id),
    onPlaceholderValuesChange: (id: string, vals: Record<string, string>) =>
      void templatesStore.recordPlaceholderValues(id, vals),
    onRevertHistory: (id: string, idx: number) => void templatesStore.revertHistory(id, idx),
  });

  // Ordered IDs the user can step through with ↑/↓. Paste mode follows the
  // ranked list; browse mode follows literal search results (which already
  // honour tag filters via `tagFiltered`). Stale ranking IDs are filtered out
  // so a deleted template doesn't leave a dead slot.
  const visibleTemplateIds = $derived.by(() => {
    if (inPasteMode) {
      const rankings = pasteMatchStore.rankings;
      if (!rankings) return [];
      const present = new Set(templates.map((t) => t.id));
      return rankings.map((r) => r.template_id).filter((id) => present.has(id));
    }
    return searchResults.map((h) => h.template.id);
  });

  // Snap selection to the first visible row when the current pick drops out
  // of the result set (e.g. user typed and the previous selection no longer
  // matches). Skips during baseMode/editing where the selection is locked.
  $effect(() => {
    if (agentStore.baseMode || editing) return;
    selectionStore.ensureSelection(visibleTemplateIds);
  });

  $effect(() => {
    void (async () => {
      try {
        const [env, version] = await Promise.all([
          getEnvWarnings(),
          getAppVersion().catch(() => "0.0.0"),
        ]);
        envApiKeyOverride = env.api_key_override;
        appVersion = version;
        await templatesStore.load();
        selectionStore.selectInitial(templatesStore.templates);
        const s = templatesStore.settings;
        tagsWidth = s.column_widths.tags;
        templatesWidth = s.column_widths.templates;
        agentSidebarWidth = s.column_widths.agent;
        contextWidth = s.column_widths.context ?? DEFAULT_COLUMN_WIDTHS.context;
        contextOpen = s.context_open;
      } catch (e) {
        // Surface the error and leave templates empty — DON'T fall back to
        // starter templates here. Any subsequent persist would overwrite the
        // user's (presumably recoverable) on-disk file with the starter set.
        templatesStore.loadError = String(e);
      }
    })();
  });

  function handleTagToggle(tag: string): void {
    selectionStore.toggleTag(tag);
  }

  function handleTagExclude(tag: string): void {
    selectionStore.excludeTag(tag);
  }

  function handleTagsClear(): void {
    selectionStore.clearTags();
  }

  function handleCombinatorToggle(): void {
    selectionStore.toggleTagCombinator();
  }

  function handleTemplateSelect(id: string, modifier: SelectModifier = "none"): void {
    if (editing) {
      editing = false;
      agentStore.exitEditMode();
    }
    selectionStore.selectTemplate(id, visibleTemplateIds, modifier);
  }

  function handleSearchChange(q: string): void {
    searchQuery = q;
  }

  // Drive the paste-match store off the search query. The debounce, staleness
  // guard, API call, and error handling all live in pasteMatchStore; this
  // effect just feeds it the current query (or clears it below the threshold,
  // preserving the original clear-and-return behavior).
  $effect(() => {
    const q = searchQuery;
    if (!settings.ai_enabled || q.trim().length < PASTE_THRESHOLD) {
      pasteMatchStore.clear();
      return;
    }
    pasteMatchStore.schedule(q, templates, settings.paste_backend, settings.models.rank);
  });

  async function retryRank(): Promise<void> {
    const q = searchQuery;
    if (q.trim().length < PASTE_THRESHOLD) return;
    await pasteMatchStore.retry(q, templates, settings.paste_backend, settings.models.rank);
  }

  // The Rust handler emits this when the quick-capture hotkey is pressed.
  // Read the clipboard and open the new-template form with the body
  // pre-filled. Skipped in User mode (no template creation allowed).
  $effect(() => {
    const unlisten = listen("quick-capture", async () => {
      if (!isEditorMode) return;
      let text = "";
      try {
        text = (await readText()) ?? "";
      } catch {
        text = "";
      }
      agentStore.handleNew(text);
    });
    return () => {
      void unlisten.then((u) => u());
    };
  });

  async function handleSave(updated: Template): Promise<void> {
    await templatesStore.handleSave(updated);
    editing = false;
    agentStore.exitEditMode();
  }

  function enterEditMode(): void {
    if (!selectedTemplate) return;
    editing = true;
    editAgentDraft = { opening: selectedTemplate.opening, body: selectedTemplate.body };
    editBodyUpdate = null;
    agentStore.enterEditMode(selectedTemplate);
  }

  function cancelEditMode(): void {
    editing = false;
    editBodyUpdate = null;
    agentStore.exitEditMode();
  }

  async function handleEditAgentPrompt(prompt: string): Promise<void> {
    const target = selectedTemplate;
    if (!target) return;
    const draft = editAgentDraft;
    await agentStore.handleEditAgentPrompt(draft, prompt, (updated) => {
      editAgentDraft = { ...draft, body: updated.body };
      editBodyUpdateSeq += 1;
      editBodyUpdate = { templateId: target.id, body: updated.body, seq: editBodyUpdateSeq };
    });
  }

  function handleEditDraftChange(draft: { opening: string; body: string }): void {
    editAgentDraft = draft;
  }

  // Parallels handleEditAgentPrompt for the new-template flow. The shared
  // draft is agentStore.baseDraft (kept current by handleCreateDraftChange
  // below), so the agent sees the user's latest in-form edits as context.
  async function handleCreateAgentPrompt(prompt: string): Promise<void> {
    await agentStore.handleEditAgentPrompt(agentStore.baseDraft, prompt, (updated) => {
      createBodyUpdateSeq += 1;
      createBodyUpdate = { templateId: null, body: updated.body, seq: createBodyUpdateSeq };
    });
  }

  function handleCreateDraftChange(draft: { opening: string; body: string }): void {
    agentStore.baseDraft = draft;
  }

  function ignoreDraftChange(): void {}

  async function duplicateSelectedTemplate(): Promise<void> {
    if (!selectedTemplate) return;
    const id = await templatesStore.duplicateTemplateById(selectedTemplate.id);
    if (id) selectionStore.selectedTemplateId = id;
  }

  async function deleteSelectedTemplate(): Promise<void> {
    if (!selectedTemplate) return;
    const id = selectedTemplate.id;
    await templatesStore.deleteTemplateById(id);
    selectionStore.pruneBulkSelection(new Set([id]));
    selectionStore.selectedTemplateId = templatesStore.templates[0]?.id ?? null;
  }

  async function handleSettingsUpdate(next: Settings): Promise<void> {
    await templatesStore.persist(templatesStore.templates, next);
  }

  async function handleRenameTag(from: string, to: string): Promise<void> {
    await templatesStore.handleRenameTag(
      from,
      to,
      selectionStore.selectedTagIds,
      selectionStore.excludedTagIds,
    );
    selectionStore.remapTag(from, to);
  }

  async function handleDeleteTag(tag: string): Promise<void> {
    await templatesStore.handleDeleteTag(
      tag,
      selectionStore.selectedTagIds,
      selectionStore.excludedTagIds,
    );
    selectionStore.removeTag(tag);
  }

  function openContextForTemplate(id: string, x: number, y: number): void {
    const tpl = templates.find((t) => t.id === id);
    if (!tpl) return;

    // Bulk menu: when the right-clicked row is part of a >1 selection, show
    // bulk actions instead of per-template ones. Otherwise fall through to
    // the single-template menu.
    const bulk = selectionStore.bulkSelectedIds;
    if (bulk.size > 1 && bulk.has(id)) {
      const count = bulk.size;
      const items: ContextMenuItem[] = [];
      if (isEditorMode) {
        items.push({
          label: `Add tag to ${count}…`,
          onClick: () => (bulkTagPromptOpen = true),
        });
        items.push({
          label: `Remove tag from ${count}…`,
          onClick: () => (bulkRemoveTagPromptOpen = true),
        });
      }
      items.push({ label: `Export ${count}…`, onClick: () => void templatesStore.bulkExport(bulk) });
      if (isEditorMode) {
        items.push({
          label: `Delete ${count}`,
          danger: true,
          onClick: () => (bulkDeleteConfirmOpen = true),
        });
      }
      contextMenu = { x, y, items };
      return;
    }

    const items: ContextMenuItem[] = [];
    if (isEditorMode) {
      items.push({
        label: tpl.pinned ? "Unpin" : "Pin",
        onClick: () => void templatesStore.togglePin(id),
      });
      items.push({
        label: "Duplicate",
        onClick: async () => {
          const copyId = await templatesStore.duplicateTemplateById(id);
          if (copyId) selectionStore.selectedTemplateId = copyId;
        },
      });
    }
    items.push({ label: "Export…", onClick: () => void templatesStore.exportSingleTemplate(id) });
    if (isEditorMode) {
      items.push({
        label: "Delete",
        danger: true,
        onClick: () => (contextDeleteTarget = tpl),
      });
    }
    contextMenu = { x, y, items };
  }

  let bulkDeleteConfirmOpen = $state(false);
  let bulkTagPromptOpen = $state(false);
  let bulkRemoveTagPromptOpen = $state(false);
  let bulkTagDraft = $state("");

  async function confirmBulkDelete(): Promise<void> {
    const ids = new Set(selectionStore.bulkSelectedIds);
    bulkDeleteConfirmOpen = false;
    await templatesStore.bulkDelete(ids);
    selectionStore.bulkSelectedIds = new Set();
    if (selectionStore.selectedTemplateId !== null && ids.has(selectionStore.selectedTemplateId)) {
      selectionStore.selectedTemplateId = templates[0]?.id ?? null;
    }
  }

  async function confirmBulkTag(): Promise<void> {
    const tag = bulkTagDraft.trim();
    if (tag.length === 0) return;
    bulkTagPromptOpen = false;
    bulkTagDraft = "";
    await templatesStore.bulkAddTag(selectionStore.bulkSelectedIds, tag);
  }

  async function confirmBulkRemoveTag(): Promise<void> {
    const tag = bulkTagDraft.trim();
    if (tag.length === 0) return;
    bulkRemoveTagPromptOpen = false;
    bulkTagDraft = "";
    await templatesStore.bulkRemoveTag(selectionStore.bulkSelectedIds, tag);
  }

  function openContextForEmpty(x: number, y: number): void {
    contextMenu = {
      x,
      y,
      items: [
        {
          label: "Open data folder",
          onClick: () => {
            openDataDir().catch((e) => (templatesStore.loadError = `open folder failed: ${e}`));
          },
        },
      ],
    };
  }

  function closeContextMenu(): void {
    contextMenu = null;
  }

  async function confirmContextDelete(): Promise<void> {
    if (!contextDeleteTarget) return;
    const id = contextDeleteTarget.id;
    contextDeleteTarget = null;
    await templatesStore.deleteTemplateById(id);
    selectionStore.pruneBulkSelection(new Set([id]));
    if (selectionStore.selectedTemplateId === id) {
      selectionStore.selectedTemplateId = templatesStore.templates[0]?.id ?? null;
    }
  }

  function cancelContextDelete(): void {
    contextDeleteTarget = null;
  }

  // Subscribe to streaming partials from the sidecar. The event fires for
  // any agent edit in flight; since the UI only allows one at a time
  // (agentBusy gate) we don't need to correlate by id.
  $effect(() => {
    const unlistenPromise = onSidecarProgress((text) => {
      if (agentStore.agentBusy) agentStore.agentProgress = text;
    });
    return () => {
      void unlistenPromise.then((u) => u());
    };
  });

  $effect(() => {
    if (typeof document !== "undefined") {
      document.documentElement.dataset.theme = settings.theme;
    }
  });

  // Keep the sidecar's source list in sync with persisted settings. The effect
  // re-fires on any settings reassignment, so we dedupe against the last
  // forwarded value — otherwise unrelated changes (context_open toggle, theme,
  // column widths) would trigger a redundant chokidar restart on the sidecar.
  //
  // Lazy-sidecar interplay: when both the prior and current source lists are
  // empty we skip the call entirely, so a browse-and-copy session never wakes
  // the Node process. Once the user adds or removes a source we sync as
  // before (including pushing `[]` to clear).
  let lastForwardedSourcesJson = "";
  let lastForwardedBackend: typeof settings.paste_backend | null = null;
  let lastForwardedModel: typeof settings.models.context | null = null;
  $effect(() => {
    if (!loaded || !settings.ai_enabled) return;
    const sources = settings.context_sources;
    const backend = settings.paste_backend;
    const model = settings.models.context;
    const sourcesJson = JSON.stringify(sources);
    if (
      sourcesJson === lastForwardedSourcesJson &&
      backend === lastForwardedBackend &&
      model === lastForwardedModel
    )
      return;
    const skip =
      lastForwardedSourcesJson === "" &&
      lastForwardedBackend === null &&
      lastForwardedModel === null &&
      sources.length === 0;
    lastForwardedSourcesJson = sourcesJson;
    lastForwardedBackend = backend;
    lastForwardedModel = model;
    if (skip) return;
    void setContextSources(sources, backend, model).catch(() => {
      /* sidecar may be down; pane will surface the error */
    });
  });

  $effect(() => {
    // Webview-level zoom (Ctrl+/− style) reflows scrollbars and hit-testing
    // correctly — CSS `zoom` clips fixed-height flex layouts.
    const z = settings.zoom ?? 1;
    void getCurrentWebview().setZoom(z).catch(() => {});
  });

  // Tray menu → Settings emits this; Rust has already shown + focused the window.
  $effect(() => {
    const unlisten = listen("open-settings", () => {
      settingsOpen = true;
    });
    return () => {
      void unlisten.then((u) => u());
    };
  });

  // The new sidecar process has empty in-memory state — re-push the source
  // list so the Context pane and adapt/edit calls stay consistent.
  $effect(() => {
    const unlisten = listen("sidecar-respawned", () => {
      lastForwardedSourcesJson = "";
      lastForwardedBackend = null;
      lastForwardedModel = null;
      if (!templatesStore.settings.ai_enabled) return;
      void setContextSources(settings.context_sources, settings.paste_backend, settings.models.context).catch(() => {});
    });
    return () => {
      void unlisten.then((u) => u());
    };
  });

  // An adapt error refers to a specific inbound message. Once that message is
  // gone (search cleared or shortened below the threshold) the Retry button
  // would silently no-op — drop the stale error instead.
  $effect(() => {
    if (!inPasteMode && agentStore.adaptError !== null) agentStore.adaptError = null;
  });

  // Drop the agent → form body signal when the new-template flow exits.
  // Unlike edit mode (which dedupes by templateId), create mode uses
  // templateId=null, so a stale signal would re-apply on next mount.
  $effect(() => {
    if (!agentStore.baseMode && createBodyUpdate !== null) {
      createBodyUpdate = null;
      createBodyUpdateSeq = 0;
    }
  });

  // Global keyboard shortcuts. The handler body lives in $lib/keyboard.ts;
  // these getters/actions are everything it closes over (live reads via
  // getters so each keystroke sees current state).
  const handleGlobalKeydown = createGlobalKeydownHandler({
    isContextDeleteOpen: () => contextDeleteTarget !== null,
    isSettingsOpen: () => settingsOpen,
    isBulkDeleteConfirmOpen: () => bulkDeleteConfirmOpen,
    isBulkTagPromptOpen: () => bulkTagPromptOpen,
    isBulkRemoveTagPromptOpen: () => bulkRemoveTagPromptOpen,
    isCheatSheetOpen: () => cheatSheetOpen,
    setCheatSheetOpen: (v) => (cheatSheetOpen = v),
    isCaptureOpen: () => captureOpen,
    setCaptureOpen: (v) => (captureOpen = v),
    isAiEnabled: () => settings.ai_enabled,
    getZoom: () => templatesStore.settings.zoom ?? 1,
    setZoom,
    zoomStep: ZOOM_STEP,
    getSearchInput: () => searchInput,
    getSearchQuery: () => searchQuery,
    clearSearch,
    isBaseMode: () => agentStore.baseMode,
    isEditing: () => editing,
    isEditorMode: () => isEditorMode,
    isInputFocused,
    moveSelection,
    copySelected,
    performUndo: () => void templatesStore.performUndo(),
  });
</script>

<svelte:window onkeydown={handleGlobalKeydown} oncontextmenu={handleGlobalContextMenu} />

<div class="frame">
  <TitleBar
    onOpenSettings={() => (settingsOpen = true)}
    onToggleContext={() => {
      contextOpen = !contextOpen;
      void templatesStore.persist(templatesStore.templates, { ...templatesStore.settings, context_open: contextOpen });
    }}
    {contextOpen}
    onToggleCapture={() => (captureOpen = !captureOpen)}
    {captureOpen}
    aiEnabled={settings.ai_enabled}
    showSearch={!agentStore.baseMode && !editing}
    {searchQuery}
    onSearchChange={handleSearchChange}
    onClearSearch={clearSearch}
    onSearchInputMount={(el) => (searchInput = el ?? undefined)}
    aiActive={inPasteMode}
    aiBusy={inPasteMode && pasteMatchStore.rankLoading}
  />
  <div class="shell">
    {#if !loaded}
      <aside class="skel skel-tags" style="width: {tagsWidth}px" aria-hidden="true">
        {#each Array(7) as _, i (i)}
          <div class="skel-row" style="animation-delay: {i * 80}ms"></div>
        {/each}
      </aside>
      <aside class="skel skel-templates" style="width: {templatesWidth}px" aria-hidden="true">
        {#each Array(9) as _, i (i)}
          <div class="skel-row tall" style="animation-delay: {i * 80}ms"></div>
        {/each}
      </aside>
      <section class="skel skel-main" aria-hidden="true">
        <div class="skel-line wide"></div>
        <div class="skel-line"></div>
        <div class="skel-block"></div>
      </section>
    {:else if agentStore.baseMode}
      {#if settings.ai_enabled}
        <AgentSidebar
          kind={agentStore.baseKind}
          messages={agentStore.agentMessages}
          busy={agentStore.agentBusy}
          error={agentStore.agentError}
          progress={agentStore.agentProgress}
          sourceName={agentStore.baseSourceName}
          width={agentSidebarWidth}
          onSubmit={(p) =>
            agentStore.baseKind === "new"
              ? void handleCreateAgentPrompt(p)
              : agentStore.handleAgentPrompt(p)}
        />
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          class="col-resize"
          title="Drag to resize"
          onpointerdown={startResize("agent")}
        ></div>
      {/if}
      {#if agentStore.saveDraft !== null}
        <MainPanel
          {...sharedMainPanelProps}
          template={null}
          creatingDraft={agentStore.saveDraft}
          editing={false}
          inboundText={null}
          onEnterEdit={() => {}}
          onCancelEdit={() =>
            agentStore.baseKind === "new"
              ? agentStore.exitBaseMode()
              : agentStore.closeSaveAs()}
          onSave={() => {}}
          onCreate={(d) => void agentStore.commitNewTemplate(d)}
          onDuplicate={() => {}}
          onDelete={() => {}}
          onBaseOnTemplate={() => {}}
          onAdaptToInbound={() => {}}
          aiBodyUpdate={agentStore.baseKind === "new" ? createBodyUpdate : null}
          onDraftChange={agentStore.baseKind === "new" ? handleCreateDraftChange : ignoreDraftChange}
        />
      {:else}
        <EditorPane
          kind={agentStore.baseKind}
          opening={agentStore.baseDraft.opening}
          body={agentStore.baseDraft.body}
          globalSignature={settings.global_signature}
          {includeOpening}
          {includeSignature}
          canSave={isEditorMode}
          onUpdate={(next) => (agentStore.baseDraft = next)}
          onToggleOpening={(v) => (includeOpening = v)}
          onToggleSignature={(v) => (includeSignature = v)}
          onSave={() => agentStore.openSaveAs()}
          onCancel={() => agentStore.exitBaseMode()}
        />
      {/if}
    {:else if editing}
      {#if settings.ai_enabled}
        <AgentSidebar
          kind="edit"
          messages={agentStore.agentMessages}
          busy={agentStore.agentBusy}
          error={agentStore.agentError}
          progress={agentStore.agentProgress}
          sourceName={selectedTemplate?.name ?? agentStore.baseSourceName}
          width={agentSidebarWidth}
          onSubmit={(p) => void handleEditAgentPrompt(p)}
        />
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          class="col-resize"
          title="Drag to resize"
          onpointerdown={startResize("agent")}
        ></div>
      {/if}
      <MainPanel
        {...sharedMainPanelProps}
        template={selectedTemplate}
        editing={true}
        inboundText={null}
        onEnterEdit={() => {}}
        onCancelEdit={cancelEditMode}
        onSave={handleSave}
        onDuplicate={() => void duplicateSelectedTemplate()}
        onDelete={() => void deleteSelectedTemplate()}
        onBaseOnTemplate={() => agentStore.enterBaseMode(selectedTemplate)}
        onAdaptToInbound={() => void agentStore.adaptToInbound(selectedTemplate, searchQuery, PASTE_THRESHOLD)}
        aiBodyUpdate={editBodyUpdate}
        onDraftChange={handleEditDraftChange}
      />
    {:else}
      <TagsSidebar
        {templates}
        selectedTagIds={selectionStore.selectedTagIds}
        excludedTagIds={selectionStore.excludedTagIds}
        tagCombinator={selectionStore.tagCombinator}
        tagOrder={settings.tag_order}
        width={tagsWidth}
        onTagToggle={handleTagToggle}
        onTagExclude={handleTagExclude}
        onTagsClear={handleTagsClear}
        onCombinatorToggle={handleCombinatorToggle}
        onContextEmpty={openContextForEmpty}
        onTagReorder={(next) => void templatesStore.handleTagsReorder(next)}
      />
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="col-resize"
        title="Drag to resize"
        onpointerdown={startResize("tags")}
      ></div>
      <TemplatesSidebar
        {searchResults}
        {templates}
        selectedTemplateId={selectionStore.selectedTemplateId}
        bulkSelectedIds={selectionStore.bulkSelectedIds}
        {inPasteMode}
        rankings={pasteMatchStore.rankings}
        rankLoading={pasteMatchStore.rankLoading}
        rankError={pasteMatchStore.rankError}
        width={templatesWidth}
        canCreate={isEditorMode}
        canReorder={canReorderTemplates}
        sortMode={settings.sort_mode}
        onTemplateSelect={handleTemplateSelect}
        onNew={() => agentStore.handleNew()}
        onRetryRank={retryRank}
        onContextTemplate={openContextForTemplate}
        onContextEmpty={openContextForEmpty}
        onReorder={(ids) => void templatesStore.handleTemplatesReorder(ids)}
        onMoveToFolder={(ids, folder) => void templatesStore.moveToFolder(ids, folder)}
        onSortModeToggle={() => templatesStore.handleSortModeToggle()}
        onBulkAddTag={() => (bulkTagPromptOpen = true)}
        onBulkRemoveTag={() => (bulkRemoveTagPromptOpen = true)}
        onBulkExport={() => void templatesStore.bulkExport(selectionStore.bulkSelectedIds)}
        onBulkDelete={() => (bulkDeleteConfirmOpen = true)}
      />
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="col-resize"
        title="Drag to resize"
        onpointerdown={startResize("templates")}
      ></div>
      <MainPanel
        {...sharedMainPanelProps}
        template={selectedTemplate}
        {editing}
        inboundText={inPasteMode ? searchQuery : null}
        onEnterEdit={enterEditMode}
        onCancelEdit={cancelEditMode}
        onSave={handleSave}
        onDuplicate={() => void duplicateSelectedTemplate()}
        onDelete={() => void deleteSelectedTemplate()}
        onBaseOnTemplate={() => agentStore.enterBaseMode(selectedTemplate)}
        onAdaptToInbound={() => void agentStore.adaptToInbound(selectedTemplate, searchQuery, PASTE_THRESHOLD)}
        aiBodyUpdate={null}
        onDraftChange={ignoreDraftChange}
      />
    {/if}
    {#if contextOpen && loaded && settings.ai_enabled}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="col-resize"
        title="Drag to resize"
        onpointerdown={startResize("context")}
      ></div>
      <ContextPane
        width={contextWidth}
        sources={settings.context_sources}
        backend={settings.paste_backend}
        model={settings.models.context}
        onClose={() => (contextOpen = false)}
        onSourcesChange={async (next) => {
          await templatesStore.persist(templatesStore.templates, { ...templatesStore.settings, context_sources: next });
        }}
      />
    {/if}
    {#if templatesStore.loadError}
      <div class="error-banner">
        <span class="error-text">{templatesStore.loadError}</span>
        <button class="error-close" aria-label="Dismiss error" onclick={() => (templatesStore.loadError = null)}>×</button>
      </div>
    {/if}
    {#if undoToast}
      <div class="undo-toast" style="bottom: {templatesStore.loadError ? 48 : 12}px">{undoToast}</div>
    {/if}
  </div>
</div>

<ResizeHandles />

{#if settingsOpen}
  <SettingsModal
    {settings}
    {envApiKeyOverride}
    currentVersion={appVersion}
    tagCounts={settingsTagCounts}
    onClose={() => (settingsOpen = false)}
    onUpdate={handleSettingsUpdate}
    onExportTemplates={handleExportTemplates}
    onImportTemplates={handleImportTemplates}
    onCheckUpdate={checkForUpdate}
    onListBackups={listTemplateBackups}
    onRestoreBackup={(name) => templatesStore.handleRestoreBackup(name)}
    onRenameTag={handleRenameTag}
    onDeleteTag={handleDeleteTag}
    onOpenCheatSheet={() => {
      settingsOpen = false;
      cheatSheetOpen = true;
    }}
  />
{/if}

{#if cheatSheetOpen}
  <CheatSheet
    globalHotkey={settings.global_hotkey}
    aiEnabled={settings.ai_enabled}
    onClose={() => (cheatSheetOpen = false)}
  />
{/if}

{#if captureOpen && loaded && settings.ai_enabled}
  <MemoryCapturePopover
    sources={settings.context_sources}
    backend={settings.paste_backend}
    model={settings.models.memory}
    onClose={() => (captureOpen = false)}
    onAddSource={() => {
      captureOpen = false;
      contextOpen = true;
      void templatesStore.persist(templatesStore.templates, { ...templatesStore.settings, context_open: true });
    }}
  />
{/if}

{#if loaded && !settings.onboarding_complete}
  <OnboardingTour
    aiEnabled={settings.ai_enabled}
    onDismiss={() => {
      void templatesStore.persist(templatesStore.templates, {
        ...templatesStore.settings,
        onboarding_complete: true,
        close_hint_shown: true,
      });
    }}
  />
{/if}

{#if bulkDeleteConfirmOpen}
  <ConfirmDialog
    title="Delete {selectionStore.bulkSelectedIds.size} templates?"
    message="Ctrl+Z will restore them."
    confirmLabel="Delete {selectionStore.bulkSelectedIds.size}"
    danger
    ariaLabel="Confirm bulk delete"
    onConfirm={() => void confirmBulkDelete()}
    onCancel={() => (bulkDeleteConfirmOpen = false)}
  />
{/if}

{#if bulkTagPromptOpen}
  <ConfirmDialog
    title="Add tag to {selectionStore.bulkSelectedIds.size} templates"
    confirmLabel="Add"
    ariaLabel="Bulk add tag"
    input
    bind:inputValue={bulkTagDraft}
    inputPlaceholder="tag name"
    confirmDisabled={bulkTagDraft.trim().length === 0}
    onConfirm={() => void confirmBulkTag()}
    onCancel={() => {
      bulkTagPromptOpen = false;
      bulkTagDraft = "";
    }}
    onDismiss={() => (bulkTagPromptOpen = false)}
  />
{/if}

{#if bulkRemoveTagPromptOpen}
  <ConfirmDialog
    title="Remove tag from {selectionStore.bulkSelectedIds.size} templates"
    confirmLabel="Remove"
    danger
    ariaLabel="Bulk remove tag"
    input
    bind:inputValue={bulkTagDraft}
    inputPlaceholder="tag name"
    confirmDisabled={bulkTagDraft.trim().length === 0}
    onConfirm={() => void confirmBulkRemoveTag()}
    onCancel={() => {
      bulkRemoveTagPromptOpen = false;
      bulkTagDraft = "";
    }}
    onDismiss={() => (bulkRemoveTagPromptOpen = false)}
  />
{/if}

{#if contextMenu}
  <ContextMenu
    x={contextMenu.x}
    y={contextMenu.y}
    items={contextMenu.items}
    onClose={closeContextMenu}
  />
{/if}

{#if contextDeleteTarget}
  <ConfirmDialog
    title="Delete template?"
    name={contextDeleteTarget.name}
    message="Ctrl+Z will restore it."
    confirmLabel="Delete"
    danger
    onConfirm={() => void confirmContextDelete()}
    onCancel={cancelContextDelete}
  />
{/if}

<style>
  :global(:root) {
    --bg-base: #1c1c1e;
    --bg-elevated: #18181a;
    --bg-titlebar: #141416;
    --bg-input: #121214;
    --bg-hover: #25252a;
    --bg-active: #2d2d33;
    --border: #2a2a2e;
    --border-strong: #3a3a40;
    --border-focus: #5a5a62;
    --text: #e8e6e3;
    --text-strong: #f3f1ee;
    --text-muted: #8c8a86;
    --text-subtle: #6a6862;
    --text-deemphasis: #7a7874;
    --text-placeholder: #56544f;
    --shadow: rgba(0, 0, 0, 0.6);
    --backdrop: rgba(0, 0, 0, 0.5);
    --accent-brand: #cc785c;
    --accent-brand-hover: #d88a6f;
    --accent-brand-soft: #3a2419;
    --accent-brand-text: #f5d4c4;
    --accent-positive-bg: #2a3a2a;
    --accent-positive-border: #3a5a3a;
    --accent-positive-text: #d0e0d0;
    --accent-positive-hover: #34453a;
    --accent-danger-bg: #3a2222;
    --accent-danger-border: #5a3030;
    --accent-danger-text: #ff9a9a;
    --accent-warning-bg: #3a2a16;
    --accent-warning-border: #5a4426;
    --accent-warning-text: #f0d090;
    --accent-warning-strong: #ffe0a0;
    --accent-info-bg: #1a2a3a;
    --accent-info-border: #2a4a6a;
    --accent-info-text: #a8c8e8;
    --rank-error-bg: #2a1a1a;
  }

  :global([data-theme="light"]) {
    --bg-base: #f7f5f1;
    --bg-elevated: #f1ede6;
    --bg-titlebar: #ebe7df;
    --bg-input: #fdfcf9;
    --bg-hover: #e4dfd5;
    --bg-active: #d8d2c5;
    --border: #ddd6c8;
    --border-strong: #c2bbac;
    --border-focus: #8a8275;
    --text: #2a2724;
    --text-strong: #161310;
    --text-muted: #5c5852;
    --text-subtle: #8c8780;
    --text-deemphasis: #6f6a62;
    --text-placeholder: #b0aa9e;
    --shadow: rgba(60, 50, 35, 0.18);
    --backdrop: rgba(0, 0, 0, 0.3);
    --accent-brand: #c5613e;
    --accent-brand-hover: #b4542f;
    --accent-brand-soft: #f5e0d4;
    --accent-brand-text: #6d2c14;
    --accent-positive-bg: #d4eada;
    --accent-positive-border: #88c896;
    --accent-positive-text: #1e5f2e;
    --accent-positive-hover: #c0e0c8;
    --accent-danger-bg: #fbe2e2;
    --accent-danger-border: #e0a0a0;
    --accent-danger-text: #9a2a2a;
    --accent-warning-bg: #fbf0d8;
    --accent-warning-border: #d8b870;
    --accent-warning-text: #7a5510;
    --accent-warning-strong: #5a3f00;
    --accent-info-bg: #dde8f4;
    --accent-info-border: #a0b8d0;
    --accent-info-text: #2a4a6a;
    --rank-error-bg: #fbe2e2;
  }

  :global(html) {
    margin: 0;
    padding: 0;
    height: 100%;
    background: transparent;
    color: var(--text);
    font-family: Inter, system-ui, sans-serif;
    overflow: hidden;
  }

  :global(body) {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
    height: 100vh;
    background: transparent;
    overflow: hidden;
  }

  :global(#svelte) {
    height: 100%;
  }

  :global(::-webkit-scrollbar) {
    width: 10px;
    height: 10px;
  }

  :global(::-webkit-scrollbar-track) {
    background: transparent;
  }

  :global(::-webkit-scrollbar-thumb) {
    background: var(--border);
    border-radius: 5px;
    border: 2px solid transparent;
    background-clip: content-box;
    min-height: 28px;
  }

  :global(::-webkit-scrollbar-thumb:hover) {
    background: var(--border-strong);
    background-clip: content-box;
    border: 2px solid transparent;
  }

  :global(::-webkit-scrollbar-thumb:active) {
    background: var(--border-focus);
    background-clip: content-box;
    border: 2px solid transparent;
  }

  :global(::-webkit-scrollbar-corner) {
    background: transparent;
  }

  .frame {
    display: flex;
    flex-direction: column;
    height: 100%;
    width: 100%;
    background: var(--bg-base);
    border: 1px solid var(--border);
    border-radius: 8px;
    box-shadow: 0 4px 24px var(--shadow), 0 0 0 1px rgba(0, 0, 0, 0.2);
    overflow: hidden;
    position: relative;
  }

  .shell {
    display: flex;
    flex: 1;
    width: 100%;
    position: relative;
    min-height: 0;
  }

  .skel {
    flex-shrink: 0;
    border-right: 1px solid var(--border);
    background: var(--bg-elevated);
    padding: 12px 8px;
    box-sizing: border-box;
  }

  .skel-main {
    flex: 1;
    padding: 20px 24px;
    background: var(--bg-base);
    border-right: none;
  }

  .skel-row,
  .skel-line,
  .skel-block {
    background: var(--bg-hover);
    border-radius: 4px;
    animation: skel-pulse 1.4s ease-in-out infinite;
  }

  .skel-row {
    height: 18px;
    margin: 6px 4px;
  }

  .skel-row.tall {
    height: 28px;
  }

  .skel-line {
    height: 14px;
    width: 60%;
    margin-bottom: 12px;
  }

  .skel-line.wide {
    width: 80%;
    height: 22px;
    margin-bottom: 8px;
  }

  .skel-block {
    height: 240px;
    margin-top: 16px;
  }

  @keyframes skel-pulse {
    0%, 100% { opacity: 0.45; }
    50% { opacity: 0.85; }
  }

  .col-resize {
    width: 5px;
    flex-shrink: 0;
    cursor: col-resize;
    background: transparent;
    transition: background 120ms;
    margin-left: -1px;
    margin-right: -1px;
    position: relative;
    z-index: 2;
  }

  .col-resize:hover,
  :global(.col-resize.dragging) {
    background: var(--border-focus);
  }

  .error-banner {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    background: var(--accent-danger-bg);
    color: var(--accent-danger-text);
    padding: 6px 12px;
    font-size: 0.8rem;
    border-top: 1px solid var(--accent-danger-border);
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .error-text {
    flex: 1;
    min-width: 0;
  }

  .error-close {
    background: transparent;
    border: none;
    color: var(--accent-danger-text);
    cursor: pointer;
    font-size: 1.1rem;
    line-height: 1;
    padding: 0 4px;
    flex-shrink: 0;
  }

  .error-close:hover {
    opacity: 0.7;
  }

  .undo-toast {
    position: absolute;
    bottom: 12px;
    left: 50%;
    transform: translateX(-50%);
    background: var(--bg-active);
    color: var(--text-strong);
    border: 1px solid var(--border-strong);
    padding: 6px 14px;
    border-radius: 6px;
    font-size: 0.8rem;
    pointer-events: none;
    box-shadow: 0 4px 12px var(--shadow);
    z-index: 200;
  }
</style>
