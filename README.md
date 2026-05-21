# templates-widget

Personal desk-companion app for prose templating — emails, replies, DMs, networking, follow-ups. One-click copy with optional opening / signature toggles, plus semantic paste-to-match via the Claude Agent SDK (uses a Claude subscription, not API billing).

Cross-platform desktop app (Windows + macOS). Tauri 2 + SvelteKit + TypeScript frontend, Rust backend, Node.js sidecar hosting the Anthropic Agent SDK.

## Install (playtest)

**No external dependencies** — Node and the sidecar are bundled into the installer.

### Windows 10/11

1. **Download `templates-widget_0.1.1_x64-setup.exe`** (link in the message I sent you). Double-click to install. First launch will trigger a SmartScreen warning ("Windows protected your PC") because the installer isn't code-signed; click *More info* → *Run anyway*.

### macOS (Apple Silicon)

1. **Download `templates-widget_0.1.1_aarch64.dmg`**, open it, and drag *templates-widget* to *Applications*. First launch will trigger a Gatekeeper warning ("can't be opened because Apple cannot check it for malicious software") because the app isn't notarized; right-click the app → *Open* → *Open* in the dialog. Subsequent launches work normally.

### Then, on either OS

**Sign in to Claude** (only needed for the AI paste-match feature; everything else works without it). Open a terminal (PowerShell on Windows, Terminal on macOS):

```
claude login
```

If `claude` isn't recognised, paste-match will just say "Not signed in" inline and the rest of the app works fine.

That's it. The app drops a tray icon, opens an 800×600 window, and seeds itself with a handful of starter templates so you can see the format.

> **Prefer portable on Windows?** If you don't want anything installed to Program Files, ask me for the portable zip instead — extract anywhere, run `templates-widget.exe`, delete the folder when done. Same app, just no installer / uninstaller / Start Menu entry.

## Using it

- **Browse**: click a template in the middle panel → preview on the right. Click *Copy* (or use the keyboard) to put the composed text on your clipboard.
- **Filter**: type in the search box. Matches across name, tags, and body, with hits highlighted. Paste a longer message (30+ chars) and the search switches to AI ranking — the app sends the catalog + your text to Claude Haiku and ranks the best matches.
- **Tag-filter**: click a tag chip in the left panel to filter, Ctrl-click to multi-select (intersection).
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
cd src-tauri ; cargo check     # Rust
cd ..        ; npm run check   # Svelte + TS
```

Three processes talk over stdio JSON:

```
SvelteKit (webview)  ──invoke──>  Tauri Rust backend  ──stdin/stdout──>  Node sidecar (Agent SDK)
                     <─result──                       <──────────────
```

- Svelte frontend (`src/`) — UI.
- Rust backend (`src-tauri/`) — Tauri shell, hosts the `Sidecar` actor and Tauri commands.
- Node sidecar (`sidecar/`) — newline-delimited JSON over stdin/stdout. Wraps `@anthropic-ai/claude-agent-sdk` for paste-match and chat-driven template editing.

See `IDEA.md` § [Project structure](./IDEA.md#project-structure-planned) and § [Paste-to-match](./IDEA.md#paste-to-match) for the full picture.

## License

Private — not currently licensed for external use.
