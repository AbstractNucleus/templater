# Changelog

All notable changes to Templater are documented here. Format loosely
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versions follow [SemVer](https://semver.org/spec/v2.0.0.html).

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
