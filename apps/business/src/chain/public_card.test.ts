import { describe, expect, it } from "vitest";
import { computeNameHash } from "@pnw/records/registry/name_registry";
import { publicCardPath } from "@/books/card";
import { isPublicPath, redirectFor } from "@/shell/AppShell";
import { DirectoryError, type DirectoryReads } from "./directory";
import { type PublicCardReads, lookupPublicCard } from "./public_card";

const BIZ = "aleo1kypwp5m7qtk9mwazgcpg0tq8aal23mnrvwfvug65qgcg9xvsrqgspyjm6n";
const PERSON = "aleo1rhgdu77hgyqd3xjj8ucu3jj9r2krwz6mnzyd80gncr5fxcwlh5rsvzp9px";
const DAYCO = computeNameHash("dayco");
const NEWCO = computeNameHash("newco");
const ANA = computeNameHash("ana");
const BEA = computeNameHash("bea");
const SINCE = "2026-10-25T00:08:18.000Z";

/** dayco and newco are businesses, ana and bea people. dayco and bea have shown cards, ana a hidden one, newco none. */
const directory: DirectoryReads = {
  nameOwner: async (h) => ([DAYCO, NEWCO].includes(h) ? BIZ : [ANA, BEA].includes(h) ? PERSON : null),
  nameKind: async (h) => ([DAYCO, NEWCO].includes(h) ? 2 : [ANA, BEA].includes(h) ? 1 : null),
  namePlaintext: async () => null,
  workerName: async () => null,
  employerName: async (a) => (a === BIZ ? DAYCO : null),
  employerSuffix: async () => null,
};
const cards: Record<string, string> = {
  [DAYCO]: "{\n  issued_at: 20801930u32,\n  shown: true\n}",
  [ANA]: "{\n  issued_at: 20802000u32,\n  shown: false\n}",
  [BEA]: "{\n  issued_at: 20802100u32,\n  shown: true\n}",
};
const reads = (over: Partial<PublicCardReads> = {}): PublicCardReads => ({
  directory,
  card: async (h) => cards[h] ?? null,
  blockTime: async (height) => (height === 20801930 ? SINCE : null),
  ...over,
});

describe("a card anyone can open", () => {
  it("draws a business's card, with the day it was issued", async () => {
    expect(await lookupPublicCard("Dayco.HEWN", "hewn", reads())).toEqual({
      state: "shown",
      name: "dayco",
      nameHash: DAYCO,
      kind: "business",
      card: { issuedAt: 20801930, shown: true, since: SINCE },
    });
  });

  it("draws a person's card while they show it, by the block alone when its time can't be read", async () => {
    expect(await lookupPublicCard("bea", "hewn", reads())).toEqual({
      state: "shown",
      name: "bea",
      nameHash: BEA,
      kind: "worker",
      card: { issuedAt: 20802100, shown: true },
    });
  });

  it("draws nothing for a hidden card, and says no more than for a name without one", async () => {
    expect(await lookupPublicCard("ana", "hewn", reads())).toEqual({ state: "none", name: "ana", kind: "worker" });
    expect(await lookupPublicCard("newco", "hewn", reads())).toEqual({ state: "none", name: "newco", kind: "business" });
  });

  it("says when nobody has the name", async () => {
    expect(await lookupPublicCard("nobody", "hewn", reads())).toEqual({ state: "unregistered", name: "nobody" });
  });

  it("refuses what can't be a name before reading anything", async () => {
    let asked = false;
    const r = reads({ directory: { ...directory, nameOwner: async () => ((asked = true), null) } });
    for (const bad of ["ab", "has space", "a".repeat(17), "dash-ed"]) await expect(lookupPublicCard(bad, "hewn", r)).rejects.toThrow(DirectoryError);
    await expect(lookupPublicCard("  ", "hewn", r)).rejects.toThrow("Enter a name");
    expect(asked).toBe(false);
  });

  it("decides the kind from the owner's own primary name when the kind mapping misses", async () => {
    const r = reads({ directory: { ...directory, nameKind: async () => null } });
    expect(await lookupPublicCard("dayco", "hewn", r)).toMatchObject({ state: "shown", kind: "business" });
    expect(await lookupPublicCard("bea", "hewn", r)).toMatchObject({ state: "shown", kind: "worker" });
  });

  it("lives on a public page, reached by the name's address", () => {
    expect(publicCardPath("dayco")).toBe("/card?name=dayco");
    expect(isPublicPath("/card")).toBe(true);
    expect(isPublicPath("/card/")).toBe(true);
    expect(isPublicPath("/cards")).toBe(false);
    expect(redirectFor("business", "/card")).toBeNull();
    expect(redirectFor("worker", "/card")).toBeNull();
  });
});
