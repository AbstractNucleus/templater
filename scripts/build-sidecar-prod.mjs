// Build a devDeps-pruned, production-only copy of the sidecar at
// sidecar/prod-bundle/. The Tauri bundler ships this directory as the
// runtime sidecar; src-tauri/src/sidecar.rs resolves the script via
// `_up_/sidecar/prod-bundle/dist/index.js`.
//
// We do NOT mutate sidecar/node_modules in place because that would break
// the next `npm run tauri dev` (which uses devDeps like tsx + typescript).
// Building into a sibling directory and running `npm ci --omit=dev` there
// keeps the dev tree untouched.
//
// Run via `npm run build:sidecar:prod` or transitively as part of the
// `tauri build` pipeline (see package.json build:bundle).

import { execSync } from "node:child_process";
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  rmSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const sidecar = join(root, "sidecar");
const prod = join(sidecar, "prod-bundle");

function run(cmd, cwd) {
  console.log(`$ ${cmd}  (cwd: ${cwd})`);
  execSync(cmd, { cwd, stdio: "inherit" });
}

// 1) Compile the TypeScript sidecar — `tsc` lives in the dev tree, not the
// pruned bundle, so we run it against the dev sidecar first.
if (!existsSync(join(sidecar, "node_modules"))) {
  run("npm install --no-audit --no-fund", sidecar);
}
run("npm run build", sidecar);

// 2) Stage a clean prod copy.
rmSync(prod, { recursive: true, force: true });
mkdirSync(prod, { recursive: true });
cpSync(join(sidecar, "dist"), join(prod, "dist"), { recursive: true });
copyFileSync(join(sidecar, "package.json"), join(prod, "package.json"));
copyFileSync(join(sidecar, "package-lock.json"), join(prod, "package-lock.json"));

// 3) Install only production deps into the staged copy. `npm ci` against
// the lockfile yields a reproducible tree without touching anything in
// sidecar/.
run("npm ci --omit=dev --no-audit --no-fund", prod);

console.log(`built sidecar prod bundle at ${prod}`);
