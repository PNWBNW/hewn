import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BRAND, CREDIT } from "@pnw/brand";
import { FRONTEND_DIST, tauriConfig, tauriConfigText, updateEndpoint } from "./tauri_config";

const SRC_TAURI = join(import.meta.dirname, "..", "src-tauri");
const committed = readFileSync(join(SRC_TAURI, "tauri.conf.json"), "utf8");

describe("tauri.conf.json", () => {
  it("is what @pnw/brand makes (node scripts/tauri_config.mjs --write)", () => {
    expect(committed).toBe(tauriConfigText());
  });

  it("names the product, its identifier and its update key from the brand only", () => {
    const config = tauriConfig();
    expect(config.productName).toBe(BRAND.name);
    expect(config.identifier).toBe(BRAND.desktop.id);
    expect(config.app.windows[0]!.title).toBe(BRAND.name);
    expect(config.plugins.updater.pubkey).toBe(BRAND.desktop.updateKey);
    expect(config.bundle.copyright).toBe(CREDIT.copyright);
    // A fork that changes the brand gets its own app, end to end.
    const fork = tauriConfig({ ...BRAND, name: "Fork", desktop: { id: "org.example.fork", updateKey: "KEY" }, sourceUrl: "https://example.org/fork" });
    expect(fork.productName).toBe("Fork");
    expect(fork.identifier).toBe("org.example.fork");
    expect(fork.plugins.updater.pubkey).toBe("KEY");
    expect(fork.plugins.updater.endpoints).toEqual(["https://example.org/fork/releases/latest/download/latest.json"]);
  });

  it("takes updates from the source repository's releases, over https", () => {
    expect(updateEndpoint("https://github.com/PNWBNW/hewn")).toBe("https://github.com/PNWBNW/hewn/releases/latest/download/latest.json");
    expect(updateEndpoint("https://github.com/PNWBNW/hewn/")).toBe("https://github.com/PNWBNW/hewn/releases/latest/download/latest.json");
    for (const endpoint of tauriConfig().plugins.updater.endpoints) expect(endpoint.startsWith("https://")).toBe(true);
  });

  it("insists the signature names its version, and loosens nothing", () => {
    const updater = tauriConfig().plugins.updater as Record<string, unknown>;
    expect(updater.requireSignedVersion).toBe(true);
    for (const key of Object.keys(updater)) expect(key.toLowerCase()).not.toContain("dangerous");
  });

  it("gives the pages nothing to call and adds no policy of its own", () => {
    const { app } = tauriConfig();
    expect(app.security.capabilities).toEqual([]);
    expect(app.security.csp).toBeNull();
    expect(app.withGlobalTauri).toBe(false);
    expect(app.windows).toHaveLength(1);
    // The same secure origin on Windows as elsewhere, fixed from the first release.
    expect(app.windows[0]!.useHttpsScheme).toBe(true);
    expect(app.windows[0]!.devtools).toBe(false);
  });

  it("keeps the update key out of CI: no update packages are made by the build", () => {
    expect(tauriConfig().bundle.createUpdaterArtifacts).toBe(false);
  });

  it("carries the static bundle", () => {
    expect(tauriConfig().build.frontendDist).toBe(FRONTEND_DIST);
    expect(join(SRC_TAURI, FRONTEND_DIST)).toBe(join(SRC_TAURI, "..", "..", "business", "out"));
  });

  it("asks for no capability files: the folder that would grant them does not exist", () => {
    expect(() => readFileSync(join(SRC_TAURI, "capabilities", "default.json"))).toThrow();
  });
});
