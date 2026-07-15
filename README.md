# Templater

Personal desk-companion app for prose templating — emails, replies, DMs, networking, follow-ups. One-click copy with optional opening / signature toggles.

Cross-platform desktop app (Windows + macOS). Tauri 2 + SvelteKit + TypeScript frontend, Rust backend.

## Install (playtest)

**No external dependencies.**

### Windows 10/11

1. **Download `Templater_0.1.1_x64-setup.exe`** (link in the message I sent you). Double-click to install. First launch will trigger a SmartScreen warning ("Windows protected your PC") because the installer isn't code-signed; click *More info* → *Run anyway*.

### macOS (Apple Silicon)

1. **Download `Templater_0.1.1_aarch64.dmg`**, open it, and drag *Templater* to *Applications*. First launch will trigger a Gatekeeper warning ("can't be opened because Apple cannot check it for malicious software") because the app isn't notarized; right-click the app → *Open* → *Open* in the dialog. Subsequent launches work normally.

That's it. The app drops a tray icon, opens an 800×600 window, and seeds itself with a handful of starter templates so you can see the format.

> **Prefer portable on Windows?** If you don't want anything installed to Program Files, ask me for the portable zip instead — extract anywhere, run `Templater.exe`, delete the folder when done. Same app, just no installer / uninstaller / Start Menu entry.

## Using it

- **Browse**: click a template in the middle panel → preview on the right. Click *Copy* (or use the keyboard) to put the composed text on your clipboard.
- **Filter**: type in the search box. Matches across name, tags, and body, with hits highlighted.
- **Tag-filter**: left-click a tag chip in the left panel to include it, right-click to exclude it. Click again to deselect. With 2+ tags included, the `ALL / ANY` toggle in the section header switches between intersection and union. *Clear* in the header resets all filters.
- **Edit / create**: hit `+` or *Edit* in the main panel. Tag picker lets you pick existing tags or type a new one.
- **User mode**: Settings → Mode → User. Hides all the editing affordances if you just want to browse + copy without accidentally changing anything.
- **Close** minimises to the tray. Quit via the tray icon's right-click menu. Global hotkey `Ctrl+Shift+\` toggles the window.

## Updates

Open Settings → **Updates** → *Check for updates*. The app fetches the latest signed release from the public releases repo and walks you through the install. Signed updates only — if the signature doesn't match the public key embedded in the app, it refuses to install. No background polling, no telemetry, only checks when you click the button.

## Privacy

Templates live in `templates.json`, preferences in `settings.json` — all under `%APPDATA%\com.noel.templatewidget\` on Windows, `~/Library/Application Support/com.noel.templatewidget/` on macOS.

No telemetry, no analytics, no account. Everything stays on your machine.

---

## Developer notes

```powershell
# One-time
npm install

# Dev (HMR + Rust auto-rebuild)
npm run tauri dev

# Build platform installer (.exe on Windows, .dmg/.app on macOS)
npm run tauri build

# Sanity checks
npm test                                                  # vitest, pure modules
npm run check                                             # Svelte + TS
cargo check --manifest-path src-tauri/Cargo.toml          # Rust
```

### Architecture

```
SvelteKit (webview)  ──invoke──>  Tauri Rust backend
                     <─result──
```

- Svelte frontend (`src/`) — UI. Talks to Rust via `invoke()` and listens to Tauri events.
- Rust backend (`src-tauri/`) — Tauri shell, the on-disk store, and system tray.

### Storage

Two JSON files in the OS app-data dir. Every save copies the current file to `<name>.bak.<epoch>` and prunes to the newest 5 backups, then writes `<name>.tmp` and atomically renames. Settings → Backups lists and restores them.

### Keyboard shortcuts

- **Enter** (from search or body) — copy the selected template
- **↑ / ↓** — move the selection
- **Ctrl+F** — focus the search input
- **Ctrl+L** — clear the search
- **Ctrl+Z** — undo the last template-list mutation
- **Ctrl+0 / Ctrl+= / Ctrl+-** — reset / zoom in / zoom out
- **?** — open the in-app cheat sheet
- **Global hotkey** (default `Ctrl+Shift+\`) — show/hide the window from anywhere

## License

Private — not currently licensed for external use.