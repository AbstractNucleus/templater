import {
  editTemplate,
  adaptTemplate,
  explainRankError,
  type ChatTurn,
} from "$lib/api";
import { type Template } from "$lib/types";
import { templatesStore } from "$lib/stores/templatesStore.svelte";
import { selectionStore } from "$lib/stores/selectionStore.svelte";

class AgentStore {
  baseMode = $state(false);
  baseKind = $state<"new" | "base">("base");
  baseSourceName = $state("");
  baseDraft = $state<{ opening: string; body: string }>({ opening: "", body: "" });
  baseSignatureOverride = $state<string | null>(null);
  agentMessages = $state<ChatTurn[]>([]);
  agentBusy = $state(false);
  agentError = $state<string | null>(null);
  agentProgress = $state("");
  saveAsOpen = $state(false);

  adaptBusy = $state(false);
  adaptError = $state<string | null>(null);

  handleNew(prefilledBody: string = ""): void {
    if (!templatesStore.isEditorMode) return;
    this.baseKind = "new";
    this.baseSourceName = "";
    this.baseDraft = { opening: "", body: prefilledBody };
    this.baseSignatureOverride = null;
    this.agentMessages = [];
    this.agentBusy = false;
    this.agentError = null;
    this.baseMode = true;
  }

  enterBaseMode(source: Template | null): void {
    if (!source) return;
    this.baseKind = "base";
    this.baseSourceName = source.name;
    this.baseDraft = { opening: source.opening, body: source.body };
    this.baseSignatureOverride = source.signature_override;
    this.agentMessages = [];
    this.agentBusy = false;
    this.agentError = null;
    this.baseMode = true;
  }

  exitBaseMode(): void {
    this.baseMode = false;
    this.baseKind = "base";
    this.baseSourceName = "";
    this.baseDraft = { opening: "", body: "" };
    this.baseSignatureOverride = null;
    this.agentMessages = [];
    this.agentBusy = false;
    this.agentError = null;
    this.saveAsOpen = false;
  }

  openSaveAs(): void {
    this.saveAsOpen = true;
  }

  closeSaveAs(): void {
    this.saveAsOpen = false;
  }

  async handleAgentPrompt(prompt: string): Promise<void> {
    if (this.agentBusy) return;
    this.agentError = null;
    this.agentProgress = "";
    const history = [...this.agentMessages];
    this.agentMessages = [...history, { role: "user", content: prompt }];
    this.agentBusy = true;
    try {
      const { reasoning, updated } = await editTemplate(
        this.baseDraft,
        history,
        prompt,
        templatesStore.settings.paste_backend,
      );
      this.baseDraft = updated;
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

  async handleSaveAs(name: string, tags: string[]): Promise<void> {
    if (!templatesStore.isEditorMode) return;
    templatesStore.pushUndo("agent save");
    const now = new Date().toISOString();
    const newTemplate: Template = {
      id: crypto.randomUUID(),
      name,
      tags,
      opening: this.baseDraft.opening,
      body: this.baseDraft.body,
      created_at: now,
      updated_at: now,
      pinned: false,
      last_used_at: null,
      copy_count: 0,
      folder: null,
      signature_override: this.baseSignatureOverride,
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
      this.baseSignatureOverride = source.signature_override;
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
