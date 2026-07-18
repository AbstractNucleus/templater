import { describe, expect, it } from "vitest";
import { platformFromArtifact } from "../../scripts/lib/releasePlatform.mjs";

describe("platformFromArtifact", () => {
  it("maps Windows NSIS with arch", () => {
    expect(platformFromArtifact("Templater_0.9.2_x64-setup.exe")).toEqual({
      platform: "windows-x86_64",
    });
    expect(platformFromArtifact("Templater_0.9.2_x86_64-setup.exe")).toEqual({
      platform: "windows-x86_64",
    });
  });

  it("maps Darwin dmg/app.tar.gz by arch in the name", () => {
    expect(platformFromArtifact("Templater_0.9.2_aarch64.dmg")).toEqual({
      platform: "darwin-aarch64",
    });
    expect(platformFromArtifact("Templater_aarch64.app.tar.gz")).toEqual({
      platform: "darwin-aarch64",
    });
    expect(platformFromArtifact("Templater_x86_64.app.tar.gz")).toEqual({
      platform: "darwin-x86_64",
    });
  });

  it("maps Darwin app.tar.gz by arch in a parent path segment", () => {
    expect(
      platformFromArtifact("artifacts/bundle-macos-aarch64/macos/Templater.app.tar.gz"),
    ).toEqual({ platform: "darwin-aarch64" });
    expect(
      platformFromArtifact("artifacts\\bundle-macos-aarch64\\macos\\Templater.app.tar.gz"),
    ).toEqual({ platform: "darwin-aarch64" });
  });

  it("fails loud when arch is missing (no silent darwin-aarch64 default)", () => {
    expect(platformFromArtifact("Templater.dmg")).toMatchObject({ error: expect.any(String) });
    expect(platformFromArtifact("Templater.app.tar.gz")).toMatchObject({
      error: expect.any(String),
    });
    expect(platformFromArtifact("artifacts/macos/Templater.app.tar.gz")).toMatchObject({
      error: expect.any(String),
    });
  });

  it("does not treat x86_64 alone as Windows", () => {
    expect(platformFromArtifact("something_x86_64.tar.gz")).toMatchObject({
      error: expect.any(String),
    });
  });
});
