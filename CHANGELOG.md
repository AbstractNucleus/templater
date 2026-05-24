# Changelog

All notable changes to Templater are documented here. Format loosely
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versions follow [SemVer](https://semver.org/spec/v2.0.0.html).

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

- **Privacy story** — README and IDEA updated. Adding a source folder
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

Initial tracked release. See `IDEA.md` for the design that landed in
0.1.x.
