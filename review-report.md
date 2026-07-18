# Thermo-nuclear code quality review — Templater (branch changes)

## Remediation progress (iteration 2 — uncommitted on `dev`)

**Provisional verdict:** **Approve** against the thermo-nuclear remediation bar for this branch. God-route script budget cleared; write-authority leftovers for restore/export closed; geometry RMW documented as the sole intentional Rust full-save exception.

### Fixed this iteration

| Item | Result |
|---|---|
| Create/edit session on page | `editorSession.svelte.ts` owns draft/editing flags + save/create/duplicate/delete |
| Minimal-mode geometry | `minimalGeometry.ts` — page only calls `applyMinimalGeometry` |
| Bootstrap load | `appBootstrap.ts` — version + load + selection + column widths |
| Shared `isInputFocused` | `domFocus.ts`; keyboard imports directly (dep removed); preview uses shared util |
| Backup restore write authority | Rust `read_template_backup` (read-only); TS `persist` (mirrors import) |
| Export from memory | Single `export_templates(path, templates)`; dropped disk-reload + subset/single commands |
| Geometry RMW | Documented as intentional close-time Rust exception; no half-rewrite |
| `hide_main_window` | Uses `close_satellite` / `is_satellite_open` (translator restore flag preserved) |

**`+page.svelte` size:** 710 → **588** lines; script **415 → ~293** (under ~350–400 target).

**Verify:** `npm test` (61 pass), `npm run check` (0 errors), `cargo check` (ok).

### Remains (non-blocking / polish)

1. **Geometry RMW** — still Rust full-`AppData` save on hide/close; documented; product-constrained.
2. **Settings enum soft-deserializers** — ~50 lines ceremony; not simplified this pass.
3. **`popouts` → `templatesStore.loadError`** — error channel conflation unchanged.
4. **Browse/column-resize still on page** — acceptable once script is under budget; further extracts optional.

### Iteration 1 (prior)

Preview theme tokens, dual payload types, `popouts.startLifecycle`, `TemplateEditPanel` kind discriminant, `DialogsHost`, dead `chrono`, stale preview doc. Page was 710 / script 415 after iter 1.

---

## Remediation progress (iteration 1 — uncommitted on `dev`) — superseded by iter 2 above

**Provisional verdict (iter 1):** Closer, still **do not approve**. Ownership moves landed; god-route and write-authority leftovers remain.

### Fixed iteration 1

| Item | Result |
|---|---|
| Preview theme token duplication | Deleted `:root` / `[data-theme]` from `preview/+page.svelte`; chrome only; tokens from `app.css` |
| Dual payload types | Satellites import `PreviewPayload` / `TranslatorPayload` from `popouts.svelte.ts` |
| Popouts babysitter effects | `popouts.startLifecycle()` owns push + `mountListeners` + sync + minimal-off close; page mounts once; `toggle*` need no payload getters |
| MainPanel noop adapters | `TemplateEditPanel` takes `kind: "create" \| "edit"`; noops gone |
| Dialog ownership | `DialogsHost.svelte` mounts settings/cheat/confirms/context menu; `uiDialogs` owns open/confirm handlers |
| Dead `chrono` | Removed from `Cargo.toml` |
| Stale `open_preview_window` doc | Corrected to match `park_satellite` behavior |

**`+page.svelte` size (iter 1):** 1000 → **710** lines; script **606 → 415**.

---

**Date:** 2026-07-18  
**Scope:** Branch `dev` vs `main` (not a full-codebase re-audit)  
**Commit range:** `main...HEAD` — 3 remediation commits

| Commit | Summary |
|---|---|
| `0dfc0a5` | Session 1 — theme / browse / TemplatePreview / satellite parking / types |
| `7ff22e5` | Session 2 — TS-only persist; drop Rust bulk/import mutate |
| `0fbc451` | Session 3 — popouts + dialog stores; settings enums; MainPanel modes |

**Diff size:** 24 files, +1674 / −1516 (includes this report file in the tree history; current working tree is clean).  
**Prior context:** Older full-codebase audit lived in this file; that audit’s blockers drove these sessions. This review judges the **post-remediation branch state** and whether the diffs **deleted** complexity or **rearranged** it.

---

## Executive summary / verdict

**Do not approve** against the thermo-nuclear bar.

The sessions landed real deletions in the right places: one write authority for template CRUD/bulk/import, one shared preview body, one Rust satellite parking helper, a tested browse pipeline, and a thinner keyboard dep surface. Those are not cosmetic.

They did **not** finish the structural job. `+page.svelte` is still a ~1000-line / ~605-script-line control plane. Session 3 extracted **state bags** (`uiDialogs`, `popouts`) without moving ownership of handlers, dialog markup, create/edit session, or popout lifecycle effects. MainPanel’s new mode union is papered over with noop callbacks into an unchanged `TemplateEditPanel`. Theme centralization claims “pop-outs only set `data-theme`” while `preview/+page.svelte` still embeds the full token set. Residual Rust full-`AppData` RMW (geometry + backup restore) and disk-authoritative export keep a softer split-brain alive after the bulk/import hybrid was correctly killed.

**Approval bar applied:** no clear structural regression · no obvious missed dramatic simplification · no unjustified 1k file explosion · no spaghetti growth · no half-finished adapters that add indirection without deleting concepts. **Fails** on unfinished god-route extraction, incomplete theme/payload consolidation, and adapter noops — not because the product is broken.

---

## High-priority / presumptive blockers

### 1. God route reduced, not solved — still the app’s control plane

**Evidence.** `src/routes/+page.svelte`: **1275 → 1000 lines** (~605 script through `</script>`). Still owns:

- Create/edit session flags (`creatingDraft`, `editing`) — lines 60–61, 153, 320–340, 643+
- Context-menu construction + bulk confirm orchestration — 370–486
- ConfirmDialog / settings / cheat-sheet markup mounts — ~787–855
- Four popout `$effect`s after a `popouts` store exists — 531–604
- Minimal-mode window geometry — 561–599
- Column resize, zoom, bootstrap load, browse wiring

**Why it blocks.** Session 1–3 moved *pieces* out (theme CSS, browse pure fns, preview body, popout IPC helpers, dialog *flags*). The route still composes every concern. Scanning cost and regression surface did not drop enough to clear the prior audit’s bar (“under ~400 lines of script, no IPC spaghetti”).

**Code judo.** Finish ownership moves, don’t add more flag stores:

| Concern | Destination |
|---|---|
| Context menu + ConfirmDialog cluster | One `DialogsHost` (or delete `uiDialogs` and keep flags local to that host) |
| Create/edit session | Thin `editorSession` or push discriminant into `TemplateEditPanel` |
| Popout push + `mountListeners` | Self-mount / auto-push inside `popouts.svelte.ts` so the page drops 3–4 effects |
| Minimal geometry | Dedicated helper module; page only passes widths |

Success: `+page.svelte` script under ~350–400 lines, shell markup only.

---

### 2. Half-done adapters: typed surface over untyped guts

**A. `MainPanel` mode union + noop stubs**

```51:74:src/lib/components/MainPanel.svelte
  {#if mode.kind === "create"}
    <TemplateEditPanel
      ...
      onSave={() => {}}
      onCreate={mode.onCreate}
    />
  {:else if mode.kind === "edit"}
    <TemplateEditPanel
      ...
      onSave={mode.onSave}
      onCreate={() => {}}
    />
```

`TemplateEditPanel` still takes `creatingDraft | editing | template` (see its props ~15–35). The discriminant stopped one layer too early. Call sites look cleaner; the form API did not simplify. Either push `kind: "create" | "edit"` into `TemplateEditPanel`, or stop pretending MainPanel is a domain boundary.

**B. `uiDialogs.svelte.ts` is a flag hotel (25 lines)**

Booleans + `blocksShortcuts` — useful for keyboard. Handlers, `bulkTagDraft`, context-menu item builders, and ConfirmDialog markup remain on the page. Thin wrapper that relocated state without deleting orchestration. Prefer one host that owns flags *and* behavior, or delete the store and keep flags next to the dialogs.

**C. `popouts` still needs a page babysitter**

`mountListeners` / `pushPreview` / `pushTranslator` are clean, but `+page.svelte` 531–553 still runs reactive push effects and wires payload getters. Dual payload paths: page `previewPayload()` with explicit `selectedTemplate` vs keyboard’s `buildPreviewPayload(isEditorMode)` from stores (`keyboard.ts` 107–109, 123–125). Complexity moved into a class; lifecycle stayed in the route.

---

### 3. Theme extraction lied for preview — duplication remains

`src/app.css` line 1: *“Pop-out routes only set data-theme.”*  
`+layout.svelte` imports `app.css` for all routes.

Translator correctly dropped token CSS. Preview did not:

```151:211:src/routes/preview/+page.svelte
  :global(:root) {
    --bg-base: #1c1c1e;
    ...
  }
  :global([data-theme="light"]) {
    --bg-base: #f7f5f1;
    ...
  }
```

~60 lines of duplicated design tokens. Delete the block; keep chrome (`.frame` / `.titlebar`) only. Incomplete Session 1 cleanup — translator proves the judo works.

**Related:** payload types redeclared locally in satellites (`preview/+page.svelte` 10–18, `translator/+page.svelte`) instead of importing `PreviewPayload` / `TranslatorPayload` from `popouts.svelte.ts`. Drift risk (`theme: "dark" | "light"` vs store `Theme`).

---

### 4. Write authority: bulk/import fixed; residual split-brain remains

**Fixed (real deletion).** Rust `bulk_*` / `import_templates` / `Store::mutate` / mirrored history cap gone. TS `persist` owns CRUD, bulk tag/delete, import merge (`templatesStore.svelte.ts` 276–316, 486–541). `data.rs` is correctly documented as file I/O + OS shims.

**Still split:**

| Path | Where | Smell |
|---|---|---|
| `restore_template_backup` | Rust writes disk; TS mirrors (`templatesStore` 429–434) | Same shape as old Path B |
| `save_window_geometry` / `reset_window_position` | Rust load → patch → full `AppData` save (`lib.rs` 37–40, 180–205) | Races concurrent `persist` |
| Export commands | `data.rs` 49–88 `store.load()` then write | Memory can diverge from disk after failed save; export ships disk |

Geometry RMW is a harder product constraint (close-time save from Rust). Backup restore should follow import: read backup → TS `persist`. Export should take templates from the caller if TS is write authority.

Not as severe as the old dual-mutate hybrid — but claiming “TS-only writes” without finishing restore/export is incomplete narrative.

---

## What improved vs pre-refactor (credit)

These are real wins — complexity deleted, not just relocated:

1. **Split-brain for template domain ops — fixed.** Bulk/import mutate deleted from Rust; one history cap in TS; API surface matches (`api.ts` read-only import parse).
2. **Preview body fork — fixed.** Shared `TemplatePreview.svelte`; `TemplateView` 495→348; preview route is chrome + event bridge.
3. **Satellite parking — fixed.** `park_satellite` / `Placement` / `close_satellite` / `is_satellite_open` (`lib.rs` 47–115). Duplicated clamp/show/AOT bodies gone.
4. **Browse pipeline — extracted and tested.** Pure `browse.ts` + `browse.test.ts`; route only wires deriveds.
5. **Keyboard deps — thinned.** ~25 getters → ~11; dialogs/popouts/undo read stores directly (`keyboard.ts` 7–19, 48–52).
6. **Dead filter API on store — gone.** Tag rename/delete no longer take/return selection sets; page calls `selectionStore.remapTag` / `removeTag` after success (360–368).
7. **Theme tokens on main route — mostly gone.** `app.css` + layout; translator cleaned.

Net: the two correctness/duplication killers from the old audit (persist split-brain, preview body fork) are addressed. God-route and satellite polish are partial.

---

## Remaining code-judo / structural issues in the new code

Prioritized per skill (structural → judo → spaghetti → boundaries → size → modularity → legibility).

### Missed dramatic simplifications

1. **Finish dialog ownership** — either `DialogsHost` owns flags+handlers+markup, or delete `uiDialogs` as a premature extract.
2. **Push create|edit into `TemplateEditPanel`** — kill MainPanel noops.
3. **Popouts self-lifecycle** — auto-push from store `$effect`s / self-`mountListeners` so `+page` drops babysitter effects; one payload builder (drop dual selected-vs-store paths).
4. **Delete preview token CSS + import payload types** — obvious, low-risk, Session 1 incomplete.
5. **Restore via TS persist** — mirror import; delete Rust domain write on backup restore.
6. **Export from memory** — pass templates into export commands (or write export JSON in TS after dialog path pick).

### Spaghetti / branching

- Context-menu builders in the page (370–426) remain a busy special-case cluster; bulk vs single is fine domain logic but still lives in the wrong file.
- `hide_main_window` (`lib.rs` 230–247) still inlines satellite hide instead of `close_satellite` + shared emit policy (translator restore special case is intentional; structure still half-extracted).
- Stale doc: `open_preview_window` claims “already visible → no-op” (`lib.rs` 117–119); `park_satellite` always repositions/shows. Frontend gates in `popouts.togglePreview`.

### Boundary / type / abstraction

- Rust `Theme` / `Mode` / `SortMode` + three hand-rolled soft deserializers (`store.rs` 93–143, 157–168) replace `String` + default fns with ~50 lines of ceremony without deleting a concept. Soft-fail unknown→default is fine; derived `Deserialize` on the enums is unused for `Settings` (custom `deserialize_with` wins). Prefer one soft-parse helper or keep strings — not both.
- `popouts` writes open failures into `templatesStore.loadError` (77, 96) — error channel conflation.
- `isInputFocused` duplicated (`+page.svelte` 84–91, `preview/+page.svelte` 76–83); keyboard still takes it as a dep instead of a shared util.

### New smells introduced by the refactor

1. Adapter noops in MainPanel.
2. `uiDialogs` without behavior.
3. Incomplete theme centralization (comment vs preview reality).
4. Dual `PreviewPayload` constructors (page-selected vs store-selected).
5. Dead `chrono` dep in `src-tauri/Cargo.toml` after import’s `Utc::now()` left Rust — incomplete Session 2 cleanup.
6. Settings enum “hardening” as type theater at the JSON boundary.

### What is *not* a blocker

- `templatesStore` growing ~491→512: expected; import merge belongs there.
- Thin Tauri command wrappers around `park_satellite`: fine IPC surface.
- Browse composition remaining in the page: acceptable once pure fns are extracted.
- Tag chips owned by `TemplateView` with `showTags={false}` on shared preview: minor dual ownership, not a structural regression.

---

## File-size notes (hot files after refactor)

| File | main → HEAD | Assessment |
|---:|---:|---|
| `src/routes/+page.svelte` | 1275 → **1000** (~605 script) | Still over healthy route size; under 1k by a hair — not a waiver |
| `src/lib/stores/templatesStore.svelte.ts` | 491 → **512** | Acceptable growth (domain moved in) |
| `src/lib/components/TemplateView.svelte` | 495 → **348** | Real shrink via TemplatePreview |
| `src/routes/preview/+page.svelte` | 367 → **241** | Body fixed; theme CSS leftover |
| `src-tauri/src/commands/data.rs` | 257 → **123** | Real deletion |
| `src-tauri/src/lib.rs` | 336 → **329** | Satellite judo; geometry/hide still dense |
| `src/lib/keyboard.ts` | 212 → **192** | Dep surface is the win |
| `src/lib/browse.ts` + test | new 86 + 140 | Worth it |
| `TemplatePreview.svelte` | new ~240 | Justified shared core |
| `popouts.svelte.ts` | new ~158 | Justified if page effects shrink further |
| `uiDialogs.svelte.ts` | new 25 | Marginal until paired with a host |
| `app.css` + `+layout.svelte` | new | Good; incomplete adoption in preview |
| `MainPanel.svelte` | ~flat ~158 | Rearranged API, same job |

No file was pushed *across* the 1k line bar by this PR (the route was already over). The route remains the size smell.

---

## Recommended next remediation order

If not approving cleanly, do this sequence — each step should **delete** concepts:

1. **Quick wins (Session 1 leftovers)**  
   Delete preview `:root` / light tokens; import payload types from `popouts`; drop dead `chrono`; fix stale `open_preview_window` docstring; shared `isInputFocused`.

2. **Finish create/edit boundary**  
   Discriminant into `TemplateEditPanel`; remove MainPanel noops.

3. **Dialogs ownership**  
   Extract `DialogsHost` (context menu + confirms + settings/cheat flags) *or* delete `uiDialogs` and keep flags colocated. Goal: page no longer builds menu items or mounts ConfirmDialogs.

4. **Popouts self-lifecycle**  
   Move push effects + listener mount into `popouts`; single payload builder; page only toggles and reads open flags.

5. **Write-authority leftovers**  
   Backup restore → read + TS `persist`; export from caller memory; document or isolate geometry RMW as the only intentional Rust full-save path.

6. **Only then** chase further `+page` shrink (minimal geometry helper, load bootstrap). Re-measure: script under ~400 lines before calling the god-route closed.

Do **not** add another thin store layer without moving the handlers. The pattern that failed in Session 3 was “extract `$state` bags, leave orchestration in the route.”

---

## Explicit verdict

| Criterion | Result |
|---|---|
| Structural regression | No major regression; incomplete extraction leaves god-route intact |
| Missed dramatic simplification | **Yes** — dialogs/popouts/edit panel/theme leftovers |
| Unjustified 1k explosion | No new crossing; route still ~1k |
| Spaghetti growth | Mostly relocation; some half-adapters add indirection |
| Hacky / magical abstractions | MainPanel noops, uiDialogs flag hotel, enum ceremony |
| Boundary / dual write | Bulk/import fixed; restore/geometry/export residual |
| Obvious decomposition remaining | **Yes** |

**Do not approve.** Merge pressure is a product call; the maintainability bar for these remediation sessions is not met until the god-route ownership moves and the incomplete Session 1/2 cleanups land. Behavior looks coherent. Structure still trains the next feature to land in `+page.svelte`.
