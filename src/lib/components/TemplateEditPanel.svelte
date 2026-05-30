<script lang="ts">
  import type { Template, TemplateDraft } from "$lib/types";
  import TemplateForm from "./TemplateForm.svelte";

  type DraftContent = { opening: string; body: string };
  /** `templateId` is null in the create-new-template flow (no template yet);
   *  in edit mode it's the edited template's id so a stale signal from a
   *  prior selection can be rejected. */
  type BodyUpdate = { templateId: string | null; body: string; seq: number };

  const EMPTY_DRAFT: TemplateDraft = {
    name: "",
    tags: [],
    opening: "",
    body: "",
    folder: null,
  };

  let {
    template,
    editing,
    canEdit,
    availableTags,
    availableFolders,
    creatingDraft = null,
    onCancelEdit,
    onSave,
    onCreate = () => {},
    aiBodyUpdate = null,
    onDraftChange = () => {},
  }: {
    template: Template | null;
    editing: boolean;
    canEdit: boolean;
    availableTags: string[];
    availableFolders: string[];
    /** When non-null, the panel renders the new-template form seeded from this
     *  draft (instead of an existing template). Parent must hold a stable
     *  reference for the form's lifetime. */
    creatingDraft?: TemplateDraft | null;
    onCancelEdit: () => void;
    onSave: (t: Template) => void;
    onCreate?: (draft: TemplateDraft) => void;
    aiBodyUpdate?: BodyUpdate | null;
    onDraftChange?: (draft: DraftContent) => void;
  } = $props();

  // Draft state — used by both edit and create flows.
  let draft = $state<TemplateDraft>({ ...EMPTY_DRAFT });
  let lastAiBodyUpdateSeq = $state(0);

  // Seed draft whenever we enter edit/create mode or switch templates.
  // Reference identity on `template` and `creatingDraft` keeps this stable
  // during ongoing edits — the effect only refires when the parent swaps
  // the source.
  $effect(() => {
    if (creatingDraft) {
      draft = { ...creatingDraft };
      return;
    }
    if (editing && template) {
      draft = {
        name: template.name,
        tags: [...template.tags],
        opening: template.opening,
        body: template.body,
        folder: template.folder,
      };
    }
  });

  $effect(() => {
    if (!creatingDraft && (!editing || !template)) return;
    onDraftChange({ opening: draft.opening, body: draft.body });
  });

  $effect(() => {
    if (aiBodyUpdate === null) return;
    if (creatingDraft) {
      if (aiBodyUpdate.seq === lastAiBodyUpdateSeq) return;
      lastAiBodyUpdateSeq = aiBodyUpdate.seq;
      draft = { ...draft, body: aiBodyUpdate.body };
      return;
    }
    if (!editing || !template) return;
    if (aiBodyUpdate.templateId !== template.id || aiBodyUpdate.seq === lastAiBodyUpdateSeq) return;
    lastAiBodyUpdateSeq = aiBodyUpdate.seq;
    draft = { ...draft, body: aiBodyUpdate.body };
  });

  function handleSave(): void {
    if (!template) return;
    const folder = draft.folder !== null && draft.folder.trim().length > 0 ? draft.folder.trim() : null;
    onSave({
      ...template,
      name: draft.name.trim() || "Untitled",
      tags: draft.tags,
      opening: draft.opening,
      body: draft.body,
      folder,
      updated_at: new Date().toISOString(),
    });
  }

  function handleCreate(): void {
    onCreate(draft);
  }

  function handleFormSubmit(): void {
    if (creatingDraft) handleCreate();
    else handleSave();
  }

  function handleFormKey(e: KeyboardEvent): void {
    if (!canEdit) return;
    if (!creatingDraft && !editing) return;
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      handleFormSubmit();
    } else if (e.key === "Escape" && creatingDraft) {
      // Mirrors the old SaveAsModal cancel-on-Escape. Pickers stopPropagation
      // when their dropdown is open, so this only fires from "outside" focus.
      e.preventDefault();
      onCancelEdit();
    }
  }
</script>

<svelte:window onkeydown={handleFormKey} />

<div class="header-row">
  <div class="breadcrumb">{creatingDraft ? "new template" : "editing"}</div>
  <div class="actions">
    <button class="icon-btn" onclick={onCancelEdit}>Cancel</button>
    <button class="icon-btn primary" onclick={handleFormSubmit}>Save</button>
  </div>
</div>

<TemplateForm
  value={draft}
  {availableTags}
  {availableFolders}
  bodyGrow
  autofocusName={!!creatingDraft}
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
    background: var(--accent-positive-bg);
    border-color: var(--accent-positive-border);
    color: var(--accent-positive-text);
  }

  .icon-btn.primary:hover {
    background: var(--accent-positive-hover);
  }
</style>
