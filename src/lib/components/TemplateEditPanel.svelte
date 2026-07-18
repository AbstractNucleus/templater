<script lang="ts">
  import type { Template, TemplateDraft } from "$lib/types";
  import TemplateForm from "./TemplateForm.svelte";
  import { templatesStore } from "$lib/stores/templatesStore.svelte";

  const EMPTY_DRAFT: TemplateDraft = {
    name: "",
    tags: [],
    opening: "",
    body: "",
    folder: null,
  };

  type EditMode =
    | {
        kind: "create";
        draft: TemplateDraft;
        onCancel: () => void;
        onCreate: (draft: TemplateDraft) => void;
      }
    | {
        kind: "edit";
        template: Template;
        onCancel: () => void;
        onSave: (t: Template) => void;
      };

  let { mode }: { mode: EditMode } = $props();

  const canEdit = $derived(templatesStore.isEditorMode);
  const availableTags = $derived.by(() => {
    const set = new Set<string>();
    for (const t of templatesStore.templates) for (const tag of t.tags) set.add(tag);
    return [...set].sort();
  });
  const availableFolders = $derived.by(() => {
    const set = new Set<string>();
    for (const t of templatesStore.templates) if (t.folder !== null) set.add(t.folder);
    return [...set].sort();
  });

  // Draft state — used by both edit and create flows.
  let draft = $state<TemplateDraft>({ ...EMPTY_DRAFT });

  // Seed draft whenever we enter edit/create mode or switch templates.
  // Reference identity on `mode.draft` / `mode.template` keeps this stable
  // during ongoing edits — the effect only refires when the parent swaps
  // the source.
  $effect(() => {
    if (mode.kind === "create") {
      draft = { ...mode.draft };
      return;
    }
    draft = {
      name: mode.template.name,
      tags: [...mode.template.tags],
      opening: mode.template.opening,
      body: mode.template.body,
      folder: mode.template.folder,
    };
  });

  function handleSave(): void {
    if (mode.kind !== "edit") return;
    const folder = draft.folder !== null && draft.folder.trim().length > 0 ? draft.folder.trim() : null;
    mode.onSave({
      ...mode.template,
      name: draft.name.trim() || "Untitled",
      tags: draft.tags,
      opening: draft.opening,
      body: draft.body,
      folder,
      updated_at: new Date().toISOString(),
    });
  }

  function handleCreate(): void {
    if (mode.kind !== "create") return;
    mode.onCreate(draft);
  }

  function handleFormSubmit(): void {
    if (mode.kind === "create") handleCreate();
    else handleSave();
  }

  function handleFormKey(e: KeyboardEvent): void {
    if (!canEdit) return;
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      handleFormSubmit();
    } else if (e.key === "Escape" && mode.kind === "create") {
      // Mirrors the old SaveAsModal cancel-on-Escape. Pickers stopPropagation
      // when their dropdown is open, so this only fires from "outside" focus.
      e.preventDefault();
      mode.onCancel();
    }
  }
</script>

<svelte:window onkeydown={handleFormKey} />

<div class="header-row">
  <div class="breadcrumb">{mode.kind === "create" ? "new template" : "editing"}</div>
  <div class="actions">
    <button class="icon-btn" onclick={mode.onCancel}>Cancel</button>
    <button class="icon-btn primary" onclick={handleFormSubmit}>Save</button>
  </div>
</div>

<TemplateForm
  value={draft}
  {availableTags}
  {availableFolders}
  bodyGrow
  autofocusName={mode.kind === "create"}
  onChange={(next) => (draft = next)}
/>

<style>
  .header-row {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 16px;
    margin-bottom: 16px;
  }

  .breadcrumb {
    color: var(--text-deemphasis);
    font-size: 0.78rem;
    margin-bottom: 4px;
  }

  .actions {
    display: flex;
    gap: 6px;
    flex-shrink: 0;
  }

  .icon-btn {
    background: transparent;
    color: var(--text);
    border: 1px solid var(--border);
    padding: 4px 10px;
    border-radius: 4px;
    cursor: pointer;
    font: inherit;
    font-size: 0.8rem;
  }

  .icon-btn:hover {
    background: var(--bg-hover);
    border-color: var(--border-strong);
  }

  .icon-btn.primary {
    background: var(--accent-brand);
    border-color: var(--accent-brand);
    color: #fff;
    font-weight: 600;
  }

  .icon-btn.primary:hover {
    background: var(--accent-brand-hover);
    border-color: var(--accent-brand-hover);
  }
</style>
