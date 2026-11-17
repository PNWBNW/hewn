import { afterEach, describe, expect, it, vi } from "vitest";

// A release build names the static bundle by its commit (scripts/release/README.md): Next.js's
// build id lands in file paths and in every page, so a random one would make two builds of one
// commit differ. next.config.ts takes it from HEWN_BUILD_ID, for the static build only.

const COMMIT = "c".repeat(40);

async function config(env: Record<string, string | undefined>) {
  vi.resetModules();
  for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
  return (await import("../next.config")).default;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("the static build's id", () => {
  it("is the commit a release build passes, and the version shown while the books open", async () => {
    const c = await config({ HEWN_STATIC: "1", HEWN_BUILD_ID: COMMIT, VERCEL_GIT_COMMIT_SHA: undefined });
    expect(await c.generateBuildId?.()).toBe(COMMIT);
    expect(c.env?.NEXT_PUBLIC_HEWN_BUILD).toBe(COMMIT.slice(0, 7));
  });

  it("is left to Next.js when none is given", async () => {
    const c = await config({ HEWN_STATIC: "1", HEWN_BUILD_ID: undefined });
    expect(await c.generateBuildId?.()).toBeNull();
  });

  it("refuses anything but a 40-hex commit", async () => {
    await expect(config({ HEWN_STATIC: "1", HEWN_BUILD_ID: "../../evil" })).rejects.toThrow(/40-hex/);
  });

  it("doesn't touch the website build", async () => {
    const c = await config({ HEWN_STATIC: undefined, HEWN_BUILD_ID: COMMIT });
    expect(c.generateBuildId).toBeUndefined();
  });
});
