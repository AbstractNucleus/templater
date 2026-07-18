/**
 * Map a Tauri updater artifact filename to a platform key
 * (`windows-x86_64`, `darwin-aarch64`, …). Fail loud on ambiguity —
 * never guess arch from extension alone.
 */

import { basename } from "path";

/**
 * @param {string} artifactPath
 * @returns {{ platform: string } | { error: string }}
 */
export function platformFromArtifact(artifactPath) {
  const name = basename(artifactPath).toLowerCase();

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
  if (/aarch64|arm64/.test(name)) {
    arch = "aarch64";
  } else if (/x86_64|amd64|(^|[^a-z])x64([^0-9]|$)/.test(name)) {
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
