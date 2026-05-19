# Templates Widget — Project Idea

Source: synthesized from Obsidian vault on 2026-05-19. The vault page is `[[templates-widget]]` (promoted 2026-05-19). This file captures everything the vault has about the idea so the repo can stand alone.

## Original capture (verbatim, 2026-05-19)

> I have an idea about either a widget or an app that I can use for my work and just have it open beside me. It will have categorized templates that are like one-click copy, and checkboxes to choose if it should include the signature or opening phrases. You could also have a system where you paste an input and it will use cloud to try and find a matching template.

## Why

Day job = customer support for CoinPoker via the Clickout Media engagement (email + chat, Mon–Fri, output-based, global player base). Templates are the daily compression layer. A dedicated widget beats a folder of `.txt` files on three axes:

- **Latency** — one click vs. open file / select-all / copy.
- **Composability** — signature and opening phrase as independent toggles, not baked into each template.
- **Discovery** — categorised list + paste-to-match shortcut when you can't remember the exact template.

## UI direction (decided 2026-05-19)

Minimal interface modelled on the **Claude Code desktop app**:

- Very dark background (near-black, subtle warm tint).
- **Left sidebar** — category list (account / deposit / withdrawal / kyc / technical / fraud / general), plus a search box and a "+ New template" action at the top. Mirrors the Claude Code sessions sidebar.
- **Main panel** — selected template: name, body preview, the `opening` and `signature` toggle checkboxes, and a prominent "Copy" button. Generous padding, flat chrome.
- **Right panel (optional, collapsible)** — variables for the active template, with inline editors. Mirrors the Claude Code Files panel.
- **Top bar** — breadcrumb-style title (`category / template-name`), small action icons (edit, duplicate, delete).
- **Bottom input strip** — paste-to-match input + model/mode selector chip on the right, mirroring the Claude Code chat input.
- Typography: sans-serif for UI, monospace for variable names and any code/HTML in the body.
- Subtle dividers, no heavy borders, flat icons, one accent color used sparingly (e.g. the Copy button and successful-match highlights).
- No window chrome decoration beyond the standard OS title bar (or frameless if the stack makes that cheap).

This shifts the form factor away from "small floating panel" toward a **proper windowed app** — small by default (≈800×600), resizable, optionally always-on-top via a toggle. Global hotkey to summon/focus the window.

## Form factor

Decided: **windowed desktop app**, three-pane layout (sidebar / main / optional right panel), global hotkey to summon. The earlier floating-panel idea is dropped — it can't host a Claude-Code-style multi-pane UI cleanly.

## Data model (implicit)

Each template decomposes into:

- `category` — account / deposit / withdrawal / kyc / technical / fraud / general
- `name`
- `opening` (independent, toggleable)
- `body`
- `signature` (independent, toggleable)
- `variables` — list of placeholders; either prompt before copy, or copy-with-placeholders for manual fill-in

UI checkboxes for `opening` and `signature` control concatenation on copy.

## Paste-to-match mode

1. User pastes inbound message into the widget.
2. Widget sends `(pasted_text, template_catalog)` to the Anthropic Claude API.
3. Model returns ranked candidates with brief justifications.
4. User picks one; widget assembles the final reply respecting current `opening` / `signature` toggles.

Note: the existing `anthropic-skills:email` Claude skill already does the semantic-match step today without a GUI. This widget is essentially that skill behind a one-click GUI.

## Stack candidates

Each is tied to an existing project for build velocity:

- **Tauri + SvelteKit** — matches `[[compositor]]`. **Strongest fit for the Claude-Code aesthetic** — CSS does dark themes, multi-pane layouts, and flat chrome trivially, and Tauri keeps the binary small (~10 MB) without Electron's footprint. The earlier "only if UI grows beyond a panel" caveat is now resolved: the UI *did* grow beyond a panel.
- **PySide6 + ctypes** — matches `[[windows-autoclicker]]`. Achievable via QSS styling, but matching the exact Claude Code look (rounded corners, subtle hover states, smooth transitions) is more work than CSS. Still the right pick if you want to avoid a JS toolchain entirely.
- **Rust + Iced** — matches `[[terminal-switcher]]`. Iced's theming is improving but trails CSS for this aesthetic; rule out unless you specifically want Rust-only.
- **Browser side panel** — drop. The decision to go windowed makes this irrelevant.

Recommendation: **Tauri + SvelteKit**. Aesthetic fidelity is now the binding constraint, and web tech is built for this look. Fallback to PySide6 only if you'd rather not maintain a Node toolchain.

## Confidentiality constraint (important)

The Clickout Media engagement's §5 NDA is broad and survives termination. The template corpus contains customer-facing language about brand-internal processes.

- **Don't embed actual templates in a public repo.** Storage: local-only `%APPDATA%\templates-widget\` (gitignored). Optionally encrypted-at-rest if sync is desired later.
- **Paste-to-match sends inbound customer text to Anthropic.** This needs to clear the engagement's GDPR policy first. Starter-pack policies don't explicitly cover third-party LLM use. Raise with the manager before relying on cloud match for anything containing customer PII.

## Status

Idea only. No design doc, no stack decision. Closest existing capability is the `anthropic-skills:email` Claude skill.

## Open questions

- ~~Widget vs. floating app vs. side panel~~ — resolved: windowed app, Claude-Code-style three-pane layout.
- ~~Stack~~ — leaning Tauri + SvelteKit; confirm before scaffolding.
- Where do templates live? File system (`%APPDATA%\templates-widget\templates.json`), or something richer like SQLite?
- Variable-filling UX: prompt before copy, or copy-with-placeholders for manual fill-in?
- Is cloud-match worth the GDPR friction, or is folder-of-categories enough for v1?
- Does this share infrastructure with `[[paste-stack]]`? A shared global-hotkey/tray base in Tauri is feasible.

## Adjacent vault references

- `[[paste-stack]]` — clipboard manager idea (LIFO, hotkey overlay, fuzzy search). Same family. Candidate for a shared base layer with this widget.
- `[[clickout-media-engagement]]` — the day-job context that motivates the idea.
- `[[coinpoker]]` — the brand being supported (likely origin of the `coin_` repo prefix).
- `[[anthropic]]` — API provider for paste-to-match.
- `[[windows-autoclicker]]`, `[[terminal-switcher]]`, `[[compositor]]` — existing Win32 tooling whose stacks are reference points.
- `anthropic-skills:email` Claude skill — the semantic-match capability already exists CLI-side.

## Note on this repo's name

Nothing in the vault explicitly ties `coin_template_manager` to `[[templates-widget]]`. The "coin" prefix is most likely a context cue (CoinPoker work) rather than a separate project. Confirm/deny before treating this as the canonical repo for the idea — if confirmed, the vault page should bump from "idea only" to "in development" and gain a Repo section.
