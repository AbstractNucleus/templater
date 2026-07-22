<script lang="ts">
  import TagsSidebar from "$lib/components/TagsSidebar.svelte";
  import TemplatesSidebar from "$lib/components/TemplatesSidebar.svelte";
  import AppShell from "$lib/components/AppShell.svelte";
  import TitleBar from "$lib/components/TitleBar.svelte";
  import ResizeHandles from "$lib/components/ResizeHandles.svelte";
  import DialogsHost from "$lib/components/DialogsHost.svelte";
  import OnboardingTour from "$lib/components/OnboardingTour.svelte";
  import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager";
  import { getCurrentWebview } from "@tauri-apps/api/webview";
  import { listen } from "@tauri-apps/api/event";
  import { bindContextMenuItems, buildContextMenu } from "$lib/contextMenu";
  import { bootstrapApp } from "$lib/appBootstrap";
  import {
    applyMinimalGeometry,
    createMinimalGeometryState,
  } from "$lib/minimalGeometry";
  import { DEFAULT_COLUMN_WIDTHS } from "$lib/types";
  import { templatesStore } from "$lib/stores/templatesStore.svelte";
  import { selectionStore } from "$lib/stores/selectionStore.svelte";
  import { browseSession } from "$lib/stores/browseSession.svelte";
  import { editorSession } from "$lib/stores/editorSession.svelte";
  import { popouts } from "$lib/stores/popouts.svelte";
  import { uiDialogs } from "$lib/stores/uiDialogs.svelte";
  import { appErrors } from "$lib/stores/appErrors.svelte";
  import { createGlobalKeydownHandler } from "$lib/keyboard";
  import { composeSession } from "$lib/stores/composeSession.svelte";

  const ZOOM_MIN = 0.5;
  const ZOOM_MAX = 2.0;
  const ZOOM_STEP = 0.1;

  const TAGS_MIN = 100;
  const TAGS_MAX = 400;
  const TEMPLATES_MIN = 160;
  const TEMPLATES_MAX = 500;

  let tagsWidth = $state(DEFAULT_COLUMN_WIDTHS.tags);
  let templatesWidth = $state(DEFAULT_COLUMN_WIDTHS.templates);
  let appVersion = $state("0.0.0");
  let includeOpening = $state(true);
  let includeSignature = $state(true);

  const minimalGeo = createMinimalGeometryState();

  function handleGlobalContextMenu(e: MouseEvent): void {
    const result = buildContextMenu(e);
    if (result.action === "default") return;
    e.preventDefault();
    if (result.action === "menu") {
      uiDialogs.contextMenu = {
        x: e.clientX,
        y: e.clientY,
        items: bindContextMenuItems(result.items, {
          readText: async () => {
            try {
              return await readText();
            } catch {
              return null;
            }
          },
          writeText: (text) => writeText(text),
        }),
      };
    }
  }

  function setZoom(next: number): void {
    // Round to one decimal to avoid 0.1-step float drift (0.7 + 0.1 = 0.7999…).
    const clamped = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Math.round(next * 10) / 10));
    if (clamped === templatesStore.settings.zoom) return;
    void templatesStore.persist(templatesStore.templates, { ...templatesStore.settings, zoom: clamped }).catch(() => {});
  }

  function copySelected(): void {
    if (selectionStore.selectedTemplateId === null) return;
    composeSession.requestCopy();
  }

  function startResize(target: "tags" | "templates"): (e: PointerEvent) => void {
    return (e) => {
      e.preventDefault();
      const handle = e.currentTarget as HTMLElement;
      const startX = e.clientX;
      const widthOf = (t: typeof target): number =>
        t === "tags" ? tagsWidth : templatesWidth;
      const startWidth = widthOf(target);
      const min = target === "tags" ? TAGS_MIN : TEMPLATES_MIN;
      const max = target === "tags" ? TAGS_MAX : TEMPLATES_MAX;
      handle.setPointerCapture(e.pointerId);
      handle.classList.add("dragging");

      function onMove(ev: PointerEvent): void {
        const next = Math.round(Math.max(min, Math.min(max, startWidth + (ev.clientX - startX))));
        if (target === "tags") tagsWidth = next;
        else templatesWidth = next;
      }

      function onUp(): void {
        handle.removeEventListener("pointermove", onMove);
        handle.removeEventListener("pointerup", onUp);
        handle.removeEventListener("pointercancel", onUp);
        handle.releasePointerCapture(e.pointerId);
        handle.classList.remove("dragging");
        const final = widthOf(target);
        if (final !== templatesStore.settings.column_widths[target]) {
          void templatesStore.persist(templatesStore.templates, {
            ...templatesStore.settings,
            column_widths: { ...templatesStore.settings.column_widths, [target]: final },
          }).catch(() => {});
        }
      }

      handle.addEventListener("pointermove", onMove);
      handle.addEventListener("pointerup", onUp);
      handle.addEventListener("pointercancel", onUp);
    };
  }

  const settings = $derived(templatesStore.settings);
  const loaded = $derived(templatesStore.loaded);
  const undoToast = $derived(templatesStore.undoToast);
  const isEditorMode = $derived(templatesStore.isEditorMode);
  const isMinimal = $derived(settings.minimal);

  // Session UI for AppShell (compose toggles). Store data is read inside.
  const appShellProps = $derived({
    includeOpening,
    includeSignature,
    onToggleOpening: (v: boolean) => (includeOpening = v),
    onToggleSignature: (v: boolean) => (includeSignature = v),
  });

  // Snap selection to the first visible row when the current pick drops out
  // of the result set. Skip during editing where the selection is locked.
  $effect(() => {
    if (editorSession.isActive) return;
    selectionStore.ensureSelection(browseSession.visibleIds);
  });

  $effect(() => {
    void (async () => {
      try {
        const boot = await bootstrapApp();
        appVersion = boot.appVersion;
        tagsWidth = boot.tagsWidth;
        templatesWidth = boot.templatesWidth;
      } catch (e) {
        // Surface the error and leave templates empty — DON'T fall back to
        // starter templates here. Any subsequent persist would overwrite the
        // user's (presumably recoverable) on-disk file with the starter set.
        appErrors.setLoad(String(e));
      }
    })();
  });

  // The Rust handler emits this when the quick-capture hotkey is pressed.
  $effect(() => {
    const unlisten = listen("quick-capture", async () => {
      if (!isEditorMode) return;
      let text = "";
      try {
        text = (await readText()) ?? "";
      } catch {
        text = "";
      }
      editorSession.startCreate(text);
    });
    return () => {
      void unlisten.then((u) => u());
    };
  });

  $effect(() => {
    if (typeof document !== "undefined") {
      document.documentElement.dataset.theme = settings.theme;
    }
  });

  $effect(() => {
    // Webview-level zoom (Ctrl+/− style) reflows scrollbars and hit-testing
    // correctly — CSS `zoom` clips fixed-height flex layouts.
    const z = settings.zoom ?? 1;
    void getCurrentWebview().setZoom(z).catch(() => {});
  });

  // Tray menu → Settings emits this; Rust has already shown + focused the window.
  $effect(() => {
    const unlisten = listen("open-settings", () => {
      uiDialogs.settingsOpen = true;
    });
    return () => {
      void unlisten.then((u) => u());
    };
  });

  const handleGlobalKeydown = createGlobalKeydownHandler({
    getZoom: () => templatesStore.settings.zoom ?? 1,
    setZoom,
    zoomStep: ZOOM_STEP,
    getSearchInput: () => browseSession.searchInputEl,
    getSearchQuery: () => browseSession.searchQuery,
    clearSearch: () => browseSession.clearSearch(),
    isEditing: () => editorSession.isActive,
    moveSelection: (delta) => browseSession.moveSelection(delta),
    copySelected,
    isMinimal: () => isMinimal,
    blocksShortcuts: () => uiDialogs.blocksShortcuts,
    cheatSheetOpen: () => uiDialogs.cheatSheetOpen,
    toggleCheatSheet: () => {
      uiDialogs.cheatSheetOpen = !uiDialogs.cheatSheetOpen;
    },
    togglePreview: () => void popouts.togglePreview(),
    toggleTranslator: () => void popouts.toggleTranslator(),
    getPreviewHotkey: () => templatesStore.settings.preview_hotkey,
    canUndo: () => templatesStore.isEditorMode,
    performUndo: () => void templatesStore.performUndo().catch(() => {}),
  });

  // Popouts own push + listeners; page only mounts the lifecycle once.
  $effect(() => popouts.startLifecycle());

  $effect(() => {
    applyMinimalGeometry(minimalGeo, isMinimal, tagsWidth, templatesWidth);
  });
</script>

<svelte:window onkeydown={handleGlobalKeydown} oncontextmenu={handleGlobalContextMenu} />

<div class="frame">
  <TitleBar
    onOpenSettings={() => (uiDialogs.settingsOpen = true)}
    showSearch={!editorSession.isActive}
    searchQuery={browseSession.searchQuery}
    onSearchChange={(q) => browseSession.setSearchQuery(q)}
    onClearSearch={() => browseSession.clearSearch()}
    onSearchInputMount={(el) => (browseSession.searchInputEl = el ?? undefined)}
    minimal={isMinimal}
    previewOpen={popouts.previewOpen}
    onTogglePreview={() => void popouts.togglePreview()}
    translatorOpen={popouts.translatorOpen}
    onToggleTranslator={() => void popouts.toggleTranslator()}
  />
  <div class="shell">
    {#if !loaded}
      <aside class="skel skel-tags" style="width: {tagsWidth}px" aria-hidden="true">
        {#each Array(7) as _, i (i)}
          <div class="skel-row" style="animation-delay: {i * 80}ms"></div>
        {/each}
      </aside>
      <aside class="skel skel-templates" style="width: {templatesWidth}px" aria-hidden="true">
        {#each Array(9) as _, i (i)}
          <div class="skel-row tall" style="animation-delay: {i * 80}ms"></div>
        {/each}
      </aside>
      <section class="skel skel-main" aria-hidden="true">
        <div class="skel-line wide"></div>
        <div class="skel-line"></div>
        <div class="skel-block"></div>
      </section>
    {:else if editorSession.isActive}
      <AppShell {...appShellProps} />
    {:else}
      <TagsSidebar width={tagsWidth} />
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="col-resize"
        title="Drag to resize"
        onpointerdown={startResize("tags")}
      ></div>
      <TemplatesSidebar width={templatesWidth} flex={isMinimal} />
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      {#if !isMinimal}
        <div
          class="col-resize"
          title="Drag to resize"
          onpointerdown={startResize("templates")}
        ></div>
        <AppShell {...appShellProps} />
      {/if}
    {/if}
    {#if appErrors.banner}
      <div class="error-banner">
        <span class="error-text">{appErrors.banner}</span>
        {#if templatesStore.settingsCorrupt && appErrors.loadError}
          <button
            class="error-reset"
            onclick={() => void templatesStore.resetCorruptSettings()}
          >Reset settings</button>
        {/if}
        <button class="error-close" aria-label="Dismiss error" onclick={() => appErrors.dismiss()}>×</button>
      </div>
    {/if}
    {#if undoToast}
      <div class="undo-toast" style="bottom: {appErrors.banner ? 48 : 12}px">{undoToast}</div>
    {/if}
  </div>
</div>

<ResizeHandles />

<DialogsHost {appVersion} />

{#if loaded && !settings.onboarding_complete}
  <OnboardingTour
    onDismiss={() => {
      void templatesStore.persist(templatesStore.templates, {
        ...templatesStore.settings,
        onboarding_complete: true,
        close_hint_shown: true,
      }).catch(() => {});
    }}
  />
{/if}

<style>
  .frame {
    display: flex;
    flex-direction: column;
    height: 100%;
    width: 100%;
    background: var(--bg-base);
    border: 1px solid var(--border);
    border-radius: 8px;
    box-shadow: 0 4px 24px var(--shadow), 0 0 0 1px rgba(0, 0, 0, 0.2);
    overflow: hidden;
    position: relative;
  }

  .shell {
    display: flex;
    flex: 1;
    width: 100%;
    position: relative;
    min-height: 0;
  }

  .skel {
    flex-shrink: 0;
    border-right: 1px solid var(--border);
    background: var(--bg-elevated);
    padding: 12px 8px;
    box-sizing: border-box;
  }

  .skel-main {
    flex: 1;
    padding: 20px 24px;
    background: var(--bg-base);
    border-right: none;
  }

  .skel-row,
  .skel-line,
  .skel-block {
    background: var(--bg-hover);
    border-radius: 4px;
    animation: skel-pulse 1.4s ease-in-out infinite;
  }

  .skel-row {
    height: 18px;
    margin: 6px 4px;
  }

  .skel-row.tall {
    height: 28px;
  }

  .skel-line {
    height: 14px;
    width: 60%;
    margin-bottom: 12px;
  }

  .skel-line.wide {
    width: 80%;
    height: 22px;
    margin-bottom: 8px;
  }

  .skel-block {
    height: 240px;
    margin-top: 16px;
  }

  @keyframes skel-pulse {
    0%, 100% { opacity: 0.45; }
    50% { opacity: 0.85; }
  }

  .col-resize {
    width: 5px;
    flex-shrink: 0;
    cursor: col-resize;
    background: transparent;
    transition: background 120ms;
    margin-left: -1px;
    margin-right: -1px;
    position: relative;
    z-index: 2;
  }

  .col-resize:hover,
  :global(.col-resize.dragging) {
    background: var(--border-focus);
  }

  .error-banner {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    background: var(--accent-danger-bg);
    color: var(--accent-danger-text);
    padding: 6px 12px;
    font-size: 0.8rem;
    border-top: 1px solid var(--accent-danger-border);
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .error-text {
    flex: 1;
    min-width: 0;
  }

  .error-close {
    background: transparent;
    border: none;
    color: var(--accent-danger-text);
    cursor: pointer;
    font-size: 1.1rem;
    line-height: 1;
    padding: 0 4px;
    flex-shrink: 0;
  }

  .error-close:hover {
    opacity: 0.7;
  }

  .error-reset {
    background: transparent;
    border: 1px solid var(--accent-danger-border);
    color: var(--accent-danger-text);
    cursor: pointer;
    font-size: 0.75rem;
    line-height: 1.2;
    padding: 3px 8px;
    border-radius: 4px;
    flex-shrink: 0;
  }

  .error-reset:hover {
    opacity: 0.85;
  }

  .undo-toast {
    position: absolute;
    bottom: 12px;
    left: 50%;
    transform: translateX(-50%);
    background: var(--bg-active);
    color: var(--text-strong);
    border: 1px solid var(--border-strong);
    padding: 6px 14px;
    border-radius: 6px;
    font-size: 0.8rem;
    pointer-events: none;
    box-shadow: 0 4px 12px var(--shadow);
    z-index: 200;
  }
</style>
