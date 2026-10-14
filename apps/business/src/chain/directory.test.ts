import { describe, expect, it } from "vitest";
import { computeNameHash } from "@pnw/records/registry/name_registry";
import {
  DirectoryError,
  type DirectoryReads,
  bareDirectoryName,
  entryLabel,
  lookup,
  lookupAddress,
  lookupName,
  queryEmployerSuffix,
  requireKind,
} from "./directory";

const BIZ = "aleo1kypwp5m7qtk9mwazgcpg0tq8aal23mnrvwfvug65qgcg9xvsrqgspyjm6n";
const PERSON = "aleo1rhgdu77hgyqd3xjj8ucu3jj9r2krwz6mnzyd80gncr5fxcwlh5rsvzp9px";
const DAYCO = computeNameHash("dayco");
const ANA = computeNameHash("ana");

/** A small registry: dayco is a business (BUILD, approved), ana is a person. */
const reads = (over: Partial<DirectoryReads> = {}): DirectoryReads => ({
  nameOwner: async (h) => (h === DAYCO ? BIZ : h === ANA ? PERSON : null),
  nameKind: async (h) => (h === DAYCO ? 2 : h === ANA ? 1 : null),
  namePlaintext: async (h) => (h === DAYCO ? "dayco" : h === ANA ? "ana" : null),
  workerName: async (a) => (a === PERSON ? `${ANA}field` : null),
  employerName: async (a) => (a === BIZ ? DAYCO : null),
  employerSuffix: async (h) => (h === DAYCO ? 9 : null),
  verified: async (a) => a === BIZ,
  ...over,
});

describe("typing a name", () => {
  it("accepts any case, an @, and the display suffix or the old one", () => {
    expect(bareDirectoryName(" Dayco.HEWN ", "hewn")).toBe("dayco");
    expect(bareDirectoryName("@dayco", "hewn")).toBe("dayco");
    expect(bareDirectoryName("dayco.pnw", "hewn")).toBe("dayco");
    expect(bareDirectoryName("dayco", "hewn")).toBe("dayco");
    expect(bareDirectoryName("dayco.hewn.hewn", "hewn")).toBe("dayco.hewn");
    expect(bareDirectoryName("  ", "hewn")).toBe("");
  });
});

describe("lookupName", () => {
  it("finds a business with its industry and approval", async () => {
    expect(await lookupName("dayco.hewn", "hewn", reads())).toEqual({
      name: "dayco",
      nameHash: DAYCO,
      address: BIZ,
      kind: "business",
      industryCode: 9,
      industry: "Building & Construction",
      approved: true,
    });
  });

  it("finds a person, with no business fields", async () => {
    expect(await lookupName("Ana", "hewn", reads())).toEqual({ name: "ana", nameHash: ANA, address: PERSON, kind: "worker" });
  });

  it("says a business that isn't approved yet can't send offers", async () => {
    const r = reads({ verified: async () => false });
    expect((await lookupName("dayco", "hewn", r)).approved).toBe(false);
  });

  it("says plainly when nobody has the name, and asks for an exact spelling", async () => {
    await expect(lookupName("nobody", "hewn", reads())).rejects.toThrow("No one has registered nobody.hewn. Names have to match exactly; check the spelling");
  });

  it("refuses what can't be a name before asking the registry", async () => {
    let asked = false;
    const r = reads({ nameOwner: async () => ((asked = true), null) });
    for (const bad of ["ab", "has space", "a".repeat(17), "dash-ed", "dayco.hewn.x!"]) {
      await expect(lookupName(bad, "hewn", r)).rejects.toThrow(DirectoryError);
    }
    await expect(lookupName("   ", "hewn", r)).rejects.toThrow(/name or an account/);
    expect(asked).toBe(false);
  });

  it("falls back to the owner's own primary name when the kind mapping misses", async () => {
    const r = reads({ nameKind: async () => null });
    expect((await lookupName("dayco", "hewn", r)).kind).toBe("business");
    expect((await lookupName("ana", "hewn", r)).kind).toBe("worker");
  });

  it("uses the name as typed when the registry holds no plaintext", async () => {
    expect((await lookupName("dayco", "hewn", reads({ namePlaintext: async () => null }))).name).toBe("dayco");
  });

  it("leaves a business's industry out when the registry has none, and still answers", async () => {
    const e = await lookupName("dayco", "hewn", reads({ employerSuffix: async () => null }));
    expect(e.industryCode).toBeUndefined();
    expect(e.industry).toBeUndefined();
  });
});

describe("lookupAddress", () => {
  it("finds the business or the person an account holds", async () => {
    expect((await lookupAddress(BIZ, reads())).kind).toBe("business");
    expect(await lookupAddress(PERSON, reads())).toMatchObject({ kind: "worker", name: "ana", address: PERSON });
  });

  it("says an account with no name has none, and an incomplete one is incomplete", async () => {
    await expect(lookupAddress("aleo1" + "q".repeat(58), reads())).rejects.toThrow("That account has no registered name");
    await expect(lookupAddress("aleo1short", reads())).rejects.toThrow(/63 characters/);
  });
});

describe("lookup", () => {
  it("takes either an account or a name", async () => {
    expect((await lookup(PERSON, "hewn", reads())).name).toBe("ana");
    expect((await lookup("ana.hewn", "hewn", reads())).address).toBe(PERSON);
  });
});

describe("requireKind", () => {
  it("lets the wanted kind through and names the mismatch otherwise", async () => {
    const biz = await lookupName("dayco", "hewn", reads());
    const ana = await lookupName("ana", "hewn", reads());
    expect(requireKind(biz, ["business"], "hewn")).toBe(biz);
    expect(requireKind(ana, ["worker", "business"], "hewn")).toBe(ana);
    expect(() => requireKind(biz, ["worker"], "hewn")).toThrow("dayco.hewn is a business, not a person");
    expect(() => requireKind(ana, ["business"], "hewn")).toThrow("ana.hewn is a person, not a business");
  });
});

describe("entryLabel", () => {
  it("is the name with its suffix, or the short account without a name", () => {
    expect(entryLabel({ name: "dayco", nameHash: "1", address: BIZ, kind: "business" }, "hewn")).toBe("dayco.hewn");
    expect(entryLabel({ name: "", nameHash: "1", address: BIZ, kind: "business" }, "hewn")).toBe("aleo1kypw…jm6n");
  });
});

describe("queryEmployerSuffix", () => {
  const answer = (body: unknown, ok = true) => (async () => ({ ok, json: async () => body })) as unknown as typeof fetch;

  it("reads the u8 the registry answers with, and asks for the field", async () => {
    let url = "";
    const spy = (async (u: string) => ((url = u), { ok: true, json: async () => "9u8" })) as unknown as typeof fetch;
    expect(await queryEmployerSuffix("123", "https://x/testnet", spy)).toBe(9);
    expect(url).toBe("https://x/testnet/program/pnw_name_registry_v2.aleo/mapping/employer_suffix_code/123field");
  });

  it("is null for a miss, a worker's zero, junk and a failed request", async () => {
    expect(await queryEmployerSuffix("1", "https://x", answer(null))).toBeNull();
    expect(await queryEmployerSuffix("1", "https://x", answer("0u8"))).toBeNull();
    expect(await queryEmployerSuffix("1", "https://x", answer("41u8"))).toBeNull();
    expect(await queryEmployerSuffix("1", "https://x", answer("x"))).toBeNull();
    expect(await queryEmployerSuffix("1", "https://x", answer("9u8", false))).toBeNull();
    expect(await queryEmployerSuffix("1", "https://x", (async () => Promise.reject(new Error("down"))) as unknown as typeof fetch)).toBeNull();
  });
});
