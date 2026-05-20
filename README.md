# templates-widget

Personal desk-companion app for prose templating — emails, replies, DMs, networking, follow-ups. One-click copy with optional opening / signature toggles, plus semantic paste-to-match via the Claude Agent SDK (uses your Claude subscription, not API billing).

Windows desktop app. Tauri 2 + SvelteKit + TypeScript frontend, Rust backend, Node.js sidecar hosting the Anthropic Agent SDK.

> The repo directory name (`coin_template_manager`) is legacy from an earlier engagement-work framing. The app's actual `productName` is `templates-widget`. Repo rename deferred to first release.

## Design doc

**Read [`IDEA.md`](./IDEA.md) first.** It captures every design decision (scope, stack, storage, auth, UX) plus the current implementation state and recommended next milestone.

## Getting started

Prerequisites: Node.js v18+, Rust stable, and Claude Code installed and signed in via `claude login` (the Agent SDK auto-discovers your session).

```powershell
# One-time
npm install
cd sidecar ; npm install ; cd ..

# Dev (HMR + Rust auto-rebuild)
npm run tauri dev

# Sanity checks
cd src-tauri ; cargo check     # Rust
cd ..        ; npm run check   # Svelte + TS
```

## Architecture

Three processes talk over stdio JSON:

```
SvelteKit (webview)  ──invoke──>  Tauri Rust backend  ──stdin/stdout──>  Node sidecar (Agent SDK)
                     <─result──                       <──────────────
```

- **Svelte frontend** (`src/`) — UI. Single page with a ping button right now.
- **Rust backend** (`src-tauri/`) — Tauri shell, hosts the `Sidecar` actor and Tauri commands.
- **Node sidecar** (`sidecar/`) — newline-delimited JSON over stdin/stdout. Wraps `@anthropic-ai/claude-agent-sdk` for paste-match (stub for now).

See `IDEA.md` § [Project structure](./IDEA.md#project-structure-planned) and § [Paste-to-match](./IDEA.md#paste-to-match) for the full picture.

## Status

Scaffold + sidecar IPC verified. Feature work hasn't started. Next milestone: replace the ping page with the three-pane UI shell, then CRUD against a local `templates.json`, then the real Agent SDK call.

## Privacy

Templates are stored locally in `%APPDATA%\templates-widget\templates.json`. Paste-match sends the catalog + pasted text to Anthropic via the Agent SDK; nothing else leaves the machine. The app does not collect telemetry.

## License

Private — not currently licensed for external use.
