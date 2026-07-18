import type { Template, TemplateDraft } from "$lib/types";
import { templatesStore } from "$lib/stores/templatesStore.svelte";
import { selectionStore } from "$lib/stores/selectionStore.svelte";

/** Create/edit session flags + handlers. Page reads state; mutations go here. */
class EditorSession {
  creatingDraft = $state<TemplateDraft | null>(null);
  editing = $state(false);

  get isActive(): boolean {
    return this.editing || this.creatingDraft !== null;
  }

  enterEdit(): void {
    this.editing = true;
  }

  cancelEdit(): void {
    this.editing = false;
  }

  /** Drop edit mode when the user picks another template. */
  clearEditOnSelect(): void {
    if (this.editing) this.editing = false;
  }

  startCreate(prefilledBody = ""): void {
    if (!templatesStore.isEditorMode) return;
    this.creatingDraft = {
      name: "",
      tags: [],
      opening: "Hello,",
      body: prefilledBody,
      folder: null,
    };
  }

  cancelCreate(): void {
    this.creatingDraft = null;
  }

  async save(updated: Template): Promise<void> {
    await templatesStore.handleSave(updated);
    this.editing = false;
  }

  async create(draft: TemplateDraft): Promise<void> {
    const id = await templatesStore.createTemplate(draft);
    if (!id) return;
    selectionStore.selectedTemplateId = id;
    this.creatingDraft = null;
  }

  async duplicate(template: Template | null): Promise<void> {
    if (!template) return;
    await templatesStore.duplicateId(template.id);
  }

  async delete(template: Template | null): Promise<void> {
    if (!template) return;
    await templatesStore.deleteIds([template.id]);
  }
}

export const editorSession = new EditorSession();
