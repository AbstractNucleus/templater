import { emit, listen } from "@tauri-apps/api/event";
import { isSatellite, setSatellite, type SatelliteKind } from "$lib/api/windows";
import type { Template, Theme } from "$lib/types";
import { selectionStore } from "$lib/stores/selectionStore.svelte";
import { templatesStore } from "$lib/stores/templatesStore.svelte";
import { appErrors } from "$lib/stores/appErrors.svelte";

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
  theme: Theme;
};

class Popouts {
  previewOpen = $state(false);
  translatorOpen = $state(false);
  #lifecycleStarted = false;

  /** Resolve selection from stores — single payload path for page + keyboard. */
  buildPreviewPayload(): PreviewPayload {
    const template =
      templatesStore.templates.find((t) => t.id === selectionStore.selectedTemplateId) ?? null;
    const s = templatesStore.settings;
    return {
      template,
      globalSignature: s.global_signature,
      snippets: s.snippets,
      placeholderValues: (template && s.placeholder_values[template.id]) ?? {},
      canEdit: templatesStore.isEditorMode,
      theme: s.theme,
      previewHotkey: s.preview_hotkey,
    };
  }

  buildTranslatorPayload(): TranslatorPayload {
    return {
      theme: templatesStore.settings.theme,
    };
  }

  async #toggle(kind: SatelliteKind): Promise<void> {
    const open = kind === "preview" ? this.previewOpen : this.translatorOpen;
    if (open) {
      try {
        await setSatellite(kind, false);
        // Backend closed event also clears; set after success so failed close
        // doesn't lie about the window state.
        if (kind === "preview") this.previewOpen = false;
        else this.translatorOpen = false;
      } catch (e) {
        appErrors.setAction(`close ${kind} failed: ${e}`);
        await this.syncOpenFlags();
      }
      return;
    }
    try {
      await setSatellite(kind, true);
      // Only flip local open after backend succeeds (backend is authority).
      if (kind === "preview") {
        this.previewOpen = true;
        void emit("preview-payload", this.buildPreviewPayload());
      } else {
        this.translatorOpen = true;
        void emit("translator-payload", this.buildTranslatorPayload());
      }
    } catch (e) {
      appErrors.setAction(`open ${kind} failed: ${e}`);
    }
  }

  async togglePreview(): Promise<void> {
    await this.#toggle("preview");
  }

  async toggleTranslator(): Promise<void> {
    await this.#toggle("translator");
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
      this.previewOpen = await isSatellite("preview");
    } catch {
      this.previewOpen = false;
    }
    try {
      this.translatorOpen = await isSatellite("translator");
    } catch {
      this.translatorOpen = false;
    }
  }

  closePreviewForMinimalOff(): void {
    if (!this.previewOpen) return;
    void setSatellite("preview", false)
      .then(() => {
        this.previewOpen = false;
      })
      .catch((e) => {
        appErrors.setAction(`close preview failed: ${e}`);
        void this.syncOpenFlags();
      });
  }

  /** Event bridge: payload requests, copy/placeholder mirror, closed flags. */
  mountListeners(): () => void {
    const unlistenRequest = listen("preview-request-payload", () => {
      void emit("preview-payload", this.buildPreviewPayload());
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
      void setSatellite("preview", false)
        .then(() => {
          this.previewOpen = false;
        })
        .catch((e) => {
          appErrors.setAction(`close preview failed: ${e}`);
          void this.syncOpenFlags();
        });
    });
    const unlistenTranslatorRequest = listen("translator-request-payload", () => {
      void emit("translator-payload", this.buildTranslatorPayload());
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

  /**
   * Owns reactive push + listeners + open-flag sync. Call once from the main
   * route; returns a teardown for the effect root.
   */
  startLifecycle(): () => void {
    if (this.#lifecycleStarted) return () => {};
    this.#lifecycleStarted = true;
    return $effect.root(() => {
      $effect(() => {
        void selectionStore.selectedTemplateId;
        void templatesStore.templates;
        void templatesStore.isEditorMode;
        const s = templatesStore.settings;
        void s.global_signature;
        void s.snippets;
        void s.placeholder_values;
        void s.theme;
        void s.preview_hotkey;
        this.pushPreview(this.buildPreviewPayload());
      });
      $effect(() => {
        void templatesStore.settings.theme;
        this.pushTranslator(this.buildTranslatorPayload());
      });
      $effect(() => {
        if (!templatesStore.settings.minimal) this.closePreviewForMinimalOff();
      });
      const unlisten = this.mountListeners();
      void this.syncOpenFlags();
      return () => {
        unlisten();
        this.#lifecycleStarted = false;
      };
    });
  }
}

export const popouts = new Popouts();
