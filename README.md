# Templater

Personal desk-companion app for prose templating — emails, replies, DMs, networking, follow-ups. One-click copy with optional opening / signature toggles, plus semantic paste-to-match via the Claude Agent SDK (uses a Claude subscription, not API billing).

Cross-platform desktop app (Windows + macOS). Tauri 2 + SvelteKit + TypeScript frontend, Rust backend, Node.js sidecar hosting the Anthropic Agent SDK.

## Install (playtest)

**No external dependencies** — Node and the sidecar are bundled into the installer.

### Windows 10/11

1. **Download `Templater_0.1.1_x64-setup.exe`** (link in the message I sent you). Double-click to install. First launch will trigger a SmartScreen warning ("Windows protected your PC") because the installer isn't code-signed; click *More info* → *Run anyway*.

### macOS (Apple Silicon)

1. **Download `Templater_0.1.1_aarch64.dmg`**, open it, and drag *Templater* to *Applications*. First launch will trigger a Gatekeeper warning ("can't be opened because Apple cannot check it for malicious software") because the app isn't notarized; right-click the app → *Open* → *Open* in the dialog. Subsequent launches work normally.

### Then, on either OS

**Sign in to Claude** (only needed for the AI paste-match feature; everything else works without it). Open a terminal (PowerShell on Windows, Terminal on macOS):

```
claude login
```

If `claude` isn't recognised, paste-match will just say "Not signed in" inline and the rest of the app works fine.

That's it. The app drops a tray icon, opens an 800×600 window, and seeds itself with a handful of starter templates so you can see the format.

> **Prefer portable on Windows?** If you don't want anything installed to Program Files, ask me for the portable zip instead — extract anywhere, run `Templater.exe`, delete the folder when done. Same app, just no installer / uninstaller / Start Menu entry.

## Using it

- **Browse**: click a template in the middle panel → preview on the right. Click *Copy* (or use the keyboard) to put the composed text on your clipboard.
- **Filter**: type in the search box. Matches across name, tags, and body, with hits highlighted. Paste a longer message (30+ chars) and the search switches to AI ranking — the app sends the catalog + your text to Claude Haiku and ranks the best matches.
- **Tag-filter**: left-click a tag chip in the left panel to include it, right-click to exclude it. Click again to deselect. With 2+ tags included, the `ALL / ANY` toggle in the section header switches between intersection and union. *Clear* in the header resets all filters.
- **Edit / create**: hit `+` or *Edit* in the main panel. Tag picker lets you pick existing tags or type a new one.
- **Base on template**: opens a chat with the AI editor. Tell it "make this more polite" / "shorten it" / etc. Save as new or copy and discard.
- **User mode**: Settings → Mode → User. Hides all the editing affordances if you just want to browse + copy without accidentally changing anything.
- **Close** minimises to the tray. Quit via the tray icon's right-click menu. Global hotkey `Ctrl+Shift+\` toggles the window.

## Updates

Open Settings → **Updates** → *Check for updates*. The app fetches the latest signed release from the public releases repo and walks you through the install. Signed updates only — if the signature doesn't match the public key embedded in the app, it refuses to install. No background polling, no telemetry, only checks when you click the button.

## Privacy

Everything is local. Templates live in `templates.json`, preferences in `settings.json` next to it — on Windows under `%APPDATA%\com.noel.templatewidget\`, on macOS under `~/Library/Application Support/com.noel.templatewidget/`. The only thing that ever leaves the machine is the paste-match call — when you paste a long message, the template catalog + your pasted text go to Anthropic's API via the Agent SDK. No telemetry, no analytics, no account.

---

## Developer notes

Read [`IDEA.md`](./IDEA.md) for design decisions, file layout, and the current implementation map.

```powershell
# One-time
npm install
cd sidecar ; npm install ; cd ..

# Dev (HMR + Rust auto-rebuild)
npm run tauri dev

# Build platform installer (.exe on Windows, .dmg/.app on macOS)
npm run tauri build

# Sanity checks
npm test                                                  # vitest, pure modules
npm run check                                             # Svelte + TS
cargo check --manifest-path src-tauri/Cargo.toml          # Rust
```

Three processes talk over stdio JSON:

```
SvelteKit (webview)  ──invoke──>  Tauri Rust backend  ──stdin/stdout──>  Node sidecar (Agent SDK)
                     <─result──                       <──────────────
                                  events──>                          progress, multiplexed by id
```

- Svelte frontend (`src/`) — UI. Talks to Rust via `invoke()` and listens to Tauri events.
- Rust backend (`src-tauri/`) — Tauri shell, the on-disk store, and the sidecar host. The sidecar host runs a writer task + reader task and routes responses to callers by id, so multiple in-flight rank/edit calls share the pipe.
- Node sidecar (`sidecar/`) — wraps `@anthropic-ai/claude-agent-sdk` and the Anthropic Messages API. Two ops today: `rank` (catalog match for paste-to-match) and `edit-template` (chat-driven structured edits). The edit op streams partial text back as it's generated.

See `IDEA.md` § [Project structure](./IDEA.md#project-structure-planned) and § [Paste-to-match](./IDEA.md#paste-to-match) for the full picture.

### Sidecar wire protocol

Newline-delimited JSON, one request per line, one or more responses per line. Each request carries a unique `id`; responses echo it back so the Rust reader routes to the matching caller.

```jsonc
// Request: { id, op, ...args }
{ "id": "r42", "op": "ping" }
{ "id": "r43", "op": "rank",
  "backend": "agent" | "api",
  "pasted": "<message text>",
  "catalog": [{ "id": "...", "name": "...", "body": "...", "tags": [...] }, ...] }
{ "id": "r44", "op": "edit-template",
  "backend": "agent" | "api",
  "draft": { "opening": "...", "body": "..." },
  "history": [{ "role": "user"|"assistant", "content": "..." }],
  "prompt": "make it shorter" }

// Response: final success or failure
{ "id": "r43", "ok": true, "rankings": [{ "template_id": "...", "score": 0.92 }, ...] }
{ "id": "r43", "ok": false, "error": "..." }

// Response: streaming partial (only edit-template, multiple per request)
{ "id": "r44", "progress": { "text": "<accumulated partial JSON>" } }
```

Each request is wrapped in a 30s timeout on the Rust side. A timeout, EOF on stdout, or a broken write marks the sidecar Unavailable; the next `invoke` respawns it. Progress lines (no `ok` field) are forwarded to the frontend via the `sidecar-progress` Tauri event and don't complete the caller's oneshot.

### Storage

Two JSON files in the OS app-data dir. Every save copies the current file to `<name>.bak.<epoch>` and prunes to the newest 5 backups, then writes `<name>.tmp` and atomically renames. Settings → Backups lists and restores them.

### Keyboard shortcuts

- **Enter** (from search or body) — copy the selected template
- **↑ / ↓** — move the selection
- **Ctrl+F** — focus the search input
- **Ctrl+L** — clear the search
- **Ctrl+Z** — undo the last template-list mutation
- **Ctrl+0 / Ctrl+= / Ctrl+-** — reset / zoom in / zoom out
- **Global hotkey** (default `Ctrl+Shift+\`) — show/hide the window from anywhere

## License

Private — not currently licensed for external use.
