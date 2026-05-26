// Generates the latest.json manifest the in-app updater fetches.
//
// Prereqs:
//   1. Updater signing set up (see RELEASING.md).
//   2. `npm run tauri build` has been run with TAURI_SIGNING_PRIVATE_KEY set,
//      so each bundle dir contains a .sig file alongside the installer.
//
// Run: node scripts/make-release-manifest.mjs [--input-dir <path>]
//
// By default scans src-tauri/target/release/bundle/. CI overrides with
// --input-dir <downloaded-artifacts-path> when assembling the manifest from
// per-runner artifact uploads.
//
// Output: latest.json inside the input dir. Upload installers + .sig +
// latest.json to a GitHub release on the public releases repo named v<version>.
//
// Emits entries only for platforms whose artifacts are present on disk, so
// the same script works for single-platform local builds and the multi-runner
// CI flow.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

function parseArgs(argv) {
  const args = { inputDir: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--input-dir") {
      args.inputDir = argv[++i];
    }
  }
  return args;
}

const { inputDir: inputDirArg } = parseArgs(process.argv.slice(2));
const inputDir = inputDirArg
  ? (inputDirArg.startsWith("/") || /^[A-Za-z]:/.test(inputDirArg)
      ? inputDirArg
      : join(process.cwd(), inputDirArg))
  : join(root, "src-tauri/target/release/bundle");

const config = JSON.parse(
  readFileSync(join(root, "src-tauri/tauri.conf.json"), "utf8"),
);
const version = config.version;
const productName = config.productName;
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

const releaseBase = `https://github.com/${ghUser}/${ghRepo}/releases/download/v${version}`;

// Each candidate: where the installer + .sig should live, and the manifest
// platform key + URL to emit if found. Arch-specific .app.tar.gz filenames
// aren't a Tauri convention — only darwin-aarch64 is wired up since that's
// what the CI workflow currently builds. Add darwin-x86_64 by extending this
// list once the workflow includes an Intel runner.
const candidates = [
  {
    key: "windows-x86_64",
    installer: join(inputDir, "nsis", `${productName}_${version}_x64-setup.exe`),
    uploadName: `${productName}_${version}_x64-setup.exe`,
  },
  {
    key: "darwin-aarch64",
    installer: join(inputDir, "macos", `${productName}.app.tar.gz`),
    uploadName: `${productName}.app.tar.gz`,
  },
];

const platforms = {};
const found = [];
const missing = [];
for (const c of candidates) {
  const sig = `${c.installer}.sig`;
  if (existsSync(c.installer) && existsSync(sig)) {
    platforms[c.key] = {
      signature: readFileSync(sig, "utf8").trim(),
      url: `${releaseBase}/${c.uploadName}`,
    };
    found.push(c.key);
  } else {
    missing.push(c.key);
  }
}

if (found.length === 0) {
  console.error(`No installers found under ${inputDir}.`);
  console.error("Looked for:");
  for (const c of candidates) console.error(`  - ${c.installer}`);
  console.error("Did you run `npm run tauri build` with TAURI_SIGNING_PRIVATE_KEY set?");
  process.exit(1);
}

const notes = process.env.RELEASE_NOTES?.trim() || "TODO: add release notes";

const manifest = {
  version: `v${version}`,
  notes,
  pub_date: new Date().toISOString(),
  platforms,
};

const outPath = join(inputDir, "latest.json");
writeFileSync(outPath, JSON.stringify(manifest, null, 2) + "\n");
console.log(`Wrote ${outPath}`);
console.log(`Platforms: ${found.join(", ")}${missing.length ? ` (skipped: ${missing.join(", ")})` : ""}`);
console.log("");
console.log(`Upload to the v${version} release on ${ghUser}/${ghRepo}:`);
for (const c of candidates) {
  if (platforms[c.key]) {
    console.log(`  - ${c.uploadName}`);
    console.log(`  - ${c.uploadName}.sig`);
  }
}
console.log(`  - latest.json`);
