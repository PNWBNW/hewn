// The editions the app pins are the ones the Leo programs' repository records as on chain, and
// every program the admin key could upgrade is pinned. Reads the submodule (pnw_mvp_v2).

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { EDITIONS, EXTERNAL_EDITIONS, OUR_EDITIONS, PROGRAMS } from "./programs";

const LEO = join(__dirname, "..", "..", "..", "pnw_mvp_v2");
const MANIFEST = join(LEO, "config", "testnet.manifest.json");
const here = existsSync(MANIFEST);

const ours = (): string[] => {
  const { network: _network, external: _external, ...groups } = PROGRAMS;
  return Object.values(groups).flatMap((g) => Object.values(g));
};

/** The program's source, wherever it lives in the Leo repository, or null (a dated snapshot folder isn't the program's own). */
const source = (program: string): string | null => {
  for (const folder of ["src/layer1", "src/layer2", "src/layer1/archive", "src/layer2/archive"]) {
    const file = join(LEO, folder, program, "src", "main.leo");
    if (existsSync(file)) return readFileSync(file, "utf8");
  }
  return null;
};

describe("the pinned editions", () => {
  it("has the Leo programs' repository to check against, at least in CI", () => {
    if (process.env.CI) expect(here, "the pnw_mvp_v2 submodule isn't checked out").toBe(true);
  });

  it.skipIf(!here)("are the editions the manifest records as on chain", () => {
    const deployments = JSON.parse(readFileSync(MANIFEST, "utf8")).deployments as Record<string, { edition?: number }>;
    for (const [program, accepted] of Object.entries(OUR_EDITIONS)) {
      expect(accepted.length, program).toBeGreaterThan(0);
      expect(accepted, `${program}: the manifest says edition ${deployments[program]?.edition}`).toContain(deployments[program]?.edition);
    }
  });

  it.skipIf(!here)("cover every program the admin key can upgrade, and no program that can't change", () => {
    const upgradable = ours().filter((p) => source(p)?.includes("@admin"));
    expect(upgradable.length).toBeGreaterThan(0);
    expect(Object.keys(OUR_EDITIONS).sort()).toEqual([...upgradable].sort());
  });
});

describe("the stablecoin's pinned editions", () => {
  it("cover every outside program the app names, with at least one edition each", () => {
    expect(Object.keys(EXTERNAL_EDITIONS).sort()).toEqual(Object.values(PROGRAMS.external).sort());
    for (const accepted of Object.values(EXTERNAL_EDITIONS)) expect(accepted.length).toBeGreaterThan(0);
  });

  it("are checked with ours before every signature", () => {
    for (const program of [...Object.keys(OUR_EDITIONS), ...Object.keys(EXTERNAL_EDITIONS)]) expect(EDITIONS[program], program).toBeDefined();
  });
});
