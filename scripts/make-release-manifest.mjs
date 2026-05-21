// Generates the latest.json manifest the in-app updater fetches.
//
// Prereqs:
//   1. Updater signing set up (see IDEA.md § Releasing).
//   2. `npm run tauri build` has been run with TAURI_SIGNING_PRIVATE_KEY set,
//      so the bundle dir contains a .sig file alongside the installer.
//
// Run: node scripts/make-release-manifest.mjs
//
// Output: latest.json next to the installer. Upload installer + .sig +
// latest.json to a GitHub release on the public releases repo named v<version>.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

const config = JSON.parse(
  readFileSync(join(root, "src-tauri/tauri.conf.json"), "utf8"),
);
const version = config.version;
const endpoint = config?.plugins?.updater?.endpoints?.[0];
if (!endpoint) {
  console.error("No updater endpoint configured in tauri.conf.json.");
  process.exit(1);
}

// Endpoint looks like:
//   https://github.com/<user>/<repo>/releases/latest/download/latest.json
// We derive the per-release download URL from the same repo.
const ENDPOINT_RE =
  /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/releases\/latest\/download\/latest\.json$/;
const m = endpoint.match(ENDPOINT_RE);
if (!m) {
  console.error(
    `Updater endpoint doesn't match the expected GitHub releases pattern:\n  ${endpoint}`,
  );
  process.exit(1);
}
const [, ghUser, ghRepo] = m;

const nsisDir = join(root, "src-tauri/target/release/bundle/nsis");
const installerName = `templates-widget_${version}_x64-setup.exe`;
const installerPath = join(nsisDir, installerName);
// Tauri 2 emits the .sig next to the installer as `<installer>.sig`.
const sigPath = installerPath + ".sig";

if (!existsSync(installerPath)) {
  console.error(`Installer not found:\n  ${installerPath}`);
  console.error("Run `npm run tauri build` first.");
  process.exit(1);
}
if (!existsSync(sigPath)) {
  console.error(`Signature not found:\n  ${sigPath}`);
  console.error("Did you set TAURI_SIGNING_PRIVATE_KEY before building?");
  console.error("See IDEA.md § Releasing for the keypair setup.");
  process.exit(1);
}

const signature = readFileSync(sigPath, "utf8").trim();

// Allow the caller to set release notes via env var; otherwise leave a
// placeholder the maintainer is reminded to overwrite when posting.
const notes = process.env.RELEASE_NOTES?.trim() || "TODO: add release notes";

const manifest = {
  version: `v${version}`,
  notes,
  pub_date: new Date().toISOString(),
  platforms: {
    "windows-x86_64": {
      signature,
      url: `https://github.com/${ghUser}/${ghRepo}/releases/download/v${version}/${installerName}`,
    },
  },
};

const outPath = join(nsisDir, "latest.json");
writeFileSync(outPath, JSON.stringify(manifest, null, 2) + "\n");
console.log(`Wrote ${outPath}`);
console.log("");
console.log(`Upload these three files to the v${version} release on ${ghUser}/${ghRepo}:`);
console.log(`  - ${installerName}`);
console.log(`  - ${installerName}.sig`);
console.log(`  - latest.json`);
