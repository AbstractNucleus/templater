# Releasing

Releases are driven by [`.github/workflows/release.yml`](./.github/workflows/release.yml).
Push a `v*` tag that matches the Tauri version; the workflow builds signed
Windows and macOS artifacts, generates `latest.json`, and publishes everything
to `AbstractNucleus/templater-releases`.

## One-time setup

- The public releases repo exists: `AbstractNucleus/templater-releases`.
- [`src-tauri/tauri.conf.json`](./src-tauri/tauri.conf.json) points
  `plugins.updater.endpoints[0]` at
  `https://github.com/AbstractNucleus/templater-releases/releases/latest/download/latest.json`.
- `src-tauri/tauri.conf.json` has `bundle.createUpdaterArtifacts: true`.
- A Tauri updater signing keypair exists, and the public key is embedded in
  `plugins.updater.pubkey`.
- The source repo has these GitHub Actions secrets:
  - `TAURI_SIGNING_PRIVATE_KEY`: private key file contents, not a file path
  - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`: passphrase, or empty if unused
  - `RELEASES_REPO_TOKEN`: fine-grained PAT with `Contents: write` on the public releases repo

Generate the signing keypair once:

```powershell
npx tauri signer generate -w "$env:USERPROFILE\.tauri\templater.key" -p "" -f --ci
```

Back up `templater.key` off-machine. Losing it means existing installs cannot
trust future update artifacts signed with a replacement key.

## Release

1. Choose the next version, for example `0.4.1`.
2. Update these in lockstep:
   - [`package.json`](./package.json)
   - [`src-tauri/tauri.conf.json`](./src-tauri/tauri.conf.json)
   - [`src-tauri/Cargo.toml`](./src-tauri/Cargo.toml)
   - [`CHANGELOG.md`](./CHANGELOG.md)
3. Verify locally:

```powershell
npm test
npm run check
```

4. If release plumbing changed, also run a signed local build:

```powershell
$env:TAURI_SIGNING_PRIVATE_KEY = Get-Content "$env:USERPROFILE\.tauri\templater.key" -Raw
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = ""
npm run tauri build
```

5. Commit the version changes, then push the branch and matching tag:

```powershell
git push origin HEAD
git tag v0.4.1
git push origin v0.4.1
```

6. Watch the `Release` workflow. On success, the public release should contain:
   - Windows NSIS installer and `.sig`
   - macOS app tarball and `.sig`
   - macOS DMG
   - `latest.json`

The workflow generates `latest.json` with
`node scripts/make-release-manifest.mjs --input-dir artifacts`. Do not create or
upload the manifest manually unless you are recovering a failed release.

## Recovery

If the workflow fails because the tag does not match
`src-tauri/tauri.conf.json`, fix either the version or the tag and rerun the
release from a matching `v<version>` tag.

If publishing only partially succeeds, rerun the workflow after fixing the
underlying issue. When the public release already exists, the workflow uploads
assets with `--clobber`.

If a bad version ships, prefer releasing a fixed patch. If you must stop future
updates from seeing the bad version, delete the bad public release or mark a
previous release as latest. Already-installed clients are not automatically
downgraded.
