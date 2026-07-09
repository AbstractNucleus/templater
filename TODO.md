# TODO

- [x] Ability to change Claude model in the AI agent view
- [ ] Ability to choose whether AI uses context or not in the agent view

## Data-safety & correctness bugs

- [ ] **Concurrent-save data corruption** — `Store` is managed bare and the save commands are sync `fn`, so two can race on the fixed `templates.json.tmp`. Wrap `Store` in a `Mutex` + use a unique temp name. (src-tauri/src/store.rs:351, src-tauri/src/lib.rs:755) _[verified]_
- [ ] **Shift-range selection crosses folders** ("selects everything") — `visibleTemplateIds` uses the flat cross-folder order, not the grouped display order; ranges slice across folders and collapsed groups. (src/routes/+page.svelte:543, src/lib/stores/selectionStore.svelte.ts:53, src/lib/components/TemplatesSidebar.svelte:106) _[verified]_
- [ ] **Dead duplicate selection state** in templatesStore — `selectedTemplateId`/`bulkSelectedIds` are written but unread (UI reads selectionStore). Delete them. (src/lib/stores/templatesStore.svelte.ts:59)
- [ ] **Poisoned-mutex panics** permanently kill the sidecar — replace `lock().unwrap()` with `lock().unwrap_or_else(|e| e.into_inner())`. (src-tauri/src/sidecar.rs, ~14 sites)
- [ ] **Backup self-eviction** — a `.bak` is written on every save and same-second names collide, churning through `MAX_BACKUPS`. Back up only on real content change. (src-tauri/src/store.rs:355,391)

## Tests & CI

- [ ] Rust unit tests for the on-disk Store — save/backup/prune, corrupt-file fallback, legacy migration, concurrency. (src-tauri/src/store.rs)
- [ ] Frontend store tests — selectionStore range/ctrl/shift, templatesStore undo ring + history dedup. (src/lib/stores/)
- [ ] Extract sidecar response-parsing into a testable module + test malformed model output. (sidecar/index.ts)
- [ ] Run CI on Windows + macOS, not just Ubuntu (build matrix). (.github/workflows/ci.yml)
- [ ] Add clippy + rustfmt + eslint + prettier, wired into CI.

## Architecture & maintainability

- [ ] Decompose the 1696-line `+page.svelte` — extract a hotkeys module + a workspace wrapper. (src/routes/+page.svelte)
- [x] Reusable `ConfirmDialog` with focus trap + restore; collapse the ~5 duplicated modals. (src/routes/+page.svelte, src/lib/components/MainPanel.svelte)
- [ ] Reduce MainPanel prop-drilling (~24 props repeated 3×) — read stores directly / pass a config object. (src/routes/+page.svelte)
- [ ] Make the global keyboard handler table-driven + testable. (src/routes/+page.svelte:183)
- [x] Add ARIA listbox semantics (`role="listbox"`/`option`, `aria-selected`) to arrow-key lists. (src/lib/components/TemplatesSidebar.svelte)

## Product features

- [ ] Global quick-switcher overlay — hotkey pops a fuzzy box over any app; Enter copies, then hides.
- [ ] AI auto-tag / auto-name on save — new `suggest-tags` sidecar op reusing the structured-agent pattern.
- [ ] Tone/length preset chips in the agent editor (Shorter / Warmer / More formal).
- [ ] Usage-analytics + dedup panel — surface `copy_count`/`last_used_at`; AI near-duplicate merge.
