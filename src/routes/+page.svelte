<script lang="ts">
  import TagsSidebar from "$lib/components/TagsSidebar.svelte";
  import TemplatesSidebar from "$lib/components/TemplatesSidebar.svelte";
  import MainPanel from "$lib/components/MainPanel.svelte";
  import TitleBar from "$lib/components/TitleBar.svelte";
  import SettingsModal from "$lib/components/SettingsModal.svelte";
  import ResizeHandles from "$lib/components/ResizeHandles.svelte";
  import AgentSidebar from "$lib/components/AgentSidebar.svelte";
  import EditorPane from "$lib/components/EditorPane.svelte";
  import SaveAsModal from "$lib/components/SaveAsModal.svelte";
  import ContextMenu, { type ContextMenuItem } from "$lib/components/ContextMenu.svelte";
  import { writeText, readText } from "@tauri-apps/plugin-clipboard-manager";
  import { getCurrentWebview } from "@tauri-apps/api/webview";
  import { starterTemplates } from "$lib/starterTemplates";
  import { searchTemplates } from "$lib/search";
  import {
    loadAppData,
    saveAppData,
    rankTemplates,
    getEnvWarnings,
    explainRankError,
    editTemplate,
    openDataDir,
    exportTemplates,
    exportTemplate,
    importTemplates,
    checkForUpdate,
    getAppVersion,
    onSidecarProgress,
    listTemplateBackups,
    restoreTemplateBackup,
    type Ranking,
    type ChatTurn,
  } from "$lib/api";
  import { save as saveDialog, open as openDialog } from "@tauri-apps/plugin-dialog";
  import {
    DEFAULT_COLUMN_WIDTHS,
    DEFAULT_SETTINGS,
    type AppData,
    type Settings,
    type Template,
  } from "$lib/types";

  const PASTE_THRESHOLD = 30;
  const RANK_DEBOUNCE_MS = 600;
  const DATA_VERSION = 1;

  const ZOOM_MIN = 0.5;
  const ZOOM_MAX = 2.0;
  const ZOOM_STEP = 0.1;

  const TAGS_MIN = 100;
  const TAGS_MAX = 400;
  const TEMPLATES_MIN = 160;
  const TEMPLATES_MAX = 500;

  let tagsWidth = $state(DEFAULT_COLUMN_WIDTHS.tags);
  let templatesWidth = $state(DEFAULT_COLUMN_WIDTHS.templates);
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
    if (clamped === settings.zoom) return;
    void persist(templates, { ...settings, zoom: clamped });
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
    const ids = visibleTemplateIds;
    if (ids.length === 0) return;
    const idx = selectedTemplateId === null ? -1 : ids.indexOf(selectedTemplateId);
    let next: number;
    if (idx < 0) {
      next = delta > 0 ? 0 : ids.length - 1;
    } else {
      next = Math.max(0, Math.min(ids.length - 1, idx + delta));
    }
    selectedTemplateId = ids[next];
  }

  function copySelected(): void {
    if (selectedTemplateId === null) return;
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
    const ctrlOnly = (e.ctrlKey || e.metaKey) && !e.altKey;
    if (ctrlOnly && (e.key === "+" || e.key === "=")) {
      e.preventDefault();
      setZoom((settings.zoom ?? 1) + ZOOM_STEP);
      return;
    }
    if (ctrlOnly && (e.key === "-" || e.key === "_")) {
      e.preventDefault();
      setZoom((settings.zoom ?? 1) - ZOOM_STEP);
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

    if (baseMode || editing) return;
    const inSearch = document.activeElement === searchInput;
    if (!inSearch && isInputFocused()) return;

    // Ctrl/Cmd+Z: undo the last template-list mutation. Native text undo wins
    // inside inputs (we returned above) so this only fires from the body /
    // search field. Disabled in User mode where mutations can't happen anyway.
    if (ctrlOnly && !e.shiftKey && e.key.toLowerCase() === "z" && isEditorMode) {
      e.preventDefault();
      void performUndo();
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

  function startResize(target: "tags" | "templates" | "agent"): (e: PointerEvent) => void {
    return (e) => {
      e.preventDefault();
      const handle = e.currentTarget as HTMLElement;
      const startX = e.clientX;
      const startWidth =
        target === "tags" ? tagsWidth : target === "templates" ? templatesWidth : agentSidebarWidth;
      const min =
        target === "tags" ? TAGS_MIN : target === "templates" ? TEMPLATES_MIN : AGENT_MIN;
      const max =
        target === "tags" ? TAGS_MAX : target === "templates" ? TEMPLATES_MAX : AGENT_MAX;
      handle.setPointerCapture(e.pointerId);
      handle.classList.add("dragging");

      function onMove(ev: PointerEvent): void {
        const next = Math.max(min, Math.min(max, startWidth + ev.clientX - startX));
        if (target === "tags") tagsWidth = next;
        else if (target === "templates") templatesWidth = next;
        else agentSidebarWidth = next;
      }

      function onUp(): void {
        handle.removeEventListener("pointermove", onMove);
        handle.removeEventListener("pointerup", onUp);
        handle.removeEventListener("pointercancel", onUp);
        handle.releasePointerCapture(e.pointerId);
        handle.classList.remove("dragging");
        const final = target === "tags"
          ? tagsWidth
          : target === "templates"
            ? templatesWidth
            : agentSidebarWidth;
        if (final !== settings.column_widths[target]) {
          void persist(templates, {
            ...settings,
            column_widths: { ...settings.column_widths, [target]: final },
          });
        }
      }

      handle.addEventListener("pointermove", onMove);
      handle.addEventListener("pointerup", onUp);
      handle.addEventListener("pointercancel", onUp);
    };
  }

  let templates = $state<Template[]>([]);
  let settings = $state<Settings>({ ...DEFAULT_SETTINGS });
  let envApiKeyOverride = $state(false);
  let loaded = $state(false);
  let loadError = $state<string | null>(null);
  let appVersion = $state("0.0.0");

  let searchQuery = $state("");
  let selectedTagIds = $state<Set<string>>(new Set());
  let excludedTagIds = $state<Set<string>>(new Set());
  let tagCombinator = $state<"and" | "or">("and");
  let selectedTemplateId = $state<string | null>(null);
  let includeOpening = $state(true);
  let includeSignature = $state(true);
  let editing = $state(false);
  let settingsOpen = $state(false);

  let rankings = $state<Ranking[] | null>(null);
  let rankLoading = $state(false);
  let rankError = $state<string | null>(null);
  let rankTimer: ReturnType<typeof setTimeout> | null = null;

  let copyTrigger = $state(0);

  // Undo: a bounded snapshot stack pushed BEFORE every template-list
  // mutation (save, delete, duplicate, agent save, import, restore, pin).
  // Ctrl+Z pops one entry and re-persists; settings (theme, zoom, columns)
  // are NOT pushed so an undo doesn't surprise the user by reverting them.
  type UndoSnapshot = {
    templates: Template[];
    placeholderValues: Record<string, Record<string, string>>;
    label: string;
  };
  const MAX_UNDO = 20;
  let undoStack = $state<UndoSnapshot[]>([]);
  let undoToast = $state<string | null>(null);
  let undoToastTimer: ReturnType<typeof setTimeout> | null = null;

  function pushUndo(label: string): void {
    const snapshot: UndoSnapshot = {
      templates: [...templates],
      placeholderValues: { ...settings.placeholder_values },
      label,
    };
    undoStack = [...undoStack.slice(-(MAX_UNDO - 1)), snapshot];
  }

  async function performUndo(): Promise<void> {
    if (undoStack.length === 0) return;
    const snap = undoStack[undoStack.length - 1];
    undoStack = undoStack.slice(0, -1);
    await persist(snap.templates, { ...settings, placeholder_values: snap.placeholderValues });
    if (
      selectedTemplateId === null ||
      !snap.templates.some((t) => t.id === selectedTemplateId)
    ) {
      selectedTemplateId = snap.templates[0]?.id ?? null;
    }
    showUndoToast(`Undid ${snap.label}`);
  }

  function showUndoToast(msg: string): void {
    undoToast = msg;
    if (undoToastTimer) clearTimeout(undoToastTimer);
    undoToastTimer = setTimeout(() => (undoToast = null), 2000);
  }

  let baseMode = $state(false);
  let baseKind = $state<"new" | "base">("base");
  let baseSourceName = $state("");
  let baseDraft = $state<{ opening: string; body: string }>({ opening: "", body: "" });
  let agentMessages = $state<ChatTurn[]>([]);
  let agentBusy = $state(false);
  let agentError = $state<string | null>(null);
  let agentProgress = $state<string>("");
  let saveAsOpen = $state(false);
  let agentSidebarWidth = $state(DEFAULT_COLUMN_WIDTHS.agent);
  let contextMenu = $state<{ x: number; y: number; items: ContextMenuItem[] } | null>(null);
  let contextDeleteTarget = $state<Template | null>(null);
  const AGENT_MIN = 240;
  const AGENT_MAX = 600;

  const selectedTemplate = $derived(
    templates.find((t) => t.id === selectedTemplateId) ?? null,
  );

  const isEditorMode = $derived(settings.mode === "editor");

  const availableTags = $derived.by(() => {
    const set = new Set<string>();
    for (const t of templates) for (const tag of t.tags) set.add(tag);
    return [...set].sort();
  });

  // Browse order: pinned first, then by most-recently-copied, then the
  // template's own insertion order (stable sort). Applied before tag/search
  // so the empty-query view reflects user priority.
  const browseOrdered = $derived.by(() => {
    return [...templates].sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      const aT = a.last_used_at ?? "";
      const bT = b.last_used_at ?? "";
      if (aT !== bT) return aT > bT ? -1 : 1;
      return 0;
    });
  });

  const tagFiltered = $derived.by(() => {
    if (selectedTagIds.size === 0 && excludedTagIds.size === 0) return browseOrdered;
    return browseOrdered.filter((t) => {
      for (const tag of excludedTagIds) {
        if (t.tags.includes(tag)) return false;
      }
      if (selectedTagIds.size === 0) return true;
      if (tagCombinator === "or") {
        for (const tag of selectedTagIds) {
          if (t.tags.includes(tag)) return true;
        }
        return false;
      }
      for (const tag of selectedTagIds) {
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
    if (baseMode || editing) return;
    const ids = visibleTemplateIds;
    if (ids.length === 0) return;
    if (selectedTemplateId === null || !ids.includes(selectedTemplateId)) {
      selectedTemplateId = ids[0];
    }
  });

  $effect(() => {
    void (async () => {
      try {
        const [data, env, version] = await Promise.all([
          loadAppData(),
          getEnvWarnings(),
          getAppVersion().catch(() => "0.0.0"),
        ]);
        envApiKeyOverride = env.api_key_override;
        appVersion = version;
        if (data === null) {
          templates = starterTemplates;
          settings = { ...DEFAULT_SETTINGS };
          await saveAppData({
            version: DATA_VERSION,
            templates: starterTemplates,
            settings,
          });
        } else {
          templates = data.templates;
          settings = data.settings;
        }
        tagsWidth = settings.column_widths.tags;
        templatesWidth = settings.column_widths.templates;
        agentSidebarWidth = settings.column_widths.agent;
        selectedTemplateId = templates[0]?.id ?? null;
      } catch (e) {
        loadError = String(e);
        templates = starterTemplates;
        selectedTemplateId = templates[0]?.id ?? null;
      } finally {
        loaded = true;
      }
    })();
  });

  async function persist(
    nextTemplates: Template[],
    nextSettings: Settings = settings,
  ): Promise<void> {
    templates = nextTemplates;
    settings = nextSettings;
    try {
      await saveAppData({
        version: DATA_VERSION,
        templates: nextTemplates,
        settings: nextSettings,
      });
    } catch (e) {
      loadError = `save failed: ${e}`;
    }
  }

  function handleTagToggle(tag: string): void {
    const next = new Set(selectedTagIds);
    if (excludedTagIds.has(tag)) {
      const ex = new Set(excludedTagIds);
      ex.delete(tag);
      excludedTagIds = ex;
      next.add(tag);
    } else if (next.has(tag)) {
      next.delete(tag);
    } else {
      next.add(tag);
    }
    selectedTagIds = next;
  }

  function handleTagExclude(tag: string): void {
    const next = new Set(excludedTagIds);
    if (selectedTagIds.has(tag)) {
      const sel = new Set(selectedTagIds);
      sel.delete(tag);
      selectedTagIds = sel;
      next.add(tag);
    } else if (next.has(tag)) {
      next.delete(tag);
    } else {
      next.add(tag);
    }
    excludedTagIds = next;
  }

  function handleTagsClear(): void {
    selectedTagIds = new Set();
    excludedTagIds = new Set();
  }

  function handleCombinatorToggle(): void {
    tagCombinator = tagCombinator === "and" ? "or" : "and";
  }

  function handleTemplateSelect(id: string): void {
    if (editing) editing = false;
    selectedTemplateId = selectedTemplateId === id ? null : id;
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

  function handleNew(): void {
    if (!isEditorMode) return;
    baseKind = "new";
    baseSourceName = "";
    baseDraft = { opening: "", body: "" };
    agentMessages = [];
    agentBusy = false;
    agentError = null;
    baseMode = true;
  }

  async function handleSave(updated: Template): Promise<void> {
    if (!isEditorMode) return;
    pushUndo("edit");
    const next = templates.map((t) => (t.id === updated.id ? updated : t));
    await persist(next);
    editing = false;
  }

  async function handleDuplicate(): Promise<void> {
    if (!isEditorMode) return;
    if (!selectedTemplate) return;
    pushUndo("duplicate");
    const now = new Date().toISOString();
    const copy: Template = {
      ...selectedTemplate,
      id: crypto.randomUUID(),
      name: `${selectedTemplate.name} (copy)`,
      created_at: now,
      updated_at: now,
    };
    const idx = templates.findIndex((t) => t.id === selectedTemplate.id);
    const next = [...templates];
    next.splice(idx + 1, 0, copy);
    await persist(next);
    selectedTemplateId = copy.id;
  }

  async function handleDelete(): Promise<void> {
    if (!isEditorMode) return;
    if (!selectedTemplate) return;
    pushUndo("delete");
    const id = selectedTemplate.id;
    const idx = templates.findIndex((t) => t.id === id);
    const next = templates.filter((t) => t.id !== id);
    const nextSettings = settings.placeholder_values[id] !== undefined
      ? { ...settings, placeholder_values: omitKey(settings.placeholder_values, id) }
      : settings;
    await persist(next, nextSettings);
    selectedTemplateId = next[Math.min(idx, next.length - 1)]?.id ?? null;
  }

  function omitKey<T extends object>(obj: T, key: string): T {
    const copy = { ...obj } as Record<string, unknown>;
    delete copy[key];
    return copy as T;
  }

  async function handleSettingsUpdate(next: Settings): Promise<void> {
    await persist(templates, next);
  }

  async function handleRestoreBackup(name: string): Promise<void> {
    pushUndo("restore");
    const data = await restoreTemplateBackup(name);
    // Rust already wrote the restored data to disk; sync local state.
    templates = data.templates;
    settings = data.settings;
    selectedTemplateId = templates[0]?.id ?? null;
  }

  type PortResult =
    | { kind: "ok"; message: string }
    | { kind: "cancelled" }
    | { kind: "err"; error: string };

  function pluralise(n: number, word: string): string {
    return `${n} ${word}${n === 1 ? "" : "s"}`;
  }

  async function handleExportTemplates(): Promise<PortResult> {
    try {
      const today = new Date().toISOString().slice(0, 10);
      const path = await saveDialog({
        defaultPath: `templates-export-${today}.json`,
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      if (!path) return { kind: "cancelled" };
      const count = await exportTemplates(path);
      return { kind: "ok", message: `Exported ${pluralise(count, "template")}.` };
    } catch (e) {
      return { kind: "err", error: String(e) };
    }
  }

  async function handleImportTemplates(): Promise<PortResult> {
    if (!isEditorMode) return { kind: "err", error: "import disabled in User mode" };
    try {
      const path = await openDialog({
        multiple: false,
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      if (path === null || Array.isArray(path)) return { kind: "cancelled" };
      pushUndo("import");
      const result = await importTemplates(path);
      // Rust has already persisted the merged list; just sync local state.
      templates = result.templates;
      const dupNote =
        result.skipped > 0 ? ` (${pluralise(result.skipped, "duplicate")} skipped)` : "";
      return {
        kind: "ok",
        message: `Imported ${pluralise(result.added, "template")}${dupNote}.`,
      };
    } catch (e) {
      return { kind: "err", error: String(e) };
    }
  }

  async function dismissCloseHint(): Promise<void> {
    await persist(templates, { ...settings, close_hint_shown: true });
  }

  async function duplicateTemplateById(id: string): Promise<void> {
    if (!isEditorMode) return;
    const src = templates.find((t) => t.id === id);
    if (!src) return;
    pushUndo("duplicate");
    const now = new Date().toISOString();
    const copy: Template = {
      ...src,
      id: crypto.randomUUID(),
      name: `${src.name} (copy)`,
      created_at: now,
      updated_at: now,
    };
    const idx = templates.findIndex((t) => t.id === id);
    const next = [...templates];
    next.splice(idx + 1, 0, copy);
    await persist(next);
    selectedTemplateId = copy.id;
  }

  async function deleteTemplateById(id: string): Promise<void> {
    if (!isEditorMode) return;
    const idx = templates.findIndex((t) => t.id === id);
    if (idx < 0) return;
    pushUndo("delete");
    const next = templates.filter((t) => t.id !== id);
    const nextSettings = settings.placeholder_values[id] !== undefined
      ? { ...settings, placeholder_values: omitKey(settings.placeholder_values, id) }
      : settings;
    await persist(next, nextSettings);
    if (selectedTemplateId === id) {
      selectedTemplateId = next[Math.min(idx, next.length - 1)]?.id ?? null;
    }
  }

  async function togglePin(id: string): Promise<void> {
    if (!isEditorMode) return;
    pushUndo("pin");
    const next = templates.map((t) => (t.id === id ? { ...t, pinned: !t.pinned } : t));
    await persist(next);
  }

  // Bumped from MainPanel after a successful copy. Updates last_used_at so
  // the browse-order sort surfaces recently-used templates near the top.
  async function recordCopy(id: string): Promise<void> {
    const now = new Date().toISOString();
    const next = templates.map((t) => (t.id === id ? { ...t, last_used_at: now } : t));
    await persist(next);
  }

  async function recordPlaceholderValues(
    templateId: string,
    values: Record<string, string>,
  ): Promise<void> {
    // Strip empty entries to keep the persisted map lean.
    const cleaned: Record<string, string> = {};
    for (const [k, v] of Object.entries(values)) {
      if (v.length > 0) cleaned[k] = v;
    }
    const nextMap = { ...settings.placeholder_values };
    if (Object.keys(cleaned).length === 0) {
      delete nextMap[templateId];
    } else {
      nextMap[templateId] = cleaned;
    }
    await persist(templates, { ...settings, placeholder_values: nextMap });
  }

  function slugify(s: string): string {
    const slug = s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 64);
    return slug.length > 0 ? slug : "template";
  }

  async function exportSingleTemplate(id: string): Promise<void> {
    const tpl = templates.find((t) => t.id === id);
    if (!tpl) return;
    try {
      const path = await saveDialog({
        defaultPath: `template-${slugify(tpl.name)}.json`,
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      if (!path) return;
      await exportTemplate(id, path);
    } catch (e) {
      loadError = `export failed: ${e}`;
    }
  }

  function openContextForTemplate(id: string, x: number, y: number): void {
    const tpl = templates.find((t) => t.id === id);
    if (!tpl) return;
    const items: ContextMenuItem[] = [];
    if (isEditorMode) {
      items.push({
        label: tpl.pinned ? "Unpin" : "Pin",
        onClick: () => void togglePin(id),
      });
      items.push({ label: "Duplicate", onClick: () => void duplicateTemplateById(id) });
    }
    items.push({ label: "Export…", onClick: () => void exportSingleTemplate(id) });
    if (isEditorMode) {
      items.push({
        label: "Delete",
        danger: true,
        onClick: () => (contextDeleteTarget = tpl),
      });
    }
    contextMenu = { x, y, items };
  }

  function openContextForEmpty(x: number, y: number): void {
    contextMenu = {
      x,
      y,
      items: [
        {
          label: "Open data folder",
          onClick: () => {
            openDataDir().catch((e) => (loadError = `open folder failed: ${e}`));
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
    await deleteTemplateById(id);
  }

  function cancelContextDelete(): void {
    contextDeleteTarget = null;
  }


  function enterBaseMode(): void {
    if (!selectedTemplate) return;
    baseKind = "base";
    baseSourceName = selectedTemplate.name;
    baseDraft = { opening: selectedTemplate.opening, body: selectedTemplate.body };
    agentMessages = [];
    agentBusy = false;
    agentError = null;
    baseMode = true;
  }

  function exitBaseMode(): void {
    baseMode = false;
    baseKind = "base";
    baseSourceName = "";
    baseDraft = { opening: "", body: "" };
    agentMessages = [];
    agentBusy = false;
    agentError = null;
    saveAsOpen = false;
  }

  async function handleAgentPrompt(prompt: string): Promise<void> {
    if (agentBusy) return;
    agentError = null;
    agentProgress = "";
    const history = [...agentMessages];
    agentMessages = [...history, { role: "user", content: prompt }];
    agentBusy = true;
    try {
      const { reasoning, updated } = await editTemplate(
        baseDraft,
        history,
        prompt,
        settings.paste_backend,
      );
      baseDraft = updated;
      agentMessages = [
        ...agentMessages,
        { role: "assistant", content: reasoning || "(no reasoning provided)" },
      ];
    } catch (e) {
      agentError = explainRankError(String(e));
    } finally {
      agentBusy = false;
      agentProgress = "";
    }
  }

  // Subscribe to streaming partials from the sidecar. The event fires for
  // any agent edit in flight; since the UI only allows one at a time
  // (agentBusy gate) we don't need to correlate by id.
  $effect(() => {
    const unlistenPromise = onSidecarProgress((text) => {
      if (agentBusy) agentProgress = text;
    });
    return () => {
      void unlistenPromise.then((u) => u());
    };
  });

  function openSaveAs(): void {
    saveAsOpen = true;
  }

  async function handleSaveAs(name: string, tags: string[]): Promise<void> {
    if (!isEditorMode) return;
    pushUndo("agent save");
    const now = new Date().toISOString();
    const newTemplate: Template = {
      id: crypto.randomUUID(),
      name,
      tags,
      opening: baseDraft.opening,
      body: baseDraft.body,
      created_at: now,
      updated_at: now,
      pinned: false,
      last_used_at: null,
    };
    const next = [newTemplate, ...templates];
    await persist(next);
    selectedTemplateId = newTemplate.id;
    saveAsOpen = false;
    exitBaseMode();
  }

  $effect(() => {
    if (typeof document !== "undefined") {
      document.documentElement.dataset.theme = settings.theme;
    }
  });

  $effect(() => {
    // Webview-level zoom (Ctrl+/− style) reflows scrollbars and hit-testing
    // correctly — CSS `zoom` clips fixed-height flex layouts.
    const z = settings.zoom ?? 1;
    void getCurrentWebview().setZoom(z).catch(() => {});
  });
</script>

<svelte:window onkeydown={handleGlobalKeydown} oncontextmenu={handleGlobalContextMenu} />

<div class="frame">
  <TitleBar onOpenSettings={() => (settingsOpen = true)} />
  {#if !baseMode}
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
    {:else if baseMode}
      <AgentSidebar
        kind={baseKind}
        messages={agentMessages}
        busy={agentBusy}
        error={agentError}
        progress={agentProgress}
        sourceName={baseSourceName}
        width={agentSidebarWidth}
        onSubmit={handleAgentPrompt}
      />
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="col-resize"
        title="Drag to resize"
        onpointerdown={startResize("agent")}
      ></div>
      <EditorPane
        kind={baseKind}
        opening={baseDraft.opening}
        body={baseDraft.body}
        globalSignature={settings.global_signature}
        {includeOpening}
        {includeSignature}
        canSave={isEditorMode}
        onUpdate={(next) => (baseDraft = next)}
        onToggleOpening={(v) => (includeOpening = v)}
        onToggleSignature={(v) => (includeSignature = v)}
        onSave={openSaveAs}
        onCancel={exitBaseMode}
      />
    {:else}
      <TagsSidebar
        {templates}
        {selectedTagIds}
        {excludedTagIds}
        {tagCombinator}
        width={tagsWidth}
        onTagToggle={handleTagToggle}
        onTagExclude={handleTagExclude}
        onTagsClear={handleTagsClear}
        onCombinatorToggle={handleCombinatorToggle}
        onContextEmpty={openContextForEmpty}
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
        {selectedTemplateId}
        {searchQuery}
        {rankings}
        {rankLoading}
        {rankError}
        pasteThreshold={PASTE_THRESHOLD}
        width={templatesWidth}
        canCreate={isEditorMode}
        onTemplateSelect={handleTemplateSelect}
        onNew={handleNew}
        onRetryRank={retryRank}
        onContextTemplate={openContextForTemplate}
        onContextEmpty={openContextForEmpty}
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
        canEdit={isEditorMode}
        {availableTags}
        {copyTrigger}
        savedPlaceholderValues={settings.placeholder_values}
        onToggleOpening={(v) => (includeOpening = v)}
        onToggleSignature={(v) => (includeSignature = v)}
        onEnterEdit={() => (editing = true)}
        onCancelEdit={() => (editing = false)}
        onSave={handleSave}
        onDuplicate={handleDuplicate}
        onDelete={handleDelete}
        onBaseOnTemplate={enterBaseMode}
        onCopySuccess={(id) => void recordCopy(id)}
        onPlaceholderValuesChange={(id, vals) => void recordPlaceholderValues(id, vals)}
      />
    {/if}
    {#if loadError}
      <div class="error-banner">{loadError}</div>
    {/if}
    {#if undoToast}
      <div class="undo-toast">{undoToast}</div>
    {/if}
    {#if loaded && !settings.close_hint_shown}
      <div class="hint-banner">
        <span>Tip: closing the window minimises to tray. Quit fully via the tray icon.</span>
        <button class="banner-action" onclick={dismissCloseHint}>Got it</button>
      </div>
    {/if}
  </div>
</div>

<ResizeHandles />

{#if settingsOpen}
  <SettingsModal
    {settings}
    {envApiKeyOverride}
    currentVersion={appVersion}
    onClose={() => (settingsOpen = false)}
    onUpdate={handleSettingsUpdate}
    onExportTemplates={handleExportTemplates}
    onImportTemplates={handleImportTemplates}
    onCheckUpdate={checkForUpdate}
    onListBackups={listTemplateBackups}
    onRestoreBackup={handleRestoreBackup}
  />
{/if}

{#if saveAsOpen}
  <SaveAsModal
    defaultName={baseKind === "new" ? "" : `${baseSourceName} (edited)`}
    {availableTags}
    onSave={handleSaveAs}
    onCancel={() => (saveAsOpen = false)}
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
      <p class="confirm-warn">This can't be undone.</p>
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

  .banner-action {
    background: transparent;
    border: 1px solid var(--accent-warning-border);
    color: var(--accent-warning-text);
    padding: 2px 10px;
    border-radius: 3px;
    cursor: pointer;
    font: inherit;
    font-size: 0.75rem;
  }

  .banner-action:hover {
    background: var(--bg-hover);
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
  }

  .hint-banner {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    background: var(--accent-info-bg);
    color: var(--accent-info-text);
    padding: 6px 12px;
    font-size: 0.8rem;
    border-top: 1px solid var(--accent-info-border);
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
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
</style>
