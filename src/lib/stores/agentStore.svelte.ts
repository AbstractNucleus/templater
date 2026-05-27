import {
  editTemplate,
  adaptTemplate,
  explainRankError,
  type ChatTurn,
} from "$lib/api";
import { type Template, type TemplateDraft } from "$lib/types";
import { templatesStore } from "$lib/stores/templatesStore.svelte";
import { selectionStore } from "$lib/stores/selectionStore.svelte";

type AgentKind = "new" | "base" | "edit";
type AgentDraft = { opening: string; body: string };

const DEFAULT_OPENING = "Hello,";

class AgentStore {
  baseMode = $state(false);
  baseKind = $state<AgentKind>("base");
  baseSourceName = $state("");
  baseDraft = $state<AgentDraft>({ opening: "", body: "" });
  /** Folder inherited from the source template when basing / adapting.
   *  Seeded into the new-template form so users don't lose grouping. */
  baseFolder = $state<string | null>(null);
  agentMessages = $state<ChatTurn[]>([]);
  agentBusy = $state(false);
  agentError = $state<string | null>(null);
  agentProgress = $state("");
  saveAsOpen = $state(false);
  /** Stable snapshot the create form reads as its initial seed. Set on
   *  `openSaveAs`, cleared on close / commit / exit. Held here (not derived)
   *  so the form's `$effect` doesn't reseed every render and clobber edits. */
  saveDraft = $state<TemplateDraft | null>(null);

  adaptBusy = $state(false);
  adaptError = $state<string | null>(null);

  handleNew(prefilledBody: string = ""): void {
    if (!templatesStore.isEditorMode) return;
    this.baseKind = "new";
    this.baseSourceName = "";
    this.baseDraft = { opening: DEFAULT_OPENING, body: prefilledBody };
    this.baseFolder = null;
    this.agentMessages = [];
    this.agentBusy = false;
    this.agentError = null;
    this.baseMode = true;
  }

  enterBaseMode(source: Template | null): void {
    if (!source) return;
    this.baseKind = "base";
    this.baseSourceName = source.name;
    this.baseDraft = { opening: DEFAULT_OPENING, body: source.body };
    this.baseFolder = source.folder;
    this.agentMessages = [];
    this.agentBusy = false;
    this.agentError = null;
    this.baseMode = true;
  }

  enterEditMode(source: Template | null): void {
    if (!source || !templatesStore.isEditorMode) return;
    this.baseKind = "edit";
    this.baseSourceName = source.name;
    this.baseDraft = { opening: source.opening, body: source.body };
    this.agentMessages = [];
    this.agentBusy = false;
    this.agentError = null;
    this.agentProgress = "";
  }

  exitEditMode(): void {
    if (this.baseKind !== "edit") return;
    this.baseKind = "base";
    this.baseSourceName = "";
    this.baseDraft = { opening: "", body: "" };
    this.agentMessages = [];
    this.agentBusy = false;
    this.agentError = null;
    this.agentProgress = "";
  }

  exitBaseMode(): void {
    this.baseMode = false;
    this.baseKind = "base";
    this.baseSourceName = "";
    this.baseDraft = { opening: "", body: "" };
    this.baseFolder = null;
    this.agentMessages = [];
    this.agentBusy = false;
    this.agentError = null;
    this.saveAsOpen = false;
    this.saveDraft = null;
  }

  openSaveAs(): void {
    this.saveDraft = this.buildSaveDraft();
    this.saveAsOpen = true;
  }

  closeSaveAs(): void {
    this.saveAsOpen = false;
    this.saveDraft = null;
  }

  async handleAgentPrompt(prompt: string): Promise<void> {
    await this.runAgentPrompt(this.baseDraft, prompt, (updated) => {
      this.baseDraft = updated;
    });
  }

  async handleEditAgentPrompt(
    draft: AgentDraft,
    prompt: string,
    onUpdate: (updated: AgentDraft) => void,
  ): Promise<void> {
    await this.runAgentPrompt(draft, prompt, (updated) => {
      this.baseDraft = updated;
      onUpdate(updated);
    });
  }

  private async runAgentPrompt(
    draft: AgentDraft,
    prompt: string,
    onUpdate: (updated: AgentDraft) => void,
  ): Promise<void> {
    if (this.agentBusy) return;
    this.agentError = null;
    this.agentProgress = "";
    const history = [...this.agentMessages];
    this.agentMessages = [...history, { role: "user", content: prompt }];
    this.agentBusy = true;
    try {
      const { reasoning, updated } = await editTemplate(
        draft,
        history,
        prompt,
        templatesStore.settings.paste_backend,
      );
      onUpdate(updated);
      this.agentMessages = [
        ...this.agentMessages,
        { role: "assistant", content: reasoning || "(no reasoning provided)" },
      ];
    } catch (e) {
      this.agentError = explainRankError(String(e));
    } finally {
      this.agentBusy = false;
      this.agentProgress = "";
    }
  }

  /** Snapshot the editable subset that seeds the new-template form. The form
   *  takes ownership of edits; the store only re-reads `baseFolder` etc. when
   *  the form is opened. */
  buildSaveDraft(): TemplateDraft {
    return {
      name: "",
      tags: [],
      opening: this.baseDraft.opening,
      body: this.baseDraft.body,
      folder: this.baseFolder,
    };
  }

  async commitNewTemplate(draft: TemplateDraft): Promise<void> {
    if (!templatesStore.isEditorMode) return;
    templatesStore.pushUndo("agent save");
    const now = new Date().toISOString();
    const folder = draft.folder !== null && draft.folder.trim().length > 0
      ? draft.folder.trim()
      : null;
    const newTemplate: Template = {
      id: crypto.randomUUID(),
      name: draft.name.trim() || "Untitled",
      tags: draft.tags,
      opening: draft.opening,
      body: draft.body,
      created_at: now,
      updated_at: now,
      pinned: false,
      last_used_at: null,
      copy_count: 0,
      folder,
      history: [],
    };
    const next = [newTemplate, ...templatesStore.templates];
    await templatesStore.persist(next);
    templatesStore.selectedTemplateId = newTemplate.id;
    selectionStore.selectedTemplateId = newTemplate.id;
    this.saveAsOpen = false;
    this.exitBaseMode();
  }

  async adaptToInbound(
    source: Template | null,
    inbound: string,
    pasteThreshold: number,
  ): Promise<void> {
    // Snapshot the source up front — selectedTemplate is reactive at the
    // call site, so reading it after the await would race with a mid-flight
    // selection change and mislabel baseSourceName.
    if (!source || this.adaptBusy) return;
    const trimmed = inbound.trim();
    if (trimmed.length < pasteThreshold) return;
    this.adaptBusy = true;
    this.adaptError = null;
    try {
      const { reasoning, updated, contextUsed } = await adaptTemplate(
        { opening: source.opening, body: source.body },
        trimmed,
        templatesStore.settings.paste_backend,
      );
      // Enter base mode with the adapted draft pre-filled. Seed the chat with
      // the implicit "adapt this" turn so further refinement has context.
      this.baseKind = "base";
      this.baseSourceName = source.name;
      this.baseDraft = updated;
      this.baseFolder = source.folder;
      const reasoningText = reasoning || "(no reasoning provided)";
      const contextLine =
        contextUsed.length > 0
          ? `\n\nConsulted context: ${contextUsed.map((c) => c.path.split(/[\\/]/).pop()).join(", ")}`
          : "";
      this.agentMessages = [
        { role: "user", content: `Adapt this template to the inbound message:\n\n${trimmed}` },
        { role: "assistant", content: reasoningText + contextLine },
      ];
      this.agentError = null;
      this.agentBusy = false;
      this.baseMode = true;
    } catch (e) {
      this.adaptError = explainRankError(String(e));
    } finally {
      this.adaptBusy = false;
    }
  }
}

export const agentStore = new AgentStore();
