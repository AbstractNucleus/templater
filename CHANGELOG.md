# Changelog

All notable changes to Templater are documented here. Format loosely
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versions follow [SemVer](https://semver.org/spec/v2.0.0.html).

## [0.8.0] — 2026-07-09

### Added

- **Keyboard navigation in the tag/folder pickers.** ↑/↓ move a
  highlight through the dropdown (mouse hover syncs it), Enter picks
  the highlighted entry — previously Enter always took the first
  candidate, leaving later options unreachable without the mouse. The
  picker exposes proper combobox/listbox ARIA.
- **"Clear search & filters" action** on the templates sidebar's
  "No matches" empty state.
- **Skeleton rows while Claude ranks paste-match results**, replacing
  the bare "…" placeholder, plus a "Ranking with Claude…" status line.
- **Progress bar for update downloads** (determinate with a known
  size, indeterminate sweep otherwise) alongside the existing byte
  counter.
- **Global keyboard-focus ring.** Every control without a custom focus
  style gets a consistent 2 px brand `:focus-visible` outline; all
  animations and transitions are disabled under
  `prefers-reduced-motion`.
- **Listbox semantics for the template lists** (`role="listbox"` /
  `role="option"`, `aria-selected`) and aria-labels on placeholder
  fill-in inputs.
- **Browser dev harness.** `npm run dev` + a plain browser now runs
  the complete UI against a dev-only Tauri IPC mock
  (`src/lib/devMocks.ts`): seeded catalog, fake ranking/edit streams,
  context corpus, dialogs, updater. `?fresh=1` simulates a first run.
  Guarded by `import.meta.env.DEV` — never ships in builds.

### Changed

- **One primary-action color.** Save, Send, Capture, Add source, and
  the onboarding Next button now use the brand accent (white text,
  weight 600); the positive green is reserved for success feedback
  like the "Copied" flash. The Copy button is a shared component
  (`CopyButton.svelte`) so browse and editor modes render the exact
  same affordance — the editor's copy gains the success animation and
  a disabled state when the composed text is empty.
- **One input-focus treatment.** Every text input, textarea, select,
  and the picker chips-row shares the brand border + soft glow that
  the title-bar search already had.
- **Settings dialog:** tabs expose real tab ARIA, the active tab gets
  a 3 px brand accent bar, the dialog animates in, traps Tab, and
  restores focus on close.
- **Smaller polish:** capture popover gets a dimmed backdrop and
  pop-in; onboarding steps fade between cards and its card animates
  in; agent chat roles read "You"/"Claude" (was raw "user"/
  "assistant") with animated thinking dots; tag counts slide aside on
  hover instead of vanishing under the exclude button; tag rows carry
  a click/right-click/drag tooltip; cheat-sheet key chips wrap instead
  of overflowing; bulk bar and adapt-error banners ease in; checkboxes
  use the brand accent; editor breadcrumbs match across AI and non-AI
  modes; the webview title is "Templater" (was Tauri boilerplate).

### Fixed

- **ConfirmDialog Enter handling.** Enter no longer fires the confirm
  action when the confirm button is disabled (e.g. empty bulk-tag
  input) or when Cancel has focus; danger dialogs autofocus Cancel
  instead of the destructive button; Tab is trapped inside the dialog
  and focus returns to whatever opened it.
- **Escape during hotkey capture** in Settings cancelled the capture
  *and* closed the whole modal; it now only cancels the capture.
- **TemplateView's hand-rolled delete modal** (duplicated markup, own
  z-index, window-level key handling) replaced with the shared
  `ConfirmDialog`.
- **Context pane no longer flashes "No matching files"** before the
  first file listing arrives.

## [0.7.0] — 2026-07-09

### Added

- **AI features master toggle.** New **Settings → General → "AI
  features"** switch, **off by default**. While off, no AI surface
  renders: paste-match ranking (long pastes stay a literal search — no
  AI chip, no ranked list, no "Adapt to inbound"), the agent chat
  sidebar in create/edit modes, the title-bar memory-capture and
  context-pane buttons, the Ctrl+Shift+M capture chord, the Settings
  **AI** and **Context** tabs, and the sidecar Diagnostics section
  under About. The Node sidecar is never woken while the toggle is off.
  Stored as `ai_enabled` in settings.json (`serde(default)`, so
  existing files load cleanly).

### Changed

- **AI is now opt-in for everyone, including existing installs.** The
  new flag defaults to off, so AI features are hidden after updating
  until re-enabled in Settings → General.
- Manual template creation and editing work unchanged with AI off; the
  editor pane and "Base on template" flow lose their AI branding
  ("agent editor" → "editor").
- The onboarding tour and shortcut cheat sheet drop their AI steps and
  sections while the toggle is off.

## [0.6.0] — 2026-05-28

### Changed

- **Settings dialog reworked.** Switched from a 480-px vertical-scroll
  modal with a top tab strip to a 780×620 dialog with a left rail of
  sections and a single right-hand content pane. New IA: **General**
  (mode, appearance, window) · **Shortcuts** · **AI** (paste-match
  backend) · **Snippets** (signature + global snippets) · **Context** ·
  **Templates** (import/export, tags, backups) · **About** (version,
  updates, diagnostics). The previous tab structure split General
  content across two render blocks; that's gone.
- **Active segmented toggles now use the brand orange.** Editor/User,
  Dark/Light, and Agent SDK / Anthropic API selectors moved from the
  `--accent-positive` green to a pill-grouped `.seg-toggle` with a
  brand-color inset ring so selection reads as identity, not status.
- **Hotkey display now renders real keycaps.** The accelerator string
  is split on `+` and each modifier and key renders as a `<kbd>` with a
  vertical gradient, top-inset highlight, and 1 px bottom shadow ledge.
  Symbol codes get friendly labels (`Backslash` → `\`, `ArrowUp` → `↑`,
  etc).

### Removed

- **Dead settings wrapper components.** `SettingsGeneral.svelte`,
  `SettingsContext.svelte`, `SettingsTemplates.svelte`,
  `SettingsDiagnostics.svelte`, and `SettingsUpdates.svelte` were
  `{@render children()}` passthroughs left over from a prior refactor;
  they've been deleted.

### Internal

- **Consolidated duplicated section CSS.** `.section-label`, `.hint`,
  `.port-btn`, `.port-row`, `.port-message`, `.capture-error`, `code`,
  and `section` rules used to be re-declared in each
  `settings/*Section.svelte` file (~80 lines per component). They now
  live once as `:global(.pane-body …)` rules in `SettingsModal.svelte`
  and the child components only carry their section-specific styles.

## [0.5.2] — 2026-05-27

### Added

- **"Overwrite duplicates" toggle on template import.** Off by default
  (existing behavior: matching ids are skipped). Toggled on, matching
  templates have their `name` / `tags` / `folder` / `opening` / `body`
  replaced by the import file's version; `pinned` / `copy_count` /
  `last_used_at` / `created_at` stay local; the pre-overwrite content is
  prepended onto the template's `history` (cap 10) so the existing
  Revert UI is the undo. Templates not present in the import file are
  always untouched
  ([PR #23](https://github.com/AbstractNucleus/templater/pull/23)).

### Fixed

- **Capture memory crashed with `The "path" argument must be of type
  string. Received null`.** The popover passed `filename = undefined`,
  which `api.ts` coerced to `null`, which the Rust command re-serialized
  to JSON `null`, which the sidecar's `captureMemory` received as
  `null` — and JS default-parameter values only fire on `undefined`, so
  `filename = "memories.md"` never engaged and `path.join(root, null)`
  threw. Coalesced explicitly at the function entry
  ([PR #24](https://github.com/AbstractNucleus/templater/pull/24)).

## [0.5.1] — 2026-05-27

### Added

- **Created/updated timestamps in the template detail header.**
  Surfaces the existing `created_at` / `updated_at` fields as a muted
  metadata line under the title, using the same `toLocaleString()`
  formatter as the history panel. Visible in both editor and user modes
  ([PR #20](https://github.com/AbstractNucleus/templater/pull/20)).

### Changed

- **Unified new-template form.** New templates now open the same full
  inline form as edit, so folder, opening, body, and tags are settable
  at create time. Folder becomes an autocomplete picker over existing
  folders; Name / Tags / Folder share one row
  ([PR #19](https://github.com/AbstractNucleus/templater/pull/19)).
- **First click opens the full new-template form.** The `+` button now
  renders MainPanel's create form directly instead of opening the
  body-only EditorPane first. Base-on-template and Adapt-to-inbound
  flows still go through EditorPane
  ([PR #21](https://github.com/AbstractNucleus/templater/pull/21)).
- **Default opening is "Hello,".** The new-template and base-on-template
  flows seed the opening field with "Hello,". Editing, duplicating, and
  AI adapt continue to preserve the source's opening
  ([PR #22](https://github.com/AbstractNucleus/templater/pull/22)).

### Removed

- **Per-template signature override.** The optional `signature_override`
  field is gone — the global signature in Settings is enough, and
  templates that need a different signature can bake it into the body.
  Existing non-null values are silently dropped on the next save (serde
  ignores the now-unknown field on load)
  ([PR #22](https://github.com/AbstractNucleus/templater/pull/22)).

## [0.5.0] — 2026-05-27

### Added

- **AI-assisted in-place editing.** Pressing Edit on an existing
  template now opens the agent sidebar beside the form. Prompts to the
  agent update the draft body live; Save overwrites the same template
  instead of saving a new one.
- **Aero Snap on Windows.** A WNDPROC subclass reports `HTCAPTION` for
  the custom title bar, so Win+Arrow, drag-to-edge snapping, and the
  Snap Layouts hover all work on the frameless window again
  ([issue #5](https://github.com/AbstractNucleus/templater/issues/5)).
- **History diff view.** Per-template version history now renders a
  per-field before/after diff (Tags / Opening / Body) instead of a raw
  snippet, with an explicit "No visible diff" state.
- **Folder drag-and-drop.** Drop a template — or a multi-selection —
  onto a folder header in the sidebar to move it; drop onto "Ungrouped"
  to clear the folder.
- **Tag combinator + exclusion.** The tag filter now supports an AND/OR
  toggle and right-click exclusion via the new
  `src/lib/stores/selectionStore.svelte.ts`.
- **"Never used" sort mode.** Sort cycle is now manual → recent →
  most used → never used → manual.

### Changed

- **Per-op sidecar timeouts.** A single timeout is replaced by four:
  10s for status/ping, 60s for rank, 90s for edit/adapt/capture, 30s
  default. A slow draft no longer marks the sidecar Unavailable and
  drains unrelated in-flight requests.
- **Sidecar protocol validation.** Incoming lines now go through
  `parseRequestLine`, so a malformed JSON line returns a structured
  `ok: false` error instead of throwing inside the worker.
- **Honest diagnostics.** Sidecar responses with `ok: false` are now
  recorded as failures in the latency panel; previously they counted as
  successes.
- **Bulk template ops in Rust.** `bulk_delete_templates`,
  `bulk_add_template_tag`, and `bulk_remove_template_tag` replace
  looped per-template calls, so a multi-select op roundtrips through
  one disk write.
- **Friendlier sidecar error copy.** Timeout, pipe-closed, and
  Unavailable each get a distinct message that says what to do next.

### Fixed

- **Column-width persistence on high-DPI displays.** Divider drags
  emitted fractional `clientX`, which wrote floats into
  `settings.column_widths`. The Rust `ColumnWidths` is `u32`, so the
  next save (any copy_count bump would trigger it) failed and surfaced
  the red "save failed" banner. Widths are now rounded at the move
  handler and again in `persist()`
  ([PR #18](https://github.com/AbstractNucleus/templater/pull/18)).
- **Edit-template pick timing.** Edit responses now include
  `timings.pick_ms`, matching adapt, so the latency rollup attributes
  the context-pick step to the right op.

### Tests

- New `sidecar/protocol.test.ts` covers `parseRequestLine` happy and
  error paths; `src/lib/api.test.ts` covers the rewritten
  `explainRankError` mapping.

### CI

- The push/PR workflow now installs Tauri's Linux system dependencies,
  fetches a Linux `node` binary via `scripts/fetch-node-binary.mjs`,
  and stages the sidecar `prod-bundle` before `cargo check`. Linux is
  a CI-only target; Templater still ships Windows + macOS only.

### Docs

- `RELEASING.md` rewritten as the single source for the tag-driven
  release workflow. `IDEA.md` removed.

### Known limitations

- Windows installer is still ~280 MB
  ([issue #2](https://github.com/AbstractNucleus/templater/issues/2)).

## [0.4.0] — 2026-05-26

### Added

- **Per-template usage stats.** Each template now tracks lifetime
  `copy_count`. The sort button cycles **manual → recent → most used**.
- **Per-template signature override.** Optional field on each template
  that wins over the global signature when set.
- **Global snippets.** Define `key = value` pairs in Settings that
  expand at copy time alongside `{{date}}` / `{{time}}`. Per-template
  fills still override snippets.
- **Per-template edit history.** Each save snapshots the prior
  opening/body into a 10-entry ring. The main panel surfaces them with
  a "Revert" button per version. Revert is itself undoable.
- **Folder grouping.** Optional `folder` field on each template.
  When any template has a folder, the sidebar renders collapsible
  groups; flat layout otherwise.
- **Bulk ops extended.** Multi-select right-click now offers
  **Add tag**, **Remove tag**, **Export**, and **Delete**.
- **Quick-capture hotkey.** A second optional global hotkey grabs the
  current clipboard and opens the new-template form with the body
  pre-filled. Set it under Settings → Hotkey.
- **Latency p50/p95 panel.** Diagnostics now shows a per-op rollup
  (count, p50, p95, errors) over the last 100 sidecar calls.
- **Smarter context chunking.** Files larger than 8k chars now have
  their head + section headers + tail sent to the summarizer instead of
  just the head, so late-document signal isn't truncated.
- **CI on push + PR.** New `.github/workflows/ci.yml` runs
  `cargo check`, `svelte-check`, `vitest`, and a sidecar `tsc` build on
  every push and PR to `main`.

### Changed

- **Lazy sidecar spawn.** Browse-and-copy sessions no longer spin up
  the Node sidecar at launch. The sidecar starts on the first AI op
  (rank / adapt / edit / context) or when a non-empty context source
  list is persisted.
- **Settings modal split.** The 1480-line `SettingsModal.svelte` was
  decomposed into focused section components under
  `src/lib/components/settings/` — pure refactor, identical UX.
- **+page.svelte split.** App-state orchestration moved into
  `src/lib/stores/templatesStore.svelte.ts` and `agentStore.svelte.ts`
  — pure refactor, identical behavior.

### Fixed

- Ingest summaries on long files no longer drop everything past the
  first 8k characters — see "Smarter context chunking" above.

### Tests

- New `sidecar/context.test.ts` covers `extractText` for
  `.md` / `.txt` / `.csv` / `.xlsx` / `.pdf` and the `summaryInput`
  head/tail/headers logic. Suite total: **61 tests**.

### Known limitations

- The Windows installer is still ~280 MB. The bulk is
  `@anthropic-ai/claude-agent-sdk`'s required platform binary
  (`claude.exe`, 224 MB); see
  [issue #2](https://github.com/AbstractNucleus/templater/issues/2)
  for the architectural options.
- Aero Snap on the frameless Windows window is still missing; needs
  WinAPI WNDPROC subclassing. See
  [issue #5](https://github.com/AbstractNucleus/templater/issues/5).

## [0.3.4] — 2026-05-25

### Added

- **New shortcuts.** `Ctrl+Shift+M` toggles the capture popover,
  `Ctrl+Enter` submits it, `?` toggles the cheat sheet (was open-only),
  `Esc` clears the focused search input.
- **`{{time}}` / `{{time:long}}` placeholders** alongside the existing
  date variants.
- **Tray menu Settings item** opens the window and goes straight to the
  Settings modal.
- **"Reset hotkey to default"** button and **"Open data folder"** button
  in Settings; reset window position now actually centers and clears
  saved geometry via Rust.
- **Dismissible global error banner** stacks above the undo toast.
- Capture popover gains an empty-state CTA that opens the context pane,
  an "Open" button revealing the saved memory file, an inline
  adapt-to-inbound error with Retry, and clickable example chips in the
  agent sidebar empty state.

### Fixed

- **Data-loss guards.** Corrupt `settings.json` no longer destroys
  templates on next save; failed template loads no longer fall back to
  starters; placeholder values can't be resurrected after template
  delete.
- **Atomic global-hotkey rebind** (register new before unregistering
  old) and the app keeps starting if hotkey registration fails.
- `Ctrl+Z` inside the search box no longer hijacks the template undo
  stack.
- Title-bar pin reflects the actual window state on mount.
- Sidecar respawn re-pushes the context source list via a new event.
- Bulk-add tag normalizes input so `Email`/`email` don't duplicate;
  Add button disabled on empty input and no longer silently closes.
- Save-geometry skipped while the window is minimized.
- Capture popover clears stale success/error on input.
- `ContextPane` and Diagnostics pause polling when the document is
  hidden.
- Guarded `setContextSources` effect from re-firing on unrelated
  changes; `contextOpen` persists across sessions.
- Starter template `{{time}}` renamed to `{{meeting_time}}` to avoid
  collision with the new built-in.
- Stale delete-confirm copy fixed in both modals.

### Docs

- README + cheat sheet document the new shortcuts and context pane
  capture flow; onboarding tour mentions context + capture.

## [0.3.3] — 2026-05-25

### Changed

- **Capture memory moved to the title bar.** The capture form now lives in
  a dedicated popover triggered by a new title-bar button — no need to
  open the context pane just to drop a snippet in. The context pane stays
  focused on browsing indexed sources and files.

### Fixed

- Modal popover no longer leaks keyboard shortcuts to the underlying
  app: Ctrl+F / Ctrl+L / zoom no longer steal focus or clear search
  while the capture popover is open.
- Window drag-drop is now disabled so a missed click on the title bar
  doesn't accidentally start a drag.
- Dev sidecar inherits `--experimental-sqlite` via `NODE_OPTIONS` so
  `tsx` boots `node:sqlite` cleanly, mirroring the bundled-node path.

### Docs

- Cheat sheet documents the `{{placeholder}}` syntax.

## [0.3.0] — 2026-05-24

### Added

- **Context system** — point Templater at folders of markdown, PDF, or
  Excel reference material and the AI consults them during adapt + edit.
  - New 📚 button in the title bar toggles a fourth right-side pane
    listing sources, indexed files (with their AI summaries + tags), and
    a capture-memory form.
  - Per-file ingest pipeline: extract text (pdf-parse / SheetJS / fs),
    Haiku-summarize, store in `context.db` (`node:sqlite`, no native
    deps). Chokidar watcher per source keeps the index live; rescan
    button + scan-on-startup cover edits made while the app was closed.
  - Adapt and edit calls now pre-fetch context: a Haiku pick step
    selects up to 3 relevant files and their text is injected into
    Sonnet's system prompt. The chat panel reports "Consulted context:
    foo.md, bar.pdf" so you can see what informed each draft.
- **Capture memory** — paste a Slack thread or email into the context
  pane; Haiku distills the durable signal and appends it to
  `memories.md` under your chosen source root. The new entry re-ingests
  automatically.
- **Polish bundle (v0.3 precursor)** — modal Escape handling, selection
  lifecycle fixes, sort + tag + adapt edge cases.
- **10 prior features** — drag-reorder, multi-select, placeholder
  typing, adapt-to-inbound, sidecar diagnostics, cheat sheet,
  onboarding tour, sign-in flow, tag management, sidecar prune.

### Changed

- **Privacy story** — README docs updated. Adding a source folder
  is the opt-in; the dialog notes what leaves the machine. Per-file
  Haiku summary at ingest, picker + selected file contents at adapt /
  edit time, distilled signal at memory capture.
- **Sidecar startup** — Rust now passes the app data dir as `argv[2]`
  so the sidecar can place `context.db` alongside `templates.json` /
  `settings.json`.

### Migration

- `Settings` grows `context_sources: string[]` (default `[]`) and
  `column_widths.context: u32` (default 360). Both load transparently
  via `#[serde(default)]` on the Rust side.

## [0.2.0] — 2026-05-23

### Added

- **Undo** (`Ctrl+Z`) for template-list mutations — save, delete,
  duplicate, agent save-as, pin/unpin, import, and restore-from-backup.
  Bounded snapshot stack (20 entries) shows a toast on each undo.
  Settings (theme, zoom, columns) are intentionally not snapshotted.
- **Pinned templates** — right-click → Pin floats a template to the
  top of the catalog regardless of search score. Marked with a ▸
  indicator next to the name.
- **Recently-used sort** — non-pinned templates now sort by most
  recent copy first when the search box is empty.
- **Persistent placeholder fill-ins** — `{{name}}` and friends remember
  their last value per template, across template switches and across
  app restarts. Empty values are stripped; deleting a template clears
  its slot.
- **Backup rotation + restore UI** — every save now writes
  `templates.json.bak.<epoch>` and keeps the newest 5. Settings →
  Backups lists them with timestamps and offers Restore (which itself
  goes through the normal save path, so undoing a mistaken restore is
  one more restore away).
- **Streaming agent edits** — the "Base on template" editor now shows
  partial output as the model writes it, instead of a static
  "Thinking…" for the full 2-8s round trip.
- **Unit tests** — Vitest covers `searchTemplates` scoring + highlight
  merging and the placeholder split/apply/extract helpers. Run via
  `npm test`.

### Changed

- **Sidecar IPC is now multiplexed** — rank and edit calls share the
  same pipe instead of serialising behind a single mutex. Each request
  gets a unique id; responses route by id. Effective today for
  concurrent agent + rank traffic.
- **30s request timeout** on every sidecar call. A timed-out request
  treats the pipe as desynced, marks the sidecar Unavailable, and the
  next call respawns it — replaces the previous unbounded `read_line`
  that could wedge every future call behind one stuck request.
- **README** — documents the sidecar wire protocol, the test commands,
  the keyboard shortcuts, and the storage layout.

### Migration

- `Template` grows `pinned: boolean` and `last_used_at: string | null`.
- `Settings` grows `placeholder_values: Record<template_id, Record<var, value>>`.
- Both load transparently from older data files via `#[serde(default)]`
  on the Rust side; no manual migration needed.

## [0.1.1]

Initial tracked release for the original 0.1.x design.
