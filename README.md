# Templater

Personal desk-companion app for prose templating — emails, replies, DMs, networking, follow-ups. One-click copy with optional opening / signature toggles.

Cross-platform desktop app (Windows + macOS). Tauri 2 + SvelteKit + TypeScript frontend, Rust backend.

## Download

Grab the latest installer or portable build from the [releases page](https://github.com/AbstractNucleus/templater/releases).

## Using it

- **Browse** templates in the sidebar, preview on the right. Click *Copy* (or press Enter) to paste.
- **Filter** by search or tag chips (left-click include, right-click exclude).
- **Edit / create** templates with the `+` button. Supports `{{placeholder}}`, `{{date:format}}`, and `{{choice:a|b|c}}`.
- **Global hotkey** `Ctrl+Shift+\` shows/hides the window from anywhere.

## Privacy

Templates and settings stay on your machine as local JSON files in the OS app-data directory. No telemetry, no analytics, no account.

Optional translation uses OpenRouter: when you run Translate, the selected text and your API key are sent to `https://openrouter.ai` for that request only. Nothing else is uploaded.

---

## Develop

```powershell
npm install        # one-time
npm run tauri dev  # dev with HMR + Rust auto-rebuild
npm run tauri build
npm test           # vitest
```

### Architecture

```
SvelteKit (webview)  ──invoke──>  Tauri Rust backend
                     <─result──
```

Svelte frontend (`src/`) talks to the Rust backend (`src-tauri/`) via Tauri `invoke()` and events. Local storage is `catalog.json` (templates + coupled metadata) and `preferences.json` in the OS app-data dir, with timestamped catalog backups.

### Keyboard shortcuts


| Key                      | Action                     |
| ------------------------ | -------------------------- |
| Enter                    | Copy selected template     |
| ↑ / ↓                    | Move selection             |
| Ctrl+F / Ctrl+L          | Focus / clear search       |
| Ctrl+Z                   | Undo last mutation         |
| Ctrl+0 / Ctrl+= / Ctrl+- | Reset / zoom in / zoom out |
| ?                        | Cheat sheet                |
| Ctrl+Shift+\ (global)    | Show/hide window           |


