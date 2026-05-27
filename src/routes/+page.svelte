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
  import CheatSheet from "$lib/components/CheatSheet.svelte";
  import OnboardingTour from "$lib/components/OnboardingTour.svelte";
  import ContextPane from "$lib/components/ContextPane.svelte";
  import MemoryCapturePopover from "$lib/components/MemoryCapturePopover.svelte";
  import { writeText, readText } from "@tauri-apps/plugin-clipboard-manager";
  import { getCurrentWebview } from "@tauri-apps/api/webview";
  import { listen } from "@tauri-apps/api/event";
  import { searchTemplates } from "$lib/search";
  import {
    rankTemplates,
    getEnvWarnings,
    explainRankError,
    openDataDir,
    checkForUpdate,
    getAppVersion,
    onSidecarProgress,
    listTemplateBackups,
    setContextSources,
    type Ranking,
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

  const PASTE_THRESHOLD = 30;
  const RANK_DEBOUNCE_MS = 600;

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
    const target = e.target as HTMLElement | null;
    if (!target) {
      e.preventDefault();
      return;
    }
    const tag = target.tagName;
    const isInputLike = tag === "INPUT" || tag === "TEXTAREA";

    if (isInputLike) {
      e.preventDefault();
      const input = target as HTMLInputElement | HTMLTextAreaElement;
      const start = input.selectionStart ?? 0;
      const end = input.selectionEnd ?? 0;
      const hasSelection = start !== end;
      contextMenu = {
        x: e.clientX,
        y: e.clientY,
        items: [
          {
            label: "Paste",
            onClick: async () => {
              let text: string | null;
              try {
                text = await readText();
              } catch {
                return;
              }
              if (text == null || text.length === 0) return;
              input.focus();
              // execCommand("insertText") feeds through the native input
              // pipeline, preserving the browser undo stack so Ctrl+Z works
              // afterwards. Falls back to direct mutation if unsupported.
              const ok = document.execCommand("insertText", false, text);
              if (!ok) {
                const s = input.selectionStart ?? input.value.length;
                const en = input.selectionEnd ?? input.value.length;
                input.value = input.value.slice(0, s) + text + input.value.slice(en);
                const caret = s + text.length;
                input.setSelectionRange(caret, caret);
                input.dispatchEvent(new Event("input", { bubbles: true }));
              }
            },
          },
          {
            label: "Copy",
            disabled: !hasSelection,
            onClick: () => {
              const slice = input.value.slice(start, end);
              if (slice.length > 0) void writeText(slice);
            },
          },
          {
            label: "Select all",
            onClick: () => {
              input.focus();
              input.select();
            },
          },
        ],
      };
      return;
    }

    // Outside an input: contenteditable still gets default menu;
    // otherwise show Copy when there's a text selection, else suppress.
    if (target.isContentEditable) return;

    const selectedText = window.getSelection()?.toString() ?? "";
    if (selectedText.length > 0) {
      e.preventDefault();
      contextMenu = {
        x: e.clientX,
        y: e.clientY,
        items: [
          {
            label: "Copy",
            onClick: () => {
              void writeText(selectedText);
            },
          },
        ],
      };
      return;
    }
    e.preventDefault();
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

  function handleGlobalKeydown(e: KeyboardEvent): void {
    if (contextDeleteTarget) {
      if (e.key === "Escape") {
        e.preventDefault();
        cancelContextDelete();
      } else if (e.key === "Enter") {
        e.preventDefault();
        void confirmContextDelete();
      }
      return;
    }
    if (settingsOpen) return;
    // Bulk-action modals + cheat sheet own Escape while open. Returning here
    // prevents the rest of the handler from running (e.g. arrow keys moving
    // selection underneath an open dialog).
    if (bulkDeleteConfirmOpen) {
      if (e.key === "Escape") {
        e.preventDefault();
        bulkDeleteConfirmOpen = false;
      }
      return;
    }
    if (bulkTagPromptOpen) {
      if (e.key === "Escape") {
        e.preventDefault();
        bulkTagPromptOpen = false;
        bulkTagDraft = "";
      }
      return;
    }
    if (bulkRemoveTagPromptOpen) {
      if (e.key === "Escape") {
        e.preventDefault();
        bulkRemoveTagPromptOpen = false;
        bulkTagDraft = "";
      }
      return;
    }
    // ? toggles the cheat sheet — runs before the cheatSheetOpen guard so the
    // same key both opens AND closes. Skip when typing in an input so Shift+/
    // still types literally.
    if (e.key === "?" && !isInputFocused()) {
      e.preventDefault();
      cheatSheetOpen = !cheatSheetOpen;
      return;
    }
    if (cheatSheetOpen) {
      // CheatSheet.svelte has its own window listener for Escape — just
      // suppress global shortcuts so e.g. arrow keys don't move selection.
      return;
    }
    // Capture toggle runs before the captureOpen early-return so the same
    // chord both opens and closes the popover.
    if (
      (e.ctrlKey || e.metaKey) &&
      e.shiftKey &&
      !e.altKey &&
      e.key.toLowerCase() === "m"
    ) {
      e.preventDefault();
      captureOpen = !captureOpen;
      return;
    }
    if (captureOpen) {
      // MemoryCapturePopover owns Escape via its own listener. Suppress
      // global shortcuts so Ctrl+F / Ctrl+L / zoom don't steal focus while
      // the modal popover is showing.
      return;
    }
    const ctrlOnly = (e.ctrlKey || e.metaKey) && !e.altKey;
    if (ctrlOnly && (e.key === "+" || e.key === "=")) {
      e.preventDefault();
      setZoom((templatesStore.settings.zoom ?? 1) + ZOOM_STEP);
      return;
    }
    if (ctrlOnly && (e.key === "-" || e.key === "_")) {
      e.preventDefault();
      setZoom((templatesStore.settings.zoom ?? 1) - ZOOM_STEP);
      return;
    }
    if (ctrlOnly && e.key === "0") {
      e.preventDefault();
      setZoom(1);
      return;
    }
    if (e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey && e.key.toLowerCase() === "l") {
      e.preventDefault();
      clearSearch();
      return;
    }
    if (e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey && e.key.toLowerCase() === "f") {
      // Suppress the webview's default Find dialog — the search input IS our find.
      e.preventDefault();
      if (searchInput) {
        searchInput.focus();
        searchInput.select();
      }
      return;
    }
    // Esc in the search box clears it — matches the Gmail/Slack convention.
    // Scoped to the search input so Esc in other fields keeps native behaviour.
    if (e.key === "Escape" && document.activeElement === searchInput && searchQuery.length > 0) {
      e.preventDefault();
      clearSearch();
      return;
    }

    if (agentStore.baseMode || editing) return;
    const inSearch = document.activeElement === searchInput;
    if (!inSearch && isInputFocused()) return;

    // Ctrl/Cmd+Z: undo the last template-list mutation. Native text undo wins
    // inside inputs — including the search box, which we let through the
    // isInputFocused guard above. Disabled in User mode where mutations can't
    // happen anyway.
    if (ctrlOnly && !e.shiftKey && e.key.toLowerCase() === "z" && isEditorMode && !inSearch) {
      e.preventDefault();
      void templatesStore.performUndo();
      return;
    }

    if (e.key === "ArrowDown") {
      e.preventDefault();
      moveSelection(1);
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      moveSelection(-1);
      return;
    }
    // Enter copies when search is focused OR when no element is focused (body).
    // Excludes a focused button — that case already gets a native Enter→click,
    // so firing copySelected() too would double-trigger.
    const activeIsBody = document.activeElement === document.body;
    if (
      e.key === "Enter" &&
      (inSearch || activeIsBody) &&
      !e.shiftKey &&
      !e.ctrlKey &&
      !e.altKey &&
      !e.metaKey
    ) {
      e.preventDefault();
      copySelected();
    }
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
  let settingsOpen = $state(false);
  let cheatSheetOpen = $state(false);

  let rankings = $state<Ranking[] | null>(null);
  let rankLoading = $state(false);
  let rankError = $state<string | null>(null);
  let rankTimer: ReturnType<typeof setTimeout> | null = null;

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

  const inPasteMode = $derived(searchQuery.trim().length >= PASTE_THRESHOLD);

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
  // manager. Mirrors the order rule in TagsSidebar (tag_order first, then
  // count-desc / name-asc).
  const settingsTagCounts = $derived.by(() => {
    const counts = new Map<string, number>();
    for (const t of templates) for (const tag of t.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    const idx = new Map<string, number>();
    settings.tag_order.forEach((t, i) => idx.set(t, i));
    const all = [...counts.entries()];
    all.sort((a, b) => {
      const ai = idx.get(a[0]);
      const bi = idx.get(b[0]);
      if (ai !== undefined && bi !== undefined) return ai - bi;
      if (ai !== undefined) return -1;
      if (bi !== undefined) return 1;
      return b[1] - a[1] || a[0].localeCompare(b[0]);
    });
    return all;
  });

  // Ordered IDs the user can step through with ↑/↓. Paste mode follows the
  // ranked list; browse mode follows literal search results (which already
  // honour tag filters via `tagFiltered`). Stale ranking IDs are filtered out
  // so a deleted template doesn't leave a dead slot.
  const visibleTemplateIds = $derived.by(() => {
    if (inPasteMode) {
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

  $effect(() => {
    if (rankTimer) {
      clearTimeout(rankTimer);
      rankTimer = null;
    }
    const q = searchQuery;
    if (q.trim().length < PASTE_THRESHOLD) {
      rankings = null;
      rankError = null;
      rankLoading = false;
      return;
    }
    const catalog = templates;
    const backend = settings.paste_backend;
    rankTimer = setTimeout(async () => {
      rankLoading = true;
      rankError = null;
      try {
        const result = await rankTemplates(q, catalog, backend);
        if (searchQuery === q) rankings = result;
      } catch (e) {
        if (searchQuery === q) {
          rankError = explainRankError(String(e));
          rankings = null;
        }
      } finally {
        if (searchQuery === q) rankLoading = false;
      }
    }, RANK_DEBOUNCE_MS);
  });

  async function retryRank(): Promise<void> {
    rankError = null;
    const q = searchQuery;
    if (q.trim().length < PASTE_THRESHOLD) return;
    rankLoading = true;
    try {
      const result = await rankTemplates(q, templates, settings.paste_backend);
      if (searchQuery === q) rankings = result;
    } catch (e) {
      if (searchQuery === q) rankError = explainRankError(String(e));
    } finally {
      if (searchQuery === q) rankLoading = false;
    }
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
  $effect(() => {
    if (!loaded) return;
    const sources = settings.context_sources;
    const backend = settings.paste_backend;
    const sourcesJson = JSON.stringify(sources);
    if (sourcesJson === lastForwardedSourcesJson && backend === lastForwardedBackend) return;
    const skip =
      lastForwardedSourcesJson === "" && lastForwardedBackend === null && sources.length === 0;
    lastForwardedSourcesJson = sourcesJson;
    lastForwardedBackend = backend;
    if (skip) return;
    void setContextSources(sources, backend).catch(() => {
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
      void setContextSources(settings.context_sources, settings.paste_backend).catch(() => {});
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
  />
  {#if !agentStore.baseMode && !editing}
    <div class="search-row">
      <div class="search-wrap">
        <input
          bind:this={searchInput}
          class="search"
          type="text"
          placeholder="Search or paste a message to find matching templates…"
          value={searchQuery}
          oninput={(e) => handleSearchChange(e.currentTarget.value)}
        />
        {#if searchQuery.length > 0}
          <button
            class="clear-btn"
            title="Clear (Ctrl+L)"
            aria-label="Clear search"
            onclick={clearSearch}
          >×</button>
        {/if}
      </div>
    </div>
  {/if}
  <div class="shell">
    {#if !loaded}
      <div class="loading">Loading…</div>
    {:else if agentStore.baseMode}
      <AgentSidebar
        kind={agentStore.baseKind}
        messages={agentStore.agentMessages}
        busy={agentStore.agentBusy}
        error={agentStore.agentError}
        progress={agentStore.agentProgress}
        sourceName={agentStore.baseSourceName}
        width={agentSidebarWidth}
        onSubmit={(p) => agentStore.handleAgentPrompt(p)}
      />
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="col-resize"
        title="Drag to resize"
        onpointerdown={startResize("agent")}
      ></div>
      {#if agentStore.saveDraft !== null}
        <MainPanel
          template={null}
          creatingDraft={agentStore.saveDraft}
          {includeOpening}
          {includeSignature}
          editing={false}
          globalSignature={settings.global_signature}
          snippets={settings.snippets}
          canEdit={isEditorMode}
          {availableTags}
          {availableFolders}
          {copyTrigger}
          savedPlaceholderValues={settings.placeholder_values}
          inboundText={null}
          adaptBusy={agentStore.adaptBusy}
          adaptError={agentStore.adaptError}
          onClearAdaptError={() => (agentStore.adaptError = null)}
          onToggleOpening={(v) => (includeOpening = v)}
          onToggleSignature={(v) => (includeSignature = v)}
          onEnterEdit={() => {}}
          onCancelEdit={() => agentStore.closeSaveAs()}
          onSave={() => {}}
          onCreate={(d) => void agentStore.commitNewTemplate(d)}
          onDuplicate={() => {}}
          onDelete={() => {}}
          onBaseOnTemplate={() => {}}
          onAdaptToInbound={() => {}}
          onCopySuccess={(id) => void templatesStore.recordCopy(id)}
          onPlaceholderValuesChange={(id, vals) => void templatesStore.recordPlaceholderValues(id, vals)}
          onRevertHistory={(id, idx) => void templatesStore.revertHistory(id, idx)}
          aiBodyUpdate={null}
          onDraftChange={ignoreDraftChange}
        />
      {:else}
        <EditorPane
          kind={agentStore.baseKind}
          opening={agentStore.baseDraft.opening}
          body={agentStore.baseDraft.body}
          globalSignature={settings.global_signature}
          signatureOverride={agentStore.baseSignatureOverride}
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
      <MainPanel
        template={selectedTemplate}
        {includeOpening}
        {includeSignature}
        editing={true}
        globalSignature={settings.global_signature}
        snippets={settings.snippets}
        canEdit={isEditorMode}
        {availableTags}
        {availableFolders}
        {copyTrigger}
        savedPlaceholderValues={settings.placeholder_values}
        inboundText={null}
        adaptBusy={agentStore.adaptBusy}
        adaptError={agentStore.adaptError}
        onClearAdaptError={() => (agentStore.adaptError = null)}
        onToggleOpening={(v) => (includeOpening = v)}
        onToggleSignature={(v) => (includeSignature = v)}
        onEnterEdit={() => {}}
        onCancelEdit={cancelEditMode}
        onSave={handleSave}
        onDuplicate={() => void duplicateSelectedTemplate()}
        onDelete={() => void deleteSelectedTemplate()}
        onBaseOnTemplate={() => agentStore.enterBaseMode(selectedTemplate)}
        onAdaptToInbound={() => void agentStore.adaptToInbound(selectedTemplate, searchQuery, PASTE_THRESHOLD)}
        onCopySuccess={(id) => void templatesStore.recordCopy(id)}
        onPlaceholderValuesChange={(id, vals) => void templatesStore.recordPlaceholderValues(id, vals)}
        onRevertHistory={(id, idx) => void templatesStore.revertHistory(id, idx)}
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
        {searchQuery}
        {rankings}
        {rankLoading}
        {rankError}
        pasteThreshold={PASTE_THRESHOLD}
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
      />
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="col-resize"
        title="Drag to resize"
        onpointerdown={startResize("templates")}
      ></div>
      <MainPanel
        template={selectedTemplate}
        {includeOpening}
        {includeSignature}
        {editing}
        globalSignature={settings.global_signature}
        snippets={settings.snippets}
        canEdit={isEditorMode}
        {availableTags}
        {availableFolders}
        {copyTrigger}
        savedPlaceholderValues={settings.placeholder_values}
        inboundText={inPasteMode ? searchQuery : null}
        adaptBusy={agentStore.adaptBusy}
        adaptError={agentStore.adaptError}
        onClearAdaptError={() => (agentStore.adaptError = null)}
        onToggleOpening={(v) => (includeOpening = v)}
        onToggleSignature={(v) => (includeSignature = v)}
        onEnterEdit={enterEditMode}
        onCancelEdit={cancelEditMode}
        onSave={handleSave}
        onDuplicate={() => void duplicateSelectedTemplate()}
        onDelete={() => void deleteSelectedTemplate()}
        onBaseOnTemplate={() => agentStore.enterBaseMode(selectedTemplate)}
        onAdaptToInbound={() => void agentStore.adaptToInbound(selectedTemplate, searchQuery, PASTE_THRESHOLD)}
        onCopySuccess={(id) => void templatesStore.recordCopy(id)}
        onPlaceholderValuesChange={(id, vals) => void templatesStore.recordPlaceholderValues(id, vals)}
        onRevertHistory={(id, idx) => void templatesStore.revertHistory(id, idx)}
        aiBodyUpdate={null}
        onDraftChange={ignoreDraftChange}
      />
    {/if}
    {#if contextOpen && loaded}
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
    onClose={() => (cheatSheetOpen = false)}
  />
{/if}

{#if captureOpen && loaded}
  <MemoryCapturePopover
    sources={settings.context_sources}
    backend={settings.paste_backend}
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
  <div
    class="confirm-backdrop"
    role="dialog"
    aria-modal="true"
    aria-label="Confirm bulk delete"
    tabindex="-1"
    onclick={(e) => e.target === e.currentTarget && (bulkDeleteConfirmOpen = false)}
    onkeydown={(e) => {
      if (e.key === "Escape") bulkDeleteConfirmOpen = false;
      else if (e.key === "Enter") void confirmBulkDelete();
    }}
  >
    <div class="confirm-modal">
      <h3>Delete {selectionStore.bulkSelectedIds.size} templates?</h3>
      <p class="confirm-warn">Ctrl+Z will restore them.</p>
      <div class="confirm-actions">
        <button class="confirm-btn" onclick={() => (bulkDeleteConfirmOpen = false)}>Cancel</button>
        <!-- svelte-ignore a11y_autofocus -->
        <button class="confirm-btn danger" onclick={() => void confirmBulkDelete()} autofocus>
          Delete {selectionStore.bulkSelectedIds.size}
        </button>
      </div>
    </div>
  </div>
{/if}

{#if bulkTagPromptOpen}
  <div
    class="confirm-backdrop"
    role="dialog"
    aria-modal="true"
    aria-label="Bulk add tag"
    tabindex="-1"
    onclick={(e) =>
      e.target === e.currentTarget && (bulkTagPromptOpen = false)}
    onkeydown={(e) => {
      if (e.key === "Escape") {
        bulkTagPromptOpen = false;
        bulkTagDraft = "";
      } else if (e.key === "Enter") {
        void confirmBulkTag();
      }
    }}
  >
    <div class="confirm-modal">
      <h3>Add tag to {selectionStore.bulkSelectedIds.size} templates</h3>
      <!-- svelte-ignore a11y_autofocus -->
      <input
        class="bulk-tag-input"
        type="text"
        placeholder="tag name"
        bind:value={bulkTagDraft}
        autofocus
      />
      <div class="confirm-actions">
        <button
          class="confirm-btn"
          onclick={() => {
            bulkTagPromptOpen = false;
            bulkTagDraft = "";
          }}>Cancel</button
        >
        <button
          class="confirm-btn"
          disabled={bulkTagDraft.trim().length === 0}
          onclick={() => void confirmBulkTag()}
        >Add</button>
      </div>
    </div>
  </div>
{/if}

{#if bulkRemoveTagPromptOpen}
  <div
    class="confirm-backdrop"
    role="dialog"
    aria-modal="true"
    aria-label="Bulk remove tag"
    tabindex="-1"
    onclick={(e) =>
      e.target === e.currentTarget && (bulkRemoveTagPromptOpen = false)}
    onkeydown={(e) => {
      if (e.key === "Escape") {
        bulkRemoveTagPromptOpen = false;
        bulkTagDraft = "";
      } else if (e.key === "Enter") {
        void confirmBulkRemoveTag();
      }
    }}
  >
    <div class="confirm-modal">
      <h3>Remove tag from {selectionStore.bulkSelectedIds.size} templates</h3>
      <!-- svelte-ignore a11y_autofocus -->
      <input
        class="bulk-tag-input"
        type="text"
        placeholder="tag name"
        bind:value={bulkTagDraft}
        autofocus
      />
      <div class="confirm-actions">
        <button
          class="confirm-btn"
          onclick={() => {
            bulkRemoveTagPromptOpen = false;
            bulkTagDraft = "";
          }}>Cancel</button
        >
        <button
          class="confirm-btn danger"
          disabled={bulkTagDraft.trim().length === 0}
          onclick={() => void confirmBulkRemoveTag()}
        >Remove</button>
      </div>
    </div>
  </div>
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
  <div
    class="confirm-backdrop"
    role="dialog"
    aria-modal="true"
    aria-labelledby="ctx-confirm-title"
    tabindex="-1"
    onclick={(e) => e.target === e.currentTarget && cancelContextDelete()}
    onkeydown={() => {}}
  >
    <div class="confirm-modal">
      <h3 id="ctx-confirm-title">Delete template?</h3>
      <p class="confirm-name">"{contextDeleteTarget.name}"</p>
      <p class="confirm-warn">Ctrl+Z will restore it.</p>
      <div class="confirm-actions">
        <button class="confirm-btn" onclick={cancelContextDelete}>Cancel</button>
        <!-- svelte-ignore a11y_autofocus -->
        <button class="confirm-btn danger" onclick={confirmContextDelete} autofocus>Delete</button>
      </div>
    </div>
  </div>
{/if}

<style>
  :global(:root) {
    --bg-base: #1a1a1a;
    --bg-elevated: #161616;
    --bg-titlebar: #131313;
    --bg-input: #0f0f0f;
    --bg-hover: #222222;
    --bg-active: #2a2a2a;
    --border: #2a2a2a;
    --border-strong: #3a3a3a;
    --border-focus: #4a4a4a;
    --text: #e6e6e6;
    --text-strong: #f0f0f0;
    --text-muted: #888888;
    --text-subtle: #666666;
    --text-deemphasis: #777777;
    --text-placeholder: #555555;
    --shadow: rgba(0, 0, 0, 0.6);
    --backdrop: rgba(0, 0, 0, 0.5);
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
    --bg-base: #fafafa;
    --bg-elevated: #f0f0f0;
    --bg-titlebar: #e8e8e8;
    --bg-input: #ffffff;
    --bg-hover: #e0e0e0;
    --bg-active: #d6d6d6;
    --border: #d8d8d8;
    --border-strong: #c0c0c0;
    --border-focus: #888888;
    --text: #1a1a1a;
    --text-strong: #000000;
    --text-muted: #555555;
    --text-subtle: #888888;
    --text-deemphasis: #666666;
    --text-placeholder: #aaaaaa;
    --shadow: rgba(0, 0, 0, 0.15);
    --backdrop: rgba(0, 0, 0, 0.3);
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

  .search-row {
    padding: 10px 12px;
    background: var(--bg-titlebar);
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }

  .search-wrap {
    position: relative;
  }

  .search {
    width: 100%;
    box-sizing: border-box;
    background: var(--bg-input);
    border: 1px solid var(--border);
    color: var(--text);
    padding: 7px 34px 7px 12px;
    border-radius: 6px;
    font: inherit;
    font-size: 0.85rem;
  }

  .clear-btn {
    position: absolute;
    right: 4px;
    top: 50%;
    transform: translateY(-50%);
    background: transparent;
    border: none;
    color: var(--text-muted);
    cursor: pointer;
    width: 22px;
    height: 22px;
    border-radius: 4px;
    font-size: 1.05rem;
    line-height: 1;
    padding: 0;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .clear-btn:hover {
    background: var(--bg-hover);
    color: var(--text);
  }

  .search:focus {
    outline: none;
    border-color: var(--border-focus);
  }

  .search::placeholder {
    color: var(--text-placeholder);
  }

  .loading {
    margin: auto;
    color: var(--text-subtle);
    font-size: 0.9rem;
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

  .confirm-backdrop {
    position: fixed;
    inset: 0;
    background: var(--backdrop);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 260;
  }

  .confirm-modal {
    background: var(--bg-base);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 20px 22px;
    width: 360px;
    max-width: calc(100vw - 48px);
    color: var(--text);
    box-shadow: 0 8px 32px var(--shadow);
  }

  .confirm-modal h3 {
    margin: 0 0 8px;
    font-size: 0.95rem;
    font-weight: 600;
  }

  .confirm-name {
    margin: 0 0 4px;
    font-size: 0.85rem;
    color: var(--text);
    font-family: ui-monospace, "Cascadia Code", Consolas, monospace;
    word-break: break-word;
  }

  .confirm-warn {
    margin: 0 0 18px;
    font-size: 0.78rem;
    color: var(--text-muted);
  }

  .confirm-actions {
    display: flex;
    gap: 8px;
    justify-content: flex-end;
  }

  .confirm-btn {
    background: transparent;
    color: var(--text);
    border: 1px solid var(--border);
    padding: 6px 16px;
    border-radius: 4px;
    cursor: pointer;
    font: inherit;
    font-size: 0.85rem;
  }

  .confirm-btn:hover {
    background: var(--bg-hover);
    border-color: var(--border-strong);
  }

  .confirm-btn.danger {
    background: var(--accent-danger-bg);
    border-color: var(--accent-danger-border);
    color: var(--accent-danger-text);
  }

  .confirm-btn.danger:hover {
    background: var(--accent-danger-border);
  }

  .bulk-tag-input {
    width: 100%;
    box-sizing: border-box;
    background: var(--bg-input);
    border: 1px solid var(--border);
    color: var(--text);
    padding: 6px 10px;
    border-radius: 4px;
    font: inherit;
    font-size: 0.9rem;
    margin: 0 0 18px;
  }

  .bulk-tag-input:focus {
    outline: none;
    border-color: var(--border-focus);
  }
</style>
