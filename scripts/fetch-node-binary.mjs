// Downloads the standalone Node binary that gets bundled via Tauri's
// `externalBin` config (see src-tauri/tauri.conf.json). The binary itself is
// gitignored — running this script populates it on a fresh checkout.
//
// Auto-detects host platform/arch and fetches the matching Node distribution:
//   - Windows x64  → win-x64/node.exe       → node-x86_64-pc-windows-msvc.exe
//   - macOS arm64  → darwin-arm64 tarball   → node-aarch64-apple-darwin
//   - macOS x64    → darwin-x64 tarball     → node-x86_64-apple-darwin
//
// macOS tarballs are extracted via the host's `tar` (always present on macOS,
// and also present on Windows 10+ as bsdtar). Only the inner `bin/node` is
// kept; the rest of the tarball is discarded.
//
// Tauri picks the binary matching the build's rust target triple at bundle
// time, so we only need to fetch the host's. CI runs this on each runner.
//
// Run automatically as part of `npm run build:bundle`. Manual invocation:
//   node scripts/fetch-node-binary.mjs

import { execFileSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const NODE_VERSION = "22.11.0";

function resolveHost() {
  const { platform, arch } = process;
  if (platform === "win32" && arch === "x64") {
    return {
      target: "x86_64-pc-windows-msvc",
      filename: "node-x86_64-pc-windows-msvc.exe",
      kind: "exe",
      url: `https://nodejs.org/dist/v${NODE_VERSION}/win-x64/node.exe`,
    };
  }
  if (platform === "darwin" && arch === "arm64") {
    const dir = `node-v${NODE_VERSION}-darwin-arm64`;
    return {
      target: "aarch64-apple-darwin",
      filename: "node-aarch64-apple-darwin",
      kind: "tarball",
      url: `https://nodejs.org/dist/v${NODE_VERSION}/${dir}.tar.gz`,
      innerPath: `${dir}/bin/node`,
    };
  }
  if (platform === "darwin" && arch === "x64") {
    const dir = `node-v${NODE_VERSION}-darwin-x64`;
    return {
      target: "x86_64-apple-darwin",
      filename: "node-x86_64-apple-darwin",
      kind: "tarball",
      url: `https://nodejs.org/dist/v${NODE_VERSION}/${dir}.tar.gz`,
      innerPath: `${dir}/bin/node`,
    };
  }
  throw new Error(`unsupported host: ${platform}/${arch}`);
}

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const targetDir = join(root, "src-tauri", "binaries");

const host = resolveHost();
const target = join(targetDir, host.filename);

if (existsSync(target)) {
  console.log(`node binary already present at ${target}`);
  process.exit(0);
}

mkdirSync(targetDir, { recursive: true });
console.log(`fetching ${host.url}…`);
const res = await fetch(host.url);
if (!res.ok) {
  console.error(`download failed: ${res.status} ${res.statusText}`);
  process.exit(1);
}
const buf = Buffer.from(await res.arrayBuffer());

if (host.kind === "exe") {
  writeFileSync(target, buf);
  console.log(`saved ${buf.length.toLocaleString()} bytes to ${target}`);
} else {
  // Extract <innerPath> from the tarball via the host's tar. Using a temp
  // dir keeps the rest of the tarball's contents from leaking into the repo.
  const work = mkdtempSync(join(tmpdir(), "node-fetch-"));
  const tarball = join(work, "node.tar.gz");
  writeFileSync(tarball, buf);
  try {
    execFileSync("tar", ["-xzf", tarball, "-C", work, host.innerPath], {
      stdio: "inherit",
    });
    renameSync(join(work, host.innerPath), target);
    chmodSync(target, 0o755);
    console.log(`saved ${target}`);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}
