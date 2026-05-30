<script lang="ts">
  import type { Template, TemplateDraft } from "$lib/types";
  import TemplateView from "./TemplateView.svelte";
  import TemplateEditPanel from "./TemplateEditPanel.svelte";

  type DraftContent = { opening: string; body: string };
  /** `templateId` is null in the create-new-template flow (no template yet);
   *  in edit mode it's the edited template's id so a stale signal from a
   *  prior selection can be rejected. */
  type BodyUpdate = { templateId: string | null; body: string; seq: number };

  let {
    template,
    includeOpening,
    includeSignature,
    editing,
    globalSignature,
    snippets,
    canEdit,
    availableTags,
    availableFolders,
    copyTrigger,
    savedPlaceholderValues,
    inboundText,
    adaptBusy,
    adaptError,
    creatingDraft = null,
    onToggleOpening,
    onToggleSignature,
    onEnterEdit,
    onCancelEdit,
    onSave,
    onCreate = () => {},
    onDuplicate,
    onDelete,
    onBaseOnTemplate,
    onAdaptToInbound,
    onClearAdaptError,
    onCopySuccess,
    onPlaceholderValuesChange,
    onRevertHistory,
    aiBodyUpdate = null,
    onDraftChange = () => {},
  }: {
    template: Template | null;
    includeOpening: boolean;
    includeSignature: boolean;
    editing: boolean;
    globalSignature: string;
    snippets: Record<string, string>;
    canEdit: boolean;
    availableTags: string[];
    availableFolders: string[];
    copyTrigger: number;
    /** Persisted per-template fill-ins. Outer key: template id. */
    savedPlaceholderValues: Record<string, Record<string, string>>;
    /** The pasted inbound message in paste-match mode. null/empty disables Adapt. */
    inboundText: string | null;
    /** True while an adapt-to-inbound request is in flight. */
    adaptBusy: boolean;
    /** Last adapt-to-inbound error message. Null when no error or after retry. */
    adaptError: string | null;
    /** When non-null, the panel renders the new-template form seeded from this
     *  draft (instead of an existing template). Parent must hold a stable
     *  reference for the form's lifetime. */
    creatingDraft?: TemplateDraft | null;
    onToggleOpening: (v: boolean) => void;
    onToggleSignature: (v: boolean) => void;
    onEnterEdit: () => void;
    onCancelEdit: () => void;
    onSave: (t: Template) => void;
    onCreate?: (draft: TemplateDraft) => void;
    onDuplicate: () => void;
    onDelete: () => void;
    onBaseOnTemplate: () => void;
    onAdaptToInbound: () => void;
    onClearAdaptError: () => void;
    onCopySuccess: (templateId: string) => void;
    onPlaceholderValuesChange: (templateId: string, values: Record<string, string>) => void;
    onRevertHistory: (templateId: string, versionIdx: number) => void;
    aiBodyUpdate?: BodyUpdate | null;
    onDraftChange?: (draft: DraftContent) => void;
  } = $props();
</script>

<section class="main">
  {#if !template && !creatingDraft}
    <div class="empty">
      <p class="empty-line">
        {canEdit
          ? "Select a template from the sidebar, or create a new one."
          : "Select a template from the sidebar."}
      </p>
      <div class="empty-kbd-row">
        <span><kbd>↑</kbd><kbd>↓</kbd> pick</span>
        <span class="empty-sep">·</span>
        <span><kbd>⏎</kbd> copy</span>
        <span class="empty-sep">·</span>
        <span><kbd>?</kbd> all shortcuts</span>
      </div>
    </div>
  {:else if canEdit && (creatingDraft || editing)}
    <TemplateEditPanel
      {template}
      {editing}
      {canEdit}
      {availableTags}
      {availableFolders}
      {creatingDraft}
      {onCancelEdit}
      {onSave}
      {onCreate}
      {aiBodyUpdate}
      {onDraftChange}
    />
  {:else if template}
    <TemplateView
      {template}
      {includeOpening}
      {includeSignature}
      {globalSignature}
      {snippets}
      {canEdit}
      {copyTrigger}
      {savedPlaceholderValues}
      {inboundText}
      {adaptBusy}
      {adaptError}
      {onToggleOpening}
      {onToggleSignature}
      {onEnterEdit}
      {onSave}
      {onDuplicate}
      {onDelete}
      {onBaseOnTemplate}
      {onAdaptToInbound}
      {onClearAdaptError}
      {onCopySuccess}
      {onPlaceholderValuesChange}
      {onRevertHistory}
    />
  {/if}
</section>

<style>
  .main {
    flex: 1;
    display: flex;
    flex-direction: column;
    padding: 20px 24px;
    overflow-y: auto;
    background: var(--bg-base);
    box-sizing: border-box;
  }

  .empty {
    color: var(--text-placeholder);
    font-size: 0.9rem;
    margin: auto;
    text-align: center;
    display: flex;
    flex-direction: column;
    gap: 14px;
    align-items: center;
  }

  .empty-line {
    margin: 0;
  }

  .empty-kbd-row {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 0.78rem;
    color: var(--text-subtle);
  }

  .empty-kbd-row kbd {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 16px;
    height: 18px;
    padding: 0 5px;
    margin-right: 3px;
    border: 1px solid var(--border);
    border-bottom-width: 2px;
    background: var(--bg-elevated);
    border-radius: 3px;
    font-family: inherit;
    font-size: 0.7rem;
    color: var(--text-muted);
    line-height: 1;
  }

  .empty-sep {
    color: var(--text-subtle);
  }
</style>
