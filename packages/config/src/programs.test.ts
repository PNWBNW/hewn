// The editions the app pins are the ones the Leo programs' repository records as on chain, and
// every program the admin key could upgrade is pinned. Reads the submodule (pnw_mvp_v2).
// And every program the app names has its address listed, as the SDK derives it from the id.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Address } from "@provablehq/sdk";
import { EDITIONS, EXTERNAL_EDITIONS, NATIVE_PROGRAM, OUR_EDITIONS, PROGRAMS, PROGRAM_ADDRESSES, isProgramAddress } from "./programs";

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

describe("the programs' addresses", () => {
  /** Every program id the app names: each group of PROGRAMS, and the network's own program. */
  const named = (): string[] => {
    const { network: _network, ...groups } = PROGRAMS;
    return [...Object.values(groups).flatMap((g) => Object.values(g)), NATIVE_PROGRAM];
  };

  it("list every program the app names, and nothing else", () => {
    expect(Object.keys(PROGRAM_ADDRESSES).sort()).toEqual([...new Set(named())].sort());
  });

  it("are the addresses the SDK derives from each program's id", () => {
    for (const program of named()) {
      expect(PROGRAM_ADDRESSES[program], program).toBe(Address.fromProgramId(program).to_string());
    }
  });

  it("are told from an account's", () => {
    for (const address of Object.values(PROGRAM_ADDRESSES)) expect(isProgramAddress(address)).toBe(true);
    expect(new Set(Object.values(PROGRAM_ADDRESSES)).size).toBe(named().length);
    expect(isProgramAddress("aleo1kypwp5m7qtk9mwazgcpg0tq8aal23mnrvwfvug65qgcg9xvsrqgspyjm6n")).toBe(false);
    expect(isProgramAddress("")).toBe(false);
  });
});
