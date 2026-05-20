<script lang="ts">
  import { getCurrentWindow } from "@tauri-apps/api/window";

  type Edge =
    | "North"
    | "South"
    | "East"
    | "West"
    | "NorthEast"
    | "NorthWest"
    | "SouthEast"
    | "SouthWest";

  function startResize(edge: Edge): (e: PointerEvent) => void {
    return (e) => {
      e.preventDefault();
      void getCurrentWindow().startResizeDragging(edge);
    };
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="handle n" onpointerdown={startResize("North")}></div>
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="handle s" onpointerdown={startResize("South")}></div>
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="handle e" onpointerdown={startResize("East")}></div>
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="handle w" onpointerdown={startResize("West")}></div>
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="handle ne" onpointerdown={startResize("NorthEast")}></div>
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="handle nw" onpointerdown={startResize("NorthWest")}></div>
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="handle se" onpointerdown={startResize("SouthEast")}></div>
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="handle sw" onpointerdown={startResize("SouthWest")}></div>

<style>
  .handle {
    position: fixed;
    z-index: 1000;
    /* background: rgba(255, 0, 0, 0.3); */ /* uncomment to debug */
  }

  /* edges: 6px thick, full span minus corners */
  .n { top: 0; left: 12px; right: 12px; height: 6px; cursor: n-resize; }
  .s { bottom: 0; left: 12px; right: 12px; height: 6px; cursor: s-resize; }
  .e { top: 12px; bottom: 12px; right: 0; width: 6px; cursor: e-resize; }
  .w { top: 12px; bottom: 12px; left: 0; width: 6px; cursor: w-resize; }

  /* corners: 12px squares */
  .nw { top: 0; left: 0; width: 12px; height: 12px; cursor: nw-resize; }
  .ne { top: 0; right: 0; width: 12px; height: 12px; cursor: ne-resize; }
  .sw { bottom: 0; left: 0; width: 12px; height: 12px; cursor: sw-resize; }
  .se { bottom: 0; right: 0; width: 12px; height: 12px; cursor: se-resize; }
</style>
