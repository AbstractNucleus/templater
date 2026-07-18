/**
 * Generate `latest.json` for the Tauri updater from a directory of build
 * artifacts. Usage:
 *
 *   node scripts/make-release-manifest.mjs --input-dir <dir>
 *
 * Scans the input directory recursively for `.sig` files, pairs each one
 * with its signed artifact, and writes `latest.json` next to the artifacts.
 * The app's updater endpoint fetches this file to check for new versions.
 */

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from "fs";
import { join, basename } from "path";

const args = process.argv.slice(2);
const inputDirIdx = args.indexOf("--input-dir");
if (inputDirIdx === -1) {
  console.error("Usage: make-release-manifest.mjs --input-dir <dir> --download-base-url <url>");
  process.exit(1);
}

const inputDir = args[inputDirIdx + 1];
if (!inputDir || !existsSync(inputDir)) {
  console.error(`input directory not found: ${inputDir}`);
  process.exit(1);
}

const downloadBaseUrlIdx = args.indexOf("--download-base-url");
const downloadBaseUrl = downloadBaseUrlIdx === -1 ? "" : args[downloadBaseUrlIdx + 1];
if (!downloadBaseUrl) {
  console.error("missing --download-base-url");
  process.exit(1);
}

// Read tauri.conf.json for the current version and pubkey.
const confPath = join(process.cwd(), "src-tauri", "tauri.conf.json");
const conf = JSON.parse(readFileSync(confPath, "utf-8"));
const version = conf.version;
const pubkey = conf.plugins?.updater?.pubkey;
if (!pubkey) {
  console.error("no plugins.updater.pubkey in tauri.conf.json");
  process.exit(1);
}

// Collect all .sig files, find the matching artifact, and build the platform map.
const platforms = new Map();
function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full);
    } else if (entry.name.endsWith(".sig")) {
      const sigPath = full;
      const artifactPath = full.slice(0, -4); // strip .sig
      if (!existsSync(artifactPath)) {
        console.warn(`  skipping ${full}: no matching artifact`);
        continue;
      }
      const signature = readFileSync(sigPath, "utf-8").trim();
      const platform = guessPlatform(artifactPath);
      if (platform) {
        platforms.set(platform, {
          signature,
          url: `${downloadBaseUrl.replace(/\/$/, "")}/${encodeURIComponent(basename(artifactPath))}`,
        });
      } else {
        console.warn(`  skipping ${artifactPath}: unknown platform`);
      }
    }
  }
}

function guessPlatform(artifactPath) {
  const name = artifactPath.toLowerCase();
  const ext = artifactPath.split(".").pop();
  const isNsis = name.includes(".exe") || name.endsWith(".exe");
  const isDmg = name.endsWith(".dmg") || name.includes(".dmg");
  const isAppTar = name.endsWith(".tar.gz") || name.endsWith(".app.tar.gz");
  const isWindows = isNsis || name.includes("x86_64");
  // We can't map every artifact to a unique platform key, but we try.
  // The updater only cares about the key matching the client's platform.
  if (isNsis && isWindows) {
    return "windows-x86_64";
  }
  if (isDmg) {
    return "darwin-aarch64";
  }
  if (isAppTar) {
    return "darwin-aarch64";
  }
  return null;
}

walk(inputDir);

const manifest = {
  version,
  pubkey,
  platforms: Object.fromEntries(platforms),
};

const outPath = join(inputDir, "latest.json");
writeFileSync(outPath, JSON.stringify(manifest, null, 2) + "\n");
console.log(`Wrote ${outPath}`);
console.log(`  version: ${version}`);
console.log(`  platforms: ${platforms.size}`);
for (const [key, val] of platforms) {
  console.log(`    ${key}: ${val.url}`);
}