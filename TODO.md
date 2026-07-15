# TODO

## Data-safety & correctness bugs

- [ ] **Concurrent-save data corruption** — `Store` is managed bare and the save commands are sync `fn`, so two can race on the fixed `templates.json.tmp`. Wrap `Store` in a `Mutex` + use a unique temp name. (src-tauri/src/store.rs) _[verified]_
- [ ] **Shift-range selection crosses folders** ("selects everything") — `visibleTemplateIds` uses the flat cross-folder order, not the grouped display order; ranges slice across folders and collapsed groups. _[verified]_
- [ ] **Dead duplicate selection state** in templatesStore — `selectedTemplateId`/`bulkSelectedIds` are written but unread (UI reads selectionStore). Delete them. (src/lib/stores/templatesStore.svelte.ts)
- [ ] **Backup self-eviction** — a `.bak` is written on every save and same-second names collide, churning through `MAX_BACKUPS`. Back up only on real content change. (src-tauri/src/store.rs)

## Tests & CI

- [ ] Rust unit tests for the on-disk Store — save/backup/prune, corrupt-file fallback, legacy migration, concurrency. (src-tauri/src/store.rs)
- [ ] Frontend store tests — selectionStore range/ctrl/shift, templatesStore undo ring + history dedup. (src/lib/stores/)
- [ ] Run CI on Windows + macOS, not just Ubuntu (build matrix). (.github/workflows/ci.yml)
- [ ] Add clippy + rustfmt + eslint + prettier, wired into CI.

## Architecture & maintainability

- [ ] Decompose the 1696-line `+page.svelte` — extract a hotkeys module + a workspace wrapper. (src/routes/+page.svelte)
- [ ] Reduce MainPanel prop-drilling (~24 props repeated 3×) — read stores directly / pass a config object. (src/routes/+page.svelte)
- [ ] Make the global keyboard handler table-driven + testable. (src/routes/+page.svelte)

## Product features

- [ ] Global quick-switcher overlay — hotkey pops a fuzzy box over any app; Enter copies, then hides.