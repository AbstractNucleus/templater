/**
 * Generate `latest.json` for the Tauri updater from a directory of build
 * artifacts. Usage:
 *
 *   node scripts/make-release-manifest.mjs --input-dir <dir> --download-base-url <url>
 *
 * Scans the input directory recursively for `.sig` files, pairs each one
 * with its signed artifact, and writes `latest.json` next to the artifacts.
 * Platform keys are derived from artifact filenames (OS + arch); ambiguous
 * names fail the build instead of being silently mis-mapped.
 * Download URLs are built from --download-base-url + the artifact basename
 * (local paths are not valid for the updater).
 */

import { readFileSync, writeFileSync, readdirSync, existsSync } from "fs";
import { join, basename } from "path";
import { platformFromArtifact } from "./lib/releasePlatform.mjs";

const args = process.argv.slice(2);
const inputDirIdx = args.indexOf("--input-dir");
if (inputDirIdx === -1) {
  console.error(
    "Usage: make-release-manifest.mjs --input-dir <dir> --download-base-url <url>",
  );
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

const confPath = join(process.cwd(), "src-tauri", "tauri.conf.json");
const conf = JSON.parse(readFileSync(confPath, "utf-8"));
const version = conf.version;
const pubkey = conf.plugins?.updater?.pubkey;
if (!pubkey) {
  console.error("no plugins.updater.pubkey in tauri.conf.json");
  process.exit(1);
}

const platforms = new Map();
const errors = [];
const base = downloadBaseUrl.replace(/\/$/, "");

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
      const mapped = platformFromArtifact(artifactPath);
      if ("error" in mapped) {
        errors.push(mapped.error);
        continue;
      }
      const url = `${base}/${encodeURIComponent(basename(artifactPath))}`;
      if (platforms.has(mapped.platform)) {
        errors.push(
          `duplicate platform ${mapped.platform}: ${platforms.get(mapped.platform).url} and ${url}`,
        );
        continue;
      }
      const signature = readFileSync(sigPath, "utf-8").trim();
      platforms.set(mapped.platform, {
        signature,
        url,
      });
    }
  }
}

walk(inputDir);

if (errors.length > 0) {
  console.error("Platform mapping failed:");
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}

if (platforms.size === 0) {
  console.error("no signed artifacts found");
  process.exit(1);
}

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
