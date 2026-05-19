# Templates Widget — Project Idea

Source: synthesized from Obsidian vault on 2026-05-19. The vault page is `[[templates-widget]]` (promoted 2026-05-19). This file captures everything the vault has about the idea so the repo can stand alone.

## Original capture (verbatim, 2026-05-19)

> I have an idea about either a widget or an app that I can use for my work and just have it open beside me. It will have categorized templates that are like one-click copy, and checkboxes to choose if it should include the signature or opening phrases. You could also have a system where you paste an input and it will use cloud to try and find a matching template.

## Why

Day job = customer support for CoinPoker via the Clickout Media engagement (email + chat, Mon–Fri, output-based, global player base). Templates are the daily compression layer. A dedicated widget beats a folder of `.txt` files on three axes:

- **Latency** — one click vs. open file / select-all / copy.
- **Composability** — signature and opening phrase as independent toggles, not baked into each template.
- **Discovery** — categorised list + paste-to-match shortcut when you can't remember the exact template.

## Form factor (unresolved)

Four candidates, no decision yet:

| Form factor | Pros | Cons |
|---|---|---|
| Windows 11 widget | Native feel, dockable | Widget API is limited |
| Always-on-top floating panel | Most flexible, matches existing tooling style | Manual placement |
| Tray app + popover | Out of the way until needed | Extra click to summon |
| Browser side panel | Lowest effort if helpdesk lives in browser | Tied to browser session |

Default lean: small native floating panel with a global hotkey (matches the pattern from `[[windows-autoclicker]]` and `[[terminal-switcher]]`).

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

- **PySide6 + ctypes** — matches `[[windows-autoclicker]]`. Dark theme proven, easy Anthropic SDK call.
- **Rust + Iced** — matches `[[terminal-switcher]]`. Smaller binary, global hotkey + tray icon already solved.
- **Tauri + SvelteKit** — matches `[[compositor]]`. Only worth it if UI grows beyond a panel.
- **Browser side panel** — lowest effort if helpdesk lives in browser.

Tie-breaker: PySide6 or Iced ship in a weekend if signature/opening checkboxes are the whole UI. Tauri only if paste-to-match grows into a multi-pane workflow.

## Confidentiality constraint (important)

The Clickout Media engagement's §5 NDA is broad and survives termination. The template corpus contains customer-facing language about brand-internal processes.

- **Don't embed actual templates in a public repo.** Storage: local-only `%APPDATA%\templates-widget\` (gitignored). Optionally encrypted-at-rest if sync is desired later.
- **Paste-to-match sends inbound customer text to Anthropic.** This needs to clear the engagement's GDPR policy first. Starter-pack policies don't explicitly cover third-party LLM use. Raise with the manager before relying on cloud match for anything containing customer PII.

## Status

Idea only. No design doc, no stack decision. Closest existing capability is the `anthropic-skills:email` Claude skill.

## Open questions

- Widget vs. floating app vs. side panel — decide before stack.
- Where do templates live? File system, Supabase, something else?
- Variable-filling UX: prompt before copy, or copy-with-placeholders?
- Is cloud-match worth the GDPR friction, or is folder-of-categories enough?
- Does this share infrastructure with `[[paste-stack]]` (clipboard manager, also hotkey-triggered)? A unified "desk-side overlay" base might serve both.

## Adjacent vault references

- `[[paste-stack]]` — clipboard manager idea (LIFO, hotkey overlay, fuzzy search). Same family. Candidate for a shared base layer with this widget.
- `[[clickout-media-engagement]]` — the day-job context that motivates the idea.
- `[[coinpoker]]` — the brand being supported (likely origin of the `coin_` repo prefix).
- `[[anthropic]]` — API provider for paste-to-match.
- `[[windows-autoclicker]]`, `[[terminal-switcher]]`, `[[compositor]]` — existing Win32 tooling whose stacks are reference points.
- `anthropic-skills:email` Claude skill — the semantic-match capability already exists CLI-side.

## Note on this repo's name

Nothing in the vault explicitly ties `coin_template_manager` to `[[templates-widget]]`. The "coin" prefix is most likely a context cue (CoinPoker work) rather than a separate project. Confirm/deny before treating this as the canonical repo for the idea — if confirmed, the vault page should bump from "idea only" to "in development" and gain a Repo section.
