import { emit, listen } from "@tauri-apps/api/event";
import {
  closePreviewWindow,
  closeTranslatorWindow,
  isPreviewOpen,
  isTranslatorOpen,
  openPreviewWindow,
  openTranslatorWindow,
} from "$lib/api";
import type { Template, Theme } from "$lib/types";
import { selectionStore } from "$lib/stores/selectionStore.svelte";
import { templatesStore } from "$lib/stores/templatesStore.svelte";

export type PreviewPayload = {
  template: Template | null;
  globalSignature: string;
  snippets: Record<string, string>;
  placeholderValues: Record<string, string>;
  canEdit: boolean;
  theme: Theme;
  previewHotkey: string;
};

export type TranslatorPayload = {
  openrouterApiKey: string;
  translationModel: string;
  theme: Theme;
};

class Popouts {
  previewOpen = $state(false);
  translatorOpen = $state(false);

  /** Prefer an explicit template (page effects); otherwise resolve selection. */
  buildPreviewPayload(canEdit: boolean, selected?: Template | null): PreviewPayload {
    const template =
      selected !== undefined
        ? selected
        : (templatesStore.templates.find((t) => t.id === selectionStore.selectedTemplateId) ??
          null);
    const s = templatesStore.settings;
    return {
      template,
      globalSignature: s.global_signature,
      snippets: s.snippets,
      placeholderValues: (template && s.placeholder_values[template.id]) ?? {},
      canEdit,
      theme: s.theme,
      previewHotkey: s.preview_hotkey,
    };
  }

  buildTranslatorPayload(): TranslatorPayload {
    const s = templatesStore.settings;
    return {
      openrouterApiKey: s.openrouter_api_key,
      translationModel: s.translation_model,
      theme: s.theme,
    };
  }

  async togglePreview(getPayload: () => PreviewPayload): Promise<void> {
    if (this.previewOpen) {
      try {
        await closePreviewWindow();
      } catch {
        /* ignore */
      }
      this.previewOpen = false;
      return;
    }
    try {
      await openPreviewWindow();
      this.previewOpen = true;
      void emit("preview-payload", getPayload());
    } catch (e) {
      templatesStore.loadError = `open preview failed: ${e}`;
    }
  }

  async toggleTranslator(getPayload: () => TranslatorPayload): Promise<void> {
    if (this.translatorOpen) {
      try {
        await closeTranslatorWindow();
      } catch {
        /* ignore */
      }
      this.translatorOpen = false;
      return;
    }
    try {
      await openTranslatorWindow();
      this.translatorOpen = true;
      void emit("translator-payload", getPayload());
    } catch (e) {
      templatesStore.loadError = `open translator failed: ${e}`;
    }
  }

  pushPreview(payload: PreviewPayload): void {
    if (!this.previewOpen) return;
    void emit("preview-payload", payload);
  }

  pushTranslator(payload: TranslatorPayload): void {
    if (!this.translatorOpen) return;
    void emit("translator-payload", payload);
  }

  async syncOpenFlags(): Promise<void> {
    try {
      this.previewOpen = await isPreviewOpen();
    } catch {
      this.previewOpen = false;
    }
    try {
      this.translatorOpen = await isTranslatorOpen();
    } catch {
      this.translatorOpen = false;
    }
  }

  closePreviewForMinimalOff(): void {
    if (!this.previewOpen) return;
    void closePreviewWindow().catch(() => {});
    this.previewOpen = false;
  }

  /** Event bridge: payload requests, copy/placeholder mirror, closed flags. */
  mountListeners(opts: {
    getPreviewPayload: () => PreviewPayload;
    getTranslatorPayload: () => TranslatorPayload;
  }): () => void {
    const unlistenRequest = listen("preview-request-payload", () => {
      void emit("preview-payload", opts.getPreviewPayload());
    });
    const unlistenCopy = listen<{ templateId: string }>("preview-copy-success", (e) => {
      void templatesStore.recordCopy(e.payload.templateId);
    });
    const unlistenPlaceholder = listen<{
      templateId: string;
      values: Record<string, string>;
    }>("preview-placeholder-change", (e) => {
      void templatesStore.recordPlaceholderValues(e.payload.templateId, e.payload.values);
    });
    const unlistenClosed = listen("preview-closed", () => {
      this.previewOpen = false;
    });
    const unlistenRequestClose = listen("preview-request-close", () => {
      void closePreviewWindow().catch(() => {});
      this.previewOpen = false;
    });
    const unlistenTranslatorRequest = listen("translator-request-payload", () => {
      void emit("translator-payload", opts.getTranslatorPayload());
    });
    const unlistenTranslatorClosed = listen("translator-closed", () => {
      this.translatorOpen = false;
    });
    return () => {
      void unlistenRequest.then((u) => u());
      void unlistenCopy.then((u) => u());
      void unlistenPlaceholder.then((u) => u());
      void unlistenClosed.then((u) => u());
      void unlistenRequestClose.then((u) => u());
      void unlistenTranslatorRequest.then((u) => u());
      void unlistenTranslatorClosed.then((u) => u());
    };
  }
}

export const popouts = new Popouts();
