import type { Template, TemplateDraft } from "$lib/types";
import { templatesStore } from "$lib/stores/templatesStore.svelte";
import { selectionStore } from "$lib/stores/selectionStore.svelte";

export type EditorMode =
  | { kind: "idle" }
  | { kind: "creating"; draft: TemplateDraft }
  | { kind: "editing" };

/** Create/edit session as a single discriminated mode (idle | creating | editing). */
class EditorSession {
  mode = $state<EditorMode>({ kind: "idle" });

  get isActive(): boolean {
    return this.mode.kind !== "idle";
  }

  get creatingDraft(): TemplateDraft | null {
    return this.mode.kind === "creating" ? this.mode.draft : null;
  }

  get editing(): boolean {
    return this.mode.kind === "editing";
  }

  enterEdit(): void {
    this.mode = { kind: "editing" };
  }

  cancelEdit(): void {
    if (this.mode.kind === "editing") this.mode = { kind: "idle" };
  }

  /** Drop edit mode when the user picks another template. */
  clearEditOnSelect(): void {
    if (this.mode.kind === "editing") this.mode = { kind: "idle" };
  }

  startCreate(prefilledBody = ""): void {
    if (!templatesStore.isEditorMode) return;
    this.mode = {
      kind: "creating",
      draft: {
        name: "",
        tags: [],
        opening: "Hello,",
        body: prefilledBody,
        folder: null,
      },
    };
  }

  cancelCreate(): void {
    if (this.mode.kind === "creating") this.mode = { kind: "idle" };
  }

  async save(updated: Template): Promise<void> {
    await templatesStore.handleSave(updated);
    this.mode = { kind: "idle" };
  }

  async create(draft: TemplateDraft): Promise<void> {
    const id = await templatesStore.createTemplate(draft);
    if (!id) return;
    selectionStore.selectedTemplateId = id;
    this.mode = { kind: "idle" };
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
