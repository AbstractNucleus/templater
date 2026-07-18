# Thermo-nuclear code quality review — Templater

**Date:** 2026-07-18  
**Scope:** Entire codebase at `D:/code/Templater` (not a branch diff)  
**Stack:** Tauri 2 + SvelteKit 2 / Svelte 5 + TypeScript frontend; Rust backend (`src-tauri`)  
**Approx. hand-written source:** ~12.7k lines across `src/` + `src-tauri/src/` (excluding `node_modules`, `target`, generated kit output)

---

## Executive summary / verdict

**Do not approve as a healthy long-term architecture.**

The product is coherent and much of the domain logic is thoughtfully written (`compose.ts`, `search.ts`, atomic dual-file saves in `store.rs`, undo stack, careful preview/`untrack` copy semantics). Behavior-correctness is not the bar here. The maintainability bar is: *can a competent engineer change one concern without spelunking a 1.2k-line route, reconciling two write authorities, and re-copying preview UI?*

Today the answer is no. The frontend has accreted into a **god route** (`+page.svelte`) that still owns orchestration after a partial store extraction; persistence is **split-brained** between “mutate in TS then `save_app_data`” and “mutate in Rust then sync arrays back”; and the minimal-mode preview pop-out **reimplements** the main template preview/copy path instead of sharing one component.

This is a strong personal app with solid bones. It is not yet a codebase whose structure makes the next feature cheaper than the last one.

**Approval bar (applied strictly):** structural simplicity, single source of truth for mutations, file sizes under ~1k without excuse, abstractions that delete concepts rather than relocate them. **Fails.**

---

## High-priority / presumptive blockers

### 1. `src/routes/+page.svelte` is a god module (~1,275 lines)

**Problem.** One file owns:

- App bootstrap / load / column widths  
- Browse pipeline (sort → tag filter → search → pinned regroup)  
- Create / edit UI state and create mutation  
- Context menus + bulk confirm dialogs  
- Keyboard wiring (~30 dependency getters)  
- Preview + translator satellite lifecycle, payload emit, event fan-in  
- Minimal-mode window geometry  
- Theme CSS design tokens (~140 lines of `:global` variables)  
- Skeleton UI, error/undo toasts, onboarding

Rough map: script ~858 lines, markup ~250, styles ~290.

**Why it matters.** Every feature lands here or threads props through here. Local architecture worsens with each satellite window, bulk action, or mode flag. Scanning cost is already high; regression risk is higher.

**Remedy (delete complexity, don’t polish).** Split by *concern*, not by “move 50 lines into a helper”:

| Extract | Destination |
|---|---|
| Theme tokens + base chrome CSS | `src/app.css` or `src/routes/+layout.svelte` |
| Browse pipeline (`browseOrdered` / `tagFiltered` / `searchResults` / `canReorder`) | pure `$lib/browse.ts` (or store-derived getters) |
| Satellite window orchestration | `$lib/popouts.svelte.ts` (preview + translator together) |
| Context / bulk UI state | `$lib/components/BulkActions.svelte` or a small UI store |
| Remaining page | shell: compose sidebars + `MainPanel` + modal mounts |

Success criterion: `+page.svelte` under ~400 lines of script, no design tokens, no IPC event spaghetti.

---

### 2. Split-brain persistence: frontend `persist` vs Rust `Store::mutate`

**Problem.** Two authorities write disk:

| Path | Who mutates | Examples |
|---|---|---|
| A | TS store → `save_app_data` full `AppData` | edit, create, pin, reorder, placeholders, copy stats, tag rename/delete |
| B | Rust `store.mutate` → returns templates | `bulk_delete`, `bulk_add/remove_tag`, `import_templates` |

See `templatesStore.persist` (`templatesStore.svelte.ts` ~109–135) vs `commands/data.rs` bulk/import (~105–247). Frontend bulk handlers then assign `this.templates = saved` and sometimes patch settings separately (`bulkDelete` clears placeholders in TS *after* Rust already cleared them on disk — dual cleanup).

**Why it matters.**

- **Races:** a debounced `recordPlaceholderValues` / `recordCopy` (path A) can overwrite a concurrent bulk op (path B), or vice versa, because neither is a single ordered queue.  
- **Duplicated domain rules:** history capping (`pushHistorySnapshot` in TS; mirrored block in `import_templates` with a “Keep in sync” comment on `TEMPLATE_HISTORY_CAP`).  
- **Incomplete migration smell:** `bulkDelete` still computes unused `next = this.templates.filter(...)` (`templatesStore.svelte.ts` ~256) — leftover from path A.

**Remedy (code judo).** Pick **one** write authority:

**Preferred:** all template/settings mutations go through Rust commands that take an intent and return the new `AppData` (or at least both `templates` + relevant settings). Frontend becomes optimistic UI + apply result. History / placeholder cleanup live in one Rust helper.

**Acceptable alternative:** drop bulk/import Rust mutate; do everything via frontend `persist` (Rust stays dumb load/save). Delete `bulk_*` command logic and the “mirrors TS” comments.

Do not leave the hybrid. Hybrid is the expensive middle.

---

### 3. Preview pop-out reimplements `TemplateView` instead of sharing it

**Problem.** `src/routes/preview/+page.svelte` (~367 lines) re-derives:

- `composeText` / `splitPlaceholders` / `extractPlaceholders`  
- Opening/signature toggles  
- Debounced placeholder persist (`PERSIST_DEBOUNCE_MS = 400` duplicated)  
- Copy + flush-on-copy  
- Tag chips + preview `<pre>` rendering  
- Large chunk of theme/`frame` CSS also present on the main page / translator

Meanwhile `TemplateView.svelte` (~495 lines) is the canonical interactive preview.

**Why it matters.** Preview bugs will be fixed in one place and regress in the other. The event bridge (`preview-payload`, `preview-placeholder-change`, `preview-copy-success`) already exists — the missing abstraction is the **view**, not more IPC.

**Remedy.** Extract a presentational `TemplatePreview.svelte` (composed text, toggles, fills, copy button) with callbacks for persist/copy. Mount it from `TemplateView` (plus rename/history chrome) and from `preview/+page.svelte` (plus titlebar / close-on-copy). Delete the duplicated compose/copy/debounce blocks.

---

### 4. Incomplete store extraction leaves mutations and selection glue straddling layers

**Problem.** `templatesStore` absorbed many mutations, but `+page.svelte` still owns:

- `handleCreateDraft` (create lives in the page; duplicate/delete/save live in the store)  
- Tag rename/delete orchestration that **double-handles** filter remapping  
- Context-menu construction (domain actions + UI prompts mixed)

Specifically, `handleRenameTag` / `handleDeleteTag` in the store take `selectedTagIds` / `excludedTagIds`, mutate and return remapped sets — then `+page.svelte` **ignores the return** and calls `selectionStore.remapTag` / `removeTag` anyway:

```445:461:src/routes/+page.svelte
  async function handleRenameTag(from: string, to: string): Promise<void> {
    await templatesStore.handleRenameTag(
      from,
      to,
      selectionStore.selectedTagIds,
      selectionStore.excludedTagIds,
    );
    selectionStore.remapTag(from, to);
  }
```

The filter-set parameters and return type in the store are dead API surface. Selection concerns leaked into the data store “just in case,” then were reimplemented in the selection store.

**Why it matters.** Wrong layer + fake coupling. Next rename of filters will break one path.

**Remedy.** Store methods mutate templates/settings only. Page (or a thin coordinator) calls `selectionStore.remapTag` after success. Delete the filter params/returns from the store. Move `createTemplate(draft)` into the store next to `handleSave` / `duplicateTemplateById`.

---

## Code-judo opportunities (concrete reframes)

### A. Collapse satellite window parking into one Rust helper

`open_preview_window` and `open_translator_window` in `src-tauri/src/lib.rs` (~52–148) are the same algorithm with different axis, size, and label. Same for close/is_open.

**Reframe:** `fn park_satellite(app, label, Placement::LeftOfMain | Placement::AboveMain { height })`. Delete the duplicated clamp / always-on-top / show / focus blocks. Frontend `togglePreview` / `toggleTranslator` can share a small `togglePopout({ open, close, emitPayload })` as well.

### B. Finish the “lift keyboard out of the page” job by shrinking the dep surface

`keyboard.ts` explicitly admits it is a **verbatim lift** that preserves every branch (`createGlobalKeydownHandler` docs). That relocated spaghetti; it did not delete concepts. `GlobalKeydownDeps` has ~20 getters — a smell that the page still owns too many modal flags.

**Reframe:** one `uiStore` / `dialogStack` (`settings | cheatSheet | bulkDelete | bulkTag | contextDelete | …`) so the handler asks `dialogStack.blocksShortcuts()` once. Preview/translator toggles become two actions on a popout module. Goal: deps object with ≤8 fields, or none (import stores directly).

### C. Browse pipeline as pure functions

`browseOrdered` + `tagFiltered` + pinned regroup of search hits (~195–253 in `+page.svelte`) are pure and testable. They do not belong in a route.

**Reframe:** `$lib/browse.ts` with `sortTemplates(templates, sortMode)`, `filterByTags(...)`, `groupPinnedHits(hits)`. Unit-test sort modes (`never_used`, etc.) without mounting the app.

### D. One capability gate instead of sprinkled `isEditorMode`

Editor/user mode is checked in the store (every mutation), the page (create, context menu, canReorder), settings sections, keyboard (undo), and import. That is a cross-cutting boolean tax.

**Reframe:** store mutations are the only enforcer; UI receives `canEdit` and does not re-check. Or invert: User mode mounts a read-only shell that literally lacks edit callbacks. Prefer deleting branches over adding more guards.

### E. Deduplicate shared types

`PortResult` is defined in `templatesStore.svelte.ts`, `SettingsModal.svelte`, and `ImportExportSection.svelte`. `UpdateInfo` is defined in `api.ts`, `SettingsModal.svelte`, and `UpdatesSection.svelte`.

**Reframe:** export once from `$lib/api.ts` (or `$lib/types.ts`). Delete local copies. Thin wrappers that only rename the same shape are not earning their keep.

### F. Theme tokens leave the route

~140 lines of CSS variables live inside `+page.svelte` styles, while `preview/+page.svelte` and `translator/+page.svelte` redeclare overlapping chrome. Wrong layer.

**Reframe:** single `app.css` imported from layout. Pop-outs only set `data-theme`.

---

## File-size / decomposition findings

| Lines (approx.) | Path | Verdict |
|---:|---|---|
| 1662 | `src/lib/mocks.ts` | Generated seed data (`scripts/csv-to-mocks.ts`). Size is expected; keep out of hand-edit paths. Not a design smell. |
| **1275** | **`src/routes/+page.svelte`** | **Past healthy size. Presumptive decompose.** |
| 529 | `src/lib/components/SettingsModal.svelte` | Approaching heavy. Hotkey capture + Escape drain + tab chrome could move; sections already split — good. |
| 495 | `src/lib/components/TemplateView.svelte` | High but cohesive if preview share-extract lands; otherwise will keep growing. |
| 488 | `src-tauri/src/store.rs` | Acceptable for persistence + backups; watch if more formats land. |
| 483 | `src/lib/stores/templatesStore.svelte.ts` | Borderline; would shrink if write path unifies and create moves in cleanly. |
| 477 | `src/lib/components/TemplatesSidebar.svelte` | Folder DnD + grouping make it busy; candidate to split `FolderGroup` / bulk bar. |
| 367 | `src/routes/preview/+page.svelte` | Should shrink dramatically after TemplatePreview extract. |
| 338 | `src-tauri/src/lib.rs` | Satellite parking + tray/hotkey setup; extract `windows.rs` / `satellites.rs`. |
| 331 | `src/routes/translator/+page.svelte` | Self-contained; lower urgency. |

**Rule reminder:** do not let application modules drift past ~1000 lines without a strong reason. `+page.svelte` has already crossed that line; treat further growth as a regression.

---

## Boundary / type / layering issues

### Soft enums on the Rust settings boundary

TS has `Theme`, `Mode`, `SortMode` unions (`types.ts`). Rust `Settings` stores `theme`, `mode`, `sort_mode` as `String` (`store.rs` ~105–116). Invalid values deserialize and become runtime UI oddities rather than load errors.

**Remedy.** `#[serde(rename_all = "snake_case")] enum` (or stringly enums with `#[serde(other)]` fallback to default). Mirror TS unions. One contract.

### History cap / snapshot logic duplicated across the FFI boundary

`TEMPLATE_HISTORY_CAP = 10` in TS; mirrored const + push/drain in Rust import (`data.rs` ~35–36, ~207–218). Comment says “Keep in sync” — that is an admission of a missing single owner.

**Remedy.** History mutations only on the chosen write authority (see blocker #2). The other side becomes a dumb serializer.

### `api.ts` is a thin invoke façade (mostly fine) with mid-file import clustering

Imports for updater/process sit halfway through the file (`api.ts` ~53–55). Harmless but sloppy; group imports at top. The façade itself is appropriate for Tauri — do not invent a second “service layer” on top unless it adds batching/queuing for the unified write path.

### Casts / optionality

No widespread `any` plague in app code (good). Notable smells:

- `omitKey` uses `as Record<string, unknown>` / `as T` (`templatesStore.svelte.ts` ~33–36) — replace with typed delete on `placeholder_values`.  
- `devMocks.ts` uses `as Record` / `as AppData` liberally — acceptable for a mock switchboard; keep it isolated.  
- Repeated `as HTMLElement` for focus probes — extract one `isTextInput(el)` helper used by `+page`, preview, and keyboard.

### Non-atomic / sequential orchestration

- Startup effect wraps a single `getAppVersion` in `Promise.all([…])` (`+page.svelte` ~307–309) — noise; call directly.  
- Pop-out open: `openPreviewWindow()` then separately `emit("preview-payload", …)` — fine given architecture, but after a shared popout module, open+push should be one function.  
- `bulkDelete` updates templates from Rust then settings placeholders in a second assignment — should be one `AppData` apply if Rust returns full data (placeholders already cleared server-side).

### Feature logic in shared / wrong places

- Design tokens in the main route (should be global).  
- Selection filter remapping attempted inside templates store (should stay in selection store).  
- Context menu item construction embeds export/delete/pin policy in the page instead of a pure `buildTemplateMenu(ctx)` next to `contextMenu.ts` (which already handles the global empty-area menu).

---

## Secondary maintainability findings

1. **MainPanel is a thin mode switch with a huge callback surface** (`MainPanel.svelte`). Three call sites in `+page` pass noop handlers (`onSave={() => {}}`, `onEnterEdit={() => {}}`) depending on create/edit/browse. Prefer a discriminated prop (`mode: { kind: "browse", … } | { kind: "edit", … } | { kind: "create", … }`) so impossible callback combinations disappear.

2. **Identity wrappers on the page** (`handleTagToggle` → `selectionStore.toggleTag`, etc.). Delete; pass store methods or one-liners at the binding site.

3. **Dual delete confirmation paths** — `TemplateView` has its own `ConfirmDialog`; context menu delete uses another on the page. Same UX, two state machines. Consolidate on one confirm host.

4. **`SettingsModal` Escape/capture state machine** is dense (~capture main vs preview, tag rename, two-step tag delete). Already partially sectioned; keep pressure on moving capture into `HotkeySection` fully so the modal is only a tab shell.

5. **Good patterns to preserve:** `compose.ts` as single clipboard/preview source of truth; `Store::save` staging both temps before rename; `untrack` on copyTrigger; selection store separation; settings sections under `components/settings/`; vitest coverage on compose/search.

6. **`mocks.ts` size** is not a quality failure — treat as data, not as a “god file” to decompose into modules.

---

## Recommended remediation order

1. **Extract theme CSS + browse pipeline** from `+page.svelte` (low risk, immediate scanability win).  
2. **Unify write authority** (blocker #2) — pick Rust-intent commands *or* TS-only `persist`; delete the other path’s mutation logic and unused leftovers (`next` in `bulkDelete`, mirrored history).  
3. **Extract `TemplatePreview` and delete preview-route duplication** (blocker #3).  
4. **Extract popout module (TS) + satellite helper (Rust)**; shrink `lib.rs` and page event `$effect`s.  
5. **Finish store/selection boundary cleanup** — create in store; kill filter params on tag rename; move context-menu builders beside `contextMenu.ts`.  
6. **Shrink keyboard deps via dialog/popout stores**; delete identity wrappers and MainPanel noop callback matrix.  
7. **Harden Rust settings enums** to match TS unions.

Do not start with micro-nits (import order, comment tone, emoji in sort labels). Those do not move the approval bar.

---

## Closing

Templater’s domain core is better than its shell. The shell — especially `+page.svelte` and the dual write path — is where complexity compounds. The highest-leverage moves all **delete concepts**: one writer, one preview component, one place for theme tokens, one browse pipeline module. Restructuring that preserves behavior while cutting those layers is the correct ambition; rearranging helpers without removing authorities would be a missed opportunity.
