# Releasing

How a new version reaches the friend's "Check for updates" button. The flow has a one-time setup (signing key, public releases repo) and a per-release loop (bump version, build, upload, manifest).

## One-time setup

### 1. Create the public releases repo

The friend's app fetches updates from a *separate* GitHub repo that's public, so this private source repo stays private. By convention: `templater-releases`.

```powershell
# Create the empty public repo via the gh CLI:
gh repo create AbstractNucleus/templater-releases --public --description "Public release artifacts for Templater"
```

The repo's URL is baked into [`src-tauri/tauri.conf.json`](./src-tauri/tauri.conf.json) → `plugins.updater.endpoints`. If you choose a different name, update it there.

> An empty repo can't be tagged — `gh release create` fails with "Repository is empty." Seed it with one commit (a README is easiest) before your first release. Either pass `--add-readme` on `gh repo create`, or after the fact:
> ```powershell
> $b64 = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes("# Templater — releases`n"))
> gh api -X PUT repos/AbstractNucleus/templater-releases/contents/README.md -f message="Initial commit" -f content="$b64"
> ```

### 2. Generate a Tauri signing keypair

The updater plugin verifies every downloaded installer against a public key embedded in the app. Generate the keypair once and keep the private half safe.

```powershell
# `--ci` skips the passphrase prompt; `-p ""` sets an empty passphrase (the
# file itself is the secret). Use a real passphrase if you'd rather; just
# remember to export TAURI_SIGNING_PRIVATE_KEY_PASSWORD with that value when
# building.
npx tauri signer generate -w "$env:USERPROFILE\.tauri\templater.key" -p "" -f --ci
```

The command writes the keypair to `~/.tauri/templater.key` (private) and `~/.tauri/templater.key.pub` (public), and prints the public key to stdout. Open `src-tauri/tauri.conf.json` and replace the `REPLACE_WITH_TAURI_PUBLIC_KEY_FROM_KEYPAIR_GENERATION` placeholder with the public key contents (single line, base64).

The bundler triggers signing only when the **private key contents** are in the `TAURI_SIGNING_PRIVATE_KEY` env var (not the path — `_PATH` is documented but didn't actually trigger signing in the Tauri 2.11 builds I tested):

```powershell
# Set per shell before building. Persist via your PowerShell $PROFILE if you
# ship often.
$env:TAURI_SIGNING_PRIVATE_KEY = Get-Content "$env:USERPROFILE\.tauri\templater.key" -Raw
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = ""  # omit / leave empty if no passphrase
```

> **Back up `templater.key` somewhere off-machine** (encrypted USB, password manager). If your dev machine dies, recovering this file means recovering update auth for every installed app. Without it, the only way to fix a broken update channel is to ship a new pubkey and have every user re-install from scratch.

### 3. Verify the updater wiring builds cleanly

`src-tauri/tauri.conf.json` should have `bundle.createUpdaterArtifacts: true` — without that flag the bundler skips the `.sig` step even when the env vars are set.

```powershell
npm run tauri build
```

Should produce a `.sig` file alongside the installer at `src-tauri/target/release/bundle/nsis/Templater_*_x64-setup.exe.sig`. The build output will say `Finished N updater signatures at:` near the end. If you don't see that line, double-check the env var from step 2 and the `createUpdaterArtifacts` flag.

## Per-release loop

### 1. Bump the version

Three files have to agree:

```powershell
# Edit these — increment in lockstep, e.g. 0.1.0 → 0.1.1:
#   src-tauri/tauri.conf.json   → "version": "0.1.1"
#   src-tauri/Cargo.toml        → version = "0.1.1"
#   package.json                → "version": "0.1.1"
```

### 2. Build the signed installer

```powershell
npm run tauri build
```

Produces, among other things:

- `src-tauri/target/release/bundle/nsis/Templater_<v>_x64-setup.exe` — the installer
- `src-tauri/target/release/bundle/nsis/Templater_<v>_x64-setup.exe.sig` — the signature

### 3. Generate the update manifest

```powershell
# Optional: set RELEASE_NOTES so they show in the in-app updater dialog.
$env:RELEASE_NOTES = "Fix paste-match retries; add Korean keyboard hotkey."
npm run release:manifest
```

Writes `target/release/bundle/nsis/latest.json` with the version, release notes, signature, and the URL the updater will fetch from on the public releases repo.

### 4. Publish to the public releases repo

```powershell
# From the project root, with the gh CLI authenticated:
$VERSION = "0.1.1"
$NSIS = "src-tauri/target/release/bundle/nsis"

gh release create "v$VERSION" `
  --repo AbstractNucleus/templater-releases `
  --title "v$VERSION" `
  --notes "$env:RELEASE_NOTES" `
  "$NSIS/Templater_${VERSION}_x64-setup.exe" `
  "$NSIS/Templater_${VERSION}_x64-setup.exe.sig" `
  "$NSIS/latest.json"
```

GitHub serves the latest release's assets under `releases/latest/download/<filename>`, which is the URL the updater plugin hits. Done.

> If a network blip drops the upload mid-flight, `gh release create` leaves a draft release with partial assets and exits non-zero. Recover with `gh release upload v$VERSION --repo … <missing-files>` to fill in what's missing, then `gh release edit v$VERSION --repo … --draft=false --latest` to publish.

### 5. (Optional) Tell the friend

The friend will see the update next time they open Settings → Updates → Check for updates. If you want them to know sooner, message them.

## Rollback

If a release ships a bad version: delete the GitHub release (or change the `latest` pointer to a previous tag). The updater plugin checks "latest" each time, so removing the newest release makes the previous one current. Already-installed clients aren't rolled back automatically — they keep running the bad version until they take an explicit downgrade action (which the plugin doesn't support out of the box).

Mitigation: test each release locally before publishing.

## What the friend sees

1. Open Settings.
2. Scroll to **Updates**. Current version displayed.
3. Click **Check for updates**.
4. If a newer version is on the releases repo: version + release notes shown, **Install & restart** button.
5. Click it → installer downloads, signature verified against the embedded pubkey, NSIS installer runs, app relaunches on the new version.

If they're on the latest version, they see "You're on the latest version." That's it.
