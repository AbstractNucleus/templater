# Templates Widget — Design

A personal templating app for prose drafts (emails, replies, DMs, networking, follow-ups). Tag-organised, one-click copy, semantic paste-to-match via Claude API. Desk-side companion: tray icon, global hotkey, optional always-on-top.

Originated from vault page `[[templates-widget]]` (promoted 2026-05-19). Original framing was CS reply templates for the Clickout Media engagement; reframed 2026-05-19 to **personal use only** — no engagement traffic, no customer data, no NDA/GDPR constraint.

## Current state (as of last commit on `main`)

**Scaffolded and verified.** Tauri 2 + SvelteKit + TypeScript project initialised via `create-tauri-app` with the `svelte-ts` template. Node sidecar wired up; the round-trip ping (Svelte button → Tauri invoke → Rust → Node stdin → Node stdout → back) was tested end-to-end and works.

**Where things live:**

| Path | Purpose | State |
|---|---|---|
| `src-tauri/Cargo.toml` | Rust deps (Tauri 2 + tokio + serde) | done |
| `src-tauri/src/main.rs` | Entrypoint (calls `templates_widget_lib::run`) | done |
| `src-tauri/src/lib.rs` | Tauri builder, `ping_sidecar` command, managed `Sidecar` state | done |
| `src-tauri/src/sidecar.rs` | Spawns `npx tsx sidecar/index.ts` at startup, stdio JSON IPC | done |
| `src-tauri/tauri.conf.json` | `productName: templates-widget`, identifier `com.noel.templatewidget` | done |
| `sidecar/package.json` | Pins `@anthropic-ai/claude-agent-sdk` ^0.3.144 | done (SDK not used yet) |
| `sidecar/index.ts` | newline-JSON loop; `ping` op works, `rank` op is a stub | partial |
| `src/routes/+page.svelte` | Single "Ping sidecar" button (placeholder) | placeholder |
| `package.json` | SvelteKit + Tauri deps + `@types/node` | done |
| `.gitignore` | Covers `node_modules`, `target/`, `.svelte-kit`, `dist/` | done |

**Commands to resume work:**

```powershell
# Dev (opens window with HMR)
npm run tauri dev

# Sanity checks
cd src-tauri ; cargo check       # Rust
cd ..        ; npm run check     # Svelte+TS

# Sidecar standalone smoke test (echoes a pong)
echo '{"id":"smoke","op":"ping"}' | npx tsx sidecar/index.ts
```

**Next milestone (recommended):** replace the Ping page with the three-pane shell (sidebar + main panel + collapsible right panel) using mocked templates. After that, real CRUD against `templates.json`, then clipboard + toggle logic, then the Agent SDK call to implement the sidecar's `rank` op.

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
| Auth & billing | Claude Agent SDK via Claude subscription | Uses Agent SDK credit pool (Pro $20 / Max5 $100 / Max20 $200 per month, starting 2026-06-15). No API key needed. |
| Sidecar | Node.js sidecar process | TypeScript Agent SDK runs in a Node sidecar spawned by Tauri's Rust backend; stdio JSON IPC. |
| Window behaviour | Full desk-companion | Tray + global hotkey + always-on-top toggle |
| Body format | Plain text | Universal target compatibility |
| Model | Claude Haiku 4.5 | Specified per-query in SDK `query()` options. Fast, cheap, plenty for ranking. |
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
- No API key in this file (or anywhere in the app). Auth is via the Claude Agent SDK + Claude subscription; see [Auth & billing](#auth--billing).
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

1. User pastes inbound text into the sidecar search/paste input.
2. Under length threshold → literal substring filter, no SDK call.
3. Above threshold → frontend invokes a Tauri command. Rust backend forwards the request (catalog + pasted text) over stdio JSON to the Node sidecar. Sidecar calls `@anthropic-ai/claude-agent-sdk`'s `query()` with `model: "claude-haiku-4-5-20251001"` and a JSON-schema `outputFormat` constraining the response to `{ rankings: [{ template_id, score, reason }] }`. Sidecar streams the result back over stdout.
4. Sidebar template list replaces with the ranked results, each showing the one-line `reason` underneath.
5. Click a result → main panel loads that template. Copy as normal.

Error states:

- Not signed in to Claude Code → sidebar shows: "Sign in via `claude login` to enable paste-match." (link opens shell with instructions).
- `ANTHROPIC_API_KEY` env var detected → warning banner: "API key env var is set; SDK will bill against the API, not your subscription. Unset to use subscription credits."
- Network error → inline error in the result area with [Retry].
- SDK error (auth fail, quota exceeded) → inline error with message and [Retry] / [Open Settings].
- Sidecar process dead → "Backend not running. Restart app." (Rust auto-restarts the sidecar; this state should be transient.)
- No strong matches → "No strong matches" with literal search results as fallback.

Architecture: catalog is inlined into the prompt (no embeddings, no vector DB). At personal scale (<200 templates) the SDK credit cost is trivial — a Max20 plan ($200/mo Agent SDK credit) easily absorbs hundreds of matches a day.

## Window behaviour

- Launches minimised to tray on startup (configurable in Settings).
- Tray icon: left-click toggles window, right-click → Show / Settings / Quit menu.
- Global hotkey: default `Ctrl+Shift+\\`, rebindable in Settings. Toggles window visibility.
- Always-on-top: pin icon in the custom title bar. Off by default, persists per session.
- Close button: minimises to tray (first-time hint shown). Quit only via tray menu.
- Default window size: 800×600. Saves geometry across sessions.

## Auth & billing

Uses the Claude Agent SDK with subscription-based auth — no API key, no keychain integration, no Settings field for credentials.

**How auth works:**

- The Agent SDK auto-discovers the local Claude Code session on startup. If you're signed in via `claude login` (which the user already is, since they use Claude Code daily), the SDK is authenticated.
- The SDK bundles its own Claude Code CLI binary, so the **end user does not need Claude Code separately installed** — only Node.js for the sidecar process.

**Billing:**

- Programmatic SDK usage draws from a separate **Agent SDK credit pool**, not the interactive Claude Code quota. Pool sizes (effective 2026-06-15): Pro $20/mo, Max 5x $100/mo, Max 20x $200/mo, Team/Enterprise varies.
- Each paste-match call costs a few thousand input tokens at Haiku rates. A heavy user firing 100 matches/day would burn maybe $1-2 of the credit pool. Max20's $200 monthly budget is effectively unlimited for this app.

**Critical gotcha — `ANTHROPIC_API_KEY` precedence:**

- If `ANTHROPIC_API_KEY` is set in the user's environment, the SDK uses it *instead* of subscription auth and bills against API rates.
- The app must detect this at startup (Rust reads env, forwards status to frontend) and surface a warning banner.
- Settings modal shows: subscription status (signed in / not signed in), env-var override warning (yes / no), Agent SDK credit status if discoverable.

**Settings modal scope** (revised, no API key field):

- Subscription auth status (read-only, with "Open `claude login`" button if not signed in).
- `ANTHROPIC_API_KEY` override warning (if detected).
- Global hotkey rebinder.
- Always-on-top default toggle.
- Start-minimised-to-tray toggle.
- Window-geometry reset.

## Build & distribution

- Build: `cargo tauri build` → `target/release/templates-widget.exe` (~10 MB). The Node sidecar ships alongside (`sidecar/` folder bundled as a Tauri resource, or as a separately-distributed companion).
- **Runtime requirement: Node.js on the target machine** (v18+). For personal use this is fine — Node is already installed on the dev/target machine via the Claude Code setup. For broader distribution later, bundle a Node binary via Tauri's [sidecar binary feature](https://tauri.app/v1/guides/building/sidecar/) (~30 MB add to the package).
- Distribution: tag a release on GitHub, upload binary + sidecar archive, link in README.
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
│   │   ├── store.rs        # templates.json read/write (atomic)
│   │   ├── sidecar.rs      # Node sidecar spawn + stdio JSON IPC
│   │   ├── tray.rs         # system tray icon + menu
│   │   ├── hotkey.rs       # global hotkey registration
│   │   └── env.rs          # ANTHROPIC_API_KEY env detection
│   └── tauri.conf.json
├── sidecar/                # Node.js sidecar (Agent SDK host)
│   ├── package.json        # depends on @anthropic-ai/claude-agent-sdk
│   ├── index.ts            # reads stdin (JSON requests), writes stdout (JSON responses)
│   └── tsconfig.json
├── src/                    # SvelteKit frontend
│   ├── routes/+page.svelte
│   ├── lib/
│   │   ├── components/     # Sidebar, MainPanel, SettingsModal, TitleBar
│   │   ├── stores/         # Svelte stores for template state
│   │   └── api.ts          # Tauri invoke wrappers
│   └── app.html
├── package.json            # SvelteKit deps
├── README.md
└── IDEA.md
```

**Sidecar protocol (sketch):**

```
→ stdin  { "id": "req-1", "op": "rank", "pasted": "...", "catalog": [...] }
← stdout { "id": "req-1", "ok": true, "rankings": [{ "template_id": "...", "score": 0.87, "reason": "..." }] }
← stdout { "id": "req-1", "ok": false, "error": "quota_exceeded" }
```

One request per line, JSON. Rust matches responses to requests by `id`. Sidecar lifecycle: spawn-on-startup, auto-restart on crash (with backoff), graceful shutdown via SIGTERM on app quit.

## Open work

Small decisions still pending — make these inline during implementation:

- Settings UI specifics: hotkey rebind widget, always-on-top default toggle, tray-on-startup toggle.
- Edit-mode UI for templates (CRUD form).
- First-run empty-state copy.
- Import/export from JSON (defer to v2 unless trivial).
- Custom drop-shadow rendering technique (Tauri trick or CSS box-shadow on inner container).
- Aero Snap behaviour for frameless window.
- Sidecar lifecycle policy: spawn-on-startup (keeps Node resident, faster matches) vs. spawn-per-query (cleaner but ~200ms cold start). Default: spawn-on-startup.
- Sidecar packaging: ship as a `sidecar/` resource folder vs. embed Node binary via Tauri sidecar feature. Default: ship as resource folder for v1 (requires Node on target), revisit when distributing beyond personal use.

## Adjacent vault references

- `[[paste-stack]]` — clipboard manager idea (LIFO, hotkey overlay, fuzzy search). Same family. Extract a shared base only when paste-stack is real, not before.
- `[[anthropic]]` — API provider for paste-match.
- `[[windows-autoclicker]]`, `[[terminal-switcher]]`, `[[compositor]]` — existing Win32 tooling whose stacks were reference points. `compositor` is the closest match (Tauri-based).
- `anthropic-skills:email` Claude skill — the semantic-match capability already exists CLI-side; this widget is that skill behind a GUI.

## Note on this repo's name

`coin_template_manager` was named under the engagement framing. With personal-use reframing, the name no longer fits. Candidates for rename: `templates-widget` (matches vault page), `template-companion`, `template-desk`. Defer until first release — renaming a private repo with one collaborator is cheap.

## Status

Scaffolded and ready for feature work. Major design branches resolved 2026-05-19 via `/grill-me` session; scaffold + sidecar IPC verified the same day. See [Current state](#current-state-as-of-last-commit-on-main) for the file map and next-milestone pointer.
