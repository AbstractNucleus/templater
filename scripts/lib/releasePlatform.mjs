/**
 * Map a Tauri updater artifact filename to a platform key
 * (`windows-x86_64`, `darwin-aarch64`, …). Fail loud on ambiguity —
 * never guess arch from extension alone. Arch may appear in the
 * basename or in a parent path segment (e.g. CI artifact dirs like
 * `bundle-macos-aarch64/macos/Templater.app.tar.gz`).
 */

import { basename } from "path";

/**
 * @param {string} artifactPath
 * @returns {{ platform: string } | { error: string }}
 */
export function platformFromArtifact(artifactPath) {
  const name = basename(artifactPath).toLowerCase();
  // Full path: CI keeps arch in the artifact directory name when files
  // themselves omit it (Tauri's default Templater.app.tar.gz).
  const haystack = artifactPath.replace(/\\/g, "/").toLowerCase();

  /** @type {"windows" | "darwin" | "linux" | null} */
  let os = null;
  if (/\.(exe|msi)$/.test(name) || name.includes("nsis") || name.includes("windows")) {
    os = "windows";
  } else if (name.endsWith(".dmg") || name.includes(".app.tar.gz") || name.endsWith(".app.tar.gz")) {
    os = "darwin";
  } else if (
    name.endsWith(".appimage") ||
    name.endsWith(".deb") ||
    name.endsWith(".rpm") ||
    name.includes("linux")
  ) {
    os = "linux";
  }

  /** @type {"x86_64" | "aarch64" | null} */
  let arch = null;
  if (/aarch64|arm64/.test(haystack)) {
    arch = "aarch64";
  } else if (/x86_64|amd64|(^|[^a-z])x64([^0-9]|$)/.test(haystack)) {
    arch = "x86_64";
  }

  if (!os) {
    return { error: `cannot infer OS from artifact name: ${basename(artifactPath)}` };
  }
  if (!arch) {
    return {
      error: `cannot infer arch from artifact name (need x86_64/x64/aarch64/arm64): ${basename(artifactPath)}`,
    };
  }
  return { platform: `${os}-${arch}` };
}
