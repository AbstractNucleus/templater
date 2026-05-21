// Downloads the standalone Node.exe binary that gets bundled via Tauri's
// `externalBin` config (see src-tauri/tauri.conf.json). The binary itself is
// gitignored — running this script populates it on a fresh checkout.
//
// Run automatically as part of `npm run build:bundle`. Manual invocation:
//   node scripts/fetch-node-binary.mjs

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const NODE_VERSION = "22.11.0";
const URL = `https://nodejs.org/dist/v${NODE_VERSION}/win-x64/node.exe`;

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const targetDir = join(root, "src-tauri", "binaries");
const target = join(targetDir, "node-x86_64-pc-windows-msvc.exe");

if (existsSync(target)) {
  console.log(`node binary already present at ${target}`);
  process.exit(0);
}

mkdirSync(targetDir, { recursive: true });
console.log(`fetching ${URL}…`);
const res = await fetch(URL);
if (!res.ok) {
  console.error(`download failed: ${res.status} ${res.statusText}`);
  process.exit(1);
}
const buf = Buffer.from(await res.arrayBuffer());
writeFileSync(target, buf);
console.log(`saved ${buf.length.toLocaleString()} bytes to ${target}`);
