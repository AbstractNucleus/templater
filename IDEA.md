# Templates Widget — Design

A personal templating app for prose drafts (emails, replies, DMs, networking, follow-ups). Tag-organised, one-click copy, semantic paste-to-match via Claude API. Desk-side companion: tray icon, global hotkey, optional always-on-top.

Originated from vault page `[[templates-widget]]` (promoted 2026-05-19). Original framing was CS reply templates for the Clickout Media engagement; reframed 2026-05-19 to **personal use only** — no engagement traffic, no customer data, no NDA/GDPR constraint.

## Decisions at a glance

| Branch | Decision | Notes |
|---|---|---|
| Feature scope | Full vision — paste-match in v1 | Includes Claude API integration |
| Use case | Personal, not engagement | NDA/GDPR concerns don't apply |
| Corpus | Prose / message drafts | Emails, forum replies, DMs, networking |
| Storage | Single JSON file in `%APPDATA%` | Sync via Dropbox/iCloud if needed |
| Stack | Tauri + SvelteKit | Aesthetic fidelity to Claude Code |
| Variable UX | Copy-with-placeholders | `{{vars}}` survive copy; edit in target app |
| Categories | Tags, multi-assignable | Sidebar shows tag chips, intersection on multi-select |
| Paste-match UI | Top-of-sidebar input | Length threshold switches literal ↔ semantic |
| API key | OS keychain via Tauri | `ANTHROPIC_API_KEY` env var as override |
| Window behaviour | Full desk-companion | Tray + global hotkey + always-on-top toggle |
| Body format | Plain text | Universal target compatibility |
| Model | Claude Haiku 4.5 | Fast, cheap, plenty for ranking |
| Distribution | Portable `.exe` + GitHub Releases | No installer, no auto-updater |
| Window chrome | Fully frameless, custom resize handles | Maximum aesthetic polish, ~2-3 days of chrome work |
| Shared base with paste-stack | None — standalone | Extract when paste-stack is real |

## Original capture (historical)

> I have an idea about either a widget or an app that I can use for my work and just have it open beside me. It will have categorized templates that are like one-click copy, and checkboxes to choose if it should include the signature or opening phrases. You could also have a system where you paste an input and it will use cloud to try and find a matching template.

Reframed: the `category` field becomes `tags` (multi-assignable), the variable-fill UX becomes copy-with-placeholders, the engagement use case is dropped.

## Data model

Single JSON file at `%APPDATA%\templates-widget\templates.json`:

```json
{
  "version": 1,
  "templates": [
    {
      "id": "uuid-v4",
      "name": "Decline meeting politely",
      "tags": ["email", "decline"],
      "opening": "Hi {{name}},",
      "body": "Thanks for the invite — unfortunately I won't be able to make it. Happy to find another time if helpful.",
      "signature": "— N",
      "created_at": "2026-05-19T18:00:00Z",
      "updated_at": "2026-05-19T18:00:00Z"
    }
  ],
  "settings": {
    "always_on_top_default": false,
    "global_hotkey": "Ctrl+Shift+Backslash",
    "window_geometry": { "x": 100, "y": 100, "w": 800, "h": 600 }
  }
}
```

Notes:

- `opening` and `signature` are independent toggleable strings. UI checkboxes control whether they prefix/suffix `body` on copy.
- `{{variable}}` tokens in any field are preserved verbatim on copy. The UI may display detected variables as a hint, but no fill UI in v1.
- Tags are arbitrary strings. The sidebar derives the tag list from observed values across all templates.
- API key is NOT in this file — it lives in Windows Credential Manager.
- Atomic writes: write to `templates.json.tmp`, fsync, rename. Pre-write backup to `templates.json.bak`.

## UI

Mirrors the Claude Code desktop app. Dark theme, fully frameless, custom resize handles.

### Layout

```
┌─ [drag region: app name] ──────── pin ⚙ ▢ — × ┐
│ ┌────────────────┬──────────────────────────┐ │
│ │ [search/paste] │  [breadcrumb / tag-name] │ │
│ │                ├──────────────────────────┤ │
│ │ ─ Tags ─       │  Template name           │ │
│ │  email (12)    │                          │ │
│ │  decline (3)   │  ☑ Include opening       │ │
│ │  forum (8)     │  ☑ Include signature     │ │
│ │  ...           │  ──────────────────────  │ │
│ │                │  Preview (read-only):    │ │
│ │ ─ Templates ─  │   Hi {{name}},           │ │
│ │  Decline mtg   │                          │ │
│ │  Follow-up …   │   Thanks for the invite  │ │
│ │  ...           │   — ...                  │ │
│ │                │                          │ │
│ │                │   — N                    │ │
│ │                │                          │ │
│ │                │              [ Copy ]    │ │
│ └────────────────┴──────────────────────────┘ │
└────────────────────────────────────────────────┘
```

### Sidebar

- Combined search/paste input at the top.
  - Under threshold (~30 chars): literal substring filter on name + body.
  - Above threshold: semantic match via Haiku 4.5; results replace the template list with ranked matches.
- Tag list with template counts. Click to filter; Ctrl-click for multi-select (intersection).
- Template list, filtered by the current selection.

### Main panel

- Breadcrumb title at the top: `tag / template-name`.
- Action icons top-right: edit, duplicate, delete.
- Body: opening/signature checkboxes, read-only preview, Copy button.
- Edit mode (toggle from action icon): replaces preview with editable fields for name, tags, opening, body, signature.

### Window chrome

- Fully frameless (`decorations: false` in Tauri).
- Custom drag region in the top bar.
- Custom min/close icons in the top-right. **No maximize** — companion windows shouldn't max.
- Custom resize handles on 4 edges + 4 corners.
- Custom drop shadow (native shadow won't render on a frameless window).
- Rounded corners (Win11 supports via Tauri window API).

Frameless cost is real — count on ~2-3 days for chrome alone, between drag-region tuning, snap behaviour, and edge-resize hit zones.

## Paste-to-match

1. User pastes inbound text into the sidebar search/paste input.
2. Under length threshold → literal substring filter, no API call.
3. Above threshold → POST to Anthropic Messages API with model `claude-haiku-4-5-20251001`. Prompt inlines the entire template catalog (`id + name + tags + opening + body`) plus the pasted text. Asks for the top 5 matches as ranked IDs with one-line justifications.
4. Sidebar template list replaces with the ranked results, each showing the justification underneath.
5. Click a result → main panel loads that template. Copy as normal.

Error states:

- No API key configured → sidebar input shows hint: "Set API key in Settings to enable paste-match."
- Network error → inline error in the result area with [Retry].
- API error (auth fail, rate limit) → inline error with message and [Retry] / [Open Settings].
- No strong matches → "No strong matches" with literal search results as fallback.

Architecture: inline the whole catalog in the prompt. No embeddings, no vector DB. At personal scale (<200 templates) the token cost is fractions of a cent per match.

## Window behaviour

- Launches minimised to tray on startup (configurable in Settings).
- Tray icon: left-click toggles window, right-click → Show / Settings / Quit menu.
- Global hotkey: default `Ctrl+Shift+\\`, rebindable in Settings. Toggles window visibility.
- Always-on-top: pin icon in the custom title bar. Off by default, persists per session.
- Close button: minimises to tray (first-time hint shown). Quit only via tray menu.
- Default window size: 800×600. Saves geometry across sessions.

## API key handling

Stored in Windows Credential Manager via `tauri-plugin-stronghold` (or a thin keyring crate, TBD which is easier).

- Settings modal has a password-masked field. Save writes to keychain.
- Env var `ANTHROPIC_API_KEY` overrides keychain if set (for dev / power-user override).
- First-run banner: "Set your Anthropic API key to enable paste-match" → click → modal.
- Settings shows status: "Key configured ✓" or "No key set."

## Build & distribution

- Build: `cargo tauri build` → `target/release/template-widget.exe` (~10 MB).
- Distribution: tag a release on GitHub, upload binary, link in README.
- Install: download, run. No installer.
- Update: re-download from Releases. Manual.
- Code signing: defer. SmartScreen warning on first launch — accept once.

## Project structure (planned)

```
coin_template_manager/
├── src-tauri/              # Rust backend
│   ├── Cargo.toml
│   ├── src/
│   │   ├── main.rs
│   │   ├── store.rs        # templates.json read/write
│   │   ├── keychain.rs     # API key get/set
│   │   ├── api.rs          # Anthropic API call
│   │   └── hotkey.rs       # global hotkey registration
│   └── tauri.conf.json
├── src/                    # SvelteKit frontend
│   ├── routes/+page.svelte
│   ├── lib/
│   │   ├── components/     # Sidebar, MainPanel, SettingsModal, TitleBar
│   │   ├── stores/         # Svelte stores for template state
│   │   └── api.ts          # Tauri invoke wrappers
│   └── app.html
├── package.json
├── README.md
└── IDEA.md
```

## Open work

Small decisions still pending — make these inline during implementation:

- Settings UI specifics: hotkey rebind widget, always-on-top default toggle, tray-on-startup toggle.
- Edit-mode UI for templates (CRUD form).
- First-run empty-state copy.
- Import/export from JSON (defer to v2 unless trivial).
- Custom drop-shadow rendering technique (Tauri trick or CSS box-shadow on inner container).
- Aero Snap behaviour for frameless window.

## Adjacent vault references

- `[[paste-stack]]` — clipboard manager idea (LIFO, hotkey overlay, fuzzy search). Same family. Extract a shared base only when paste-stack is real, not before.
- `[[anthropic]]` — API provider for paste-match.
- `[[windows-autoclicker]]`, `[[terminal-switcher]]`, `[[compositor]]` — existing Win32 tooling whose stacks were reference points. `compositor` is the closest match (Tauri-based).
- `anthropic-skills:email` Claude skill — the semantic-match capability already exists CLI-side; this widget is that skill behind a GUI.

## Note on this repo's name

`coin_template_manager` was named under the engagement framing. With personal-use reframing, the name no longer fits. Candidates for rename: `templates-widget` (matches vault page), `template-companion`, `template-desk`. Defer until first release — renaming a private repo with one collaborator is cheap.

## Status

In design. Major branches resolved 2026-05-19 via `/grill-me` session. Next: scaffold Tauri + SvelteKit, implement the tracer feature path (CRUD + copy with toggles) before paste-match.
