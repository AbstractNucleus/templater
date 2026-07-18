<script lang="ts">
  import type { Template, TemplateDraft } from "$lib/types";
  import TemplateView from "./TemplateView.svelte";
  import TemplateEditPanel from "./TemplateEditPanel.svelte";

  type SharedProps = {
    includeOpening: boolean;
    includeSignature: boolean;
    globalSignature: string;
    snippets: Record<string, string>;
    canEdit: boolean;
    availableTags: string[];
    availableFolders: string[];
    copyTrigger: number;
    savedPlaceholderValues: Record<string, Record<string, string>>;
    onToggleOpening: (v: boolean) => void;
    onToggleSignature: (v: boolean) => void;
    onCopySuccess: (templateId: string) => void;
    onPlaceholderValuesChange: (templateId: string, values: Record<string, string>) => void;
    onRevertHistory: (templateId: string, versionIdx: number) => void;
  };

  type PanelMode =
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
        onDuplicate: () => void;
        onDelete: () => void;
      }
    | {
        kind: "browse";
        template: Template | null;
        onEnterEdit: () => void;
        onSave: (t: Template) => void;
        onDuplicate: () => void;
        onDelete: () => void;
      };

  let { mode, ...shared }: { mode: PanelMode } & SharedProps = $props();
</script>

<section class="main">
  {#if mode.kind === "create"}
    <TemplateEditPanel
      template={null}
      editing={false}
      canEdit={shared.canEdit}
      availableTags={shared.availableTags}
      availableFolders={shared.availableFolders}
      creatingDraft={mode.draft}
      onCancelEdit={mode.onCancel}
      onSave={() => {}}
      onCreate={mode.onCreate}
    />
  {:else if mode.kind === "edit"}
    <TemplateEditPanel
      template={mode.template}
      editing={true}
      canEdit={shared.canEdit}
      availableTags={shared.availableTags}
      availableFolders={shared.availableFolders}
      creatingDraft={null}
      onCancelEdit={mode.onCancel}
      onSave={mode.onSave}
      onCreate={() => {}}
    />
  {:else if mode.template}
    <TemplateView
      template={mode.template}
      includeOpening={shared.includeOpening}
      includeSignature={shared.includeSignature}
      globalSignature={shared.globalSignature}
      snippets={shared.snippets}
      canEdit={shared.canEdit}
      copyTrigger={shared.copyTrigger}
      savedPlaceholderValues={shared.savedPlaceholderValues}
      onToggleOpening={shared.onToggleOpening}
      onToggleSignature={shared.onToggleSignature}
      onEnterEdit={mode.onEnterEdit}
      onSave={mode.onSave}
      onDuplicate={mode.onDuplicate}
      onDelete={mode.onDelete}
      onCopySuccess={shared.onCopySuccess}
      onPlaceholderValuesChange={shared.onPlaceholderValuesChange}
      onRevertHistory={shared.onRevertHistory}
    />
  {:else}
    <div class="empty">
      <p class="empty-line">
        {shared.canEdit
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
