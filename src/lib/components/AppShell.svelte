<script lang="ts">
  import TemplateView from "./TemplateView.svelte";
  import TemplateEditPanel from "./TemplateEditPanel.svelte";
  import { templatesStore } from "$lib/stores/templatesStore.svelte";
  import { selectionStore } from "$lib/stores/selectionStore.svelte";
  import { editorSession } from "$lib/stores/editorSession.svelte";

  /** Session-only UI (compose toggles). Store data is read here. */
  let {
    includeOpening,
    includeSignature,
    onToggleOpening,
    onToggleSignature,
  }: {
    includeOpening: boolean;
    includeSignature: boolean;
    onToggleOpening: (v: boolean) => void;
    onToggleSignature: (v: boolean) => void;
  } = $props();

  const selectedTemplate = $derived(
    templatesStore.templates.find((t) => t.id === selectionStore.selectedTemplateId) ?? null,
  );
  const canEdit = $derived(templatesStore.isEditorMode);
</script>

<section class="main">
  {#if editorSession.creatingDraft !== null}
    <TemplateEditPanel
      mode={{
        kind: "create",
        draft: editorSession.creatingDraft,
        onCancel: () => editorSession.cancelCreate(),
        onCreate: (d) => void editorSession.create(d),
      }}
    />
  {:else if editorSession.editing && selectedTemplate}
    <TemplateEditPanel
      mode={{
        kind: "edit",
        template: selectedTemplate,
        onCancel: () => editorSession.cancelEdit(),
        onSave: (t) => void editorSession.save(t),
      }}
    />
  {:else if selectedTemplate}
    <TemplateView
      template={selectedTemplate}
      {includeOpening}
      {includeSignature}
      {onToggleOpening}
      {onToggleSignature}
    />
  {:else}
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
    color: var(--text-muted);
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
