import { describe, expect, it } from "vitest";
import { computeNameHash } from "@pnw/records/registry/name_registry";
import type { DirectoryReads } from "./directory";
import { checkAccountName } from "./coworker_names";

const BIZ = "aleo1kypwp5m7qtk9mwazgcpg0tq8aal23mnrvwfvug65qgcg9xvsrqgspyjm6n";
const ANA_ACCOUNT = "aleo1rhgdu77hgyqd3xjj8ucu3jj9r2krwz6mnzyd80gncr5fxcwlh5rsvzp9px";
const MALLORY_ACCOUNT = "aleo1" + "m".repeat(58);
const DAYCO = computeNameHash("dayco");
const ANA = computeNameHash("ana_w");
const MALLORY = computeNameHash("mallory");

/** The registry: dayco is the business, ana_w and mallory are people, each owning their own name. */
const reads = (over: Partial<DirectoryReads> = {}): DirectoryReads => ({
  nameOwner: async (h) => ({ [DAYCO]: BIZ, [ANA]: ANA_ACCOUNT, [MALLORY]: MALLORY_ACCOUNT })[h] ?? null,
  nameKind: async (h) => (h === DAYCO ? 2 : h === ANA || h === MALLORY ? 1 : null),
  namePlaintext: async (h) => ({ [DAYCO]: "dayco", [ANA]: "ana_w", [MALLORY]: "mallory" })[h] ?? null,
  workerName: async (a) => (a === ANA_ACCOUNT ? `${ANA}field` : a === MALLORY_ACCOUNT ? `${MALLORY}field` : null),
  employerName: async (a) => (a === BIZ ? DAYCO : null),
  employerSuffix: async () => null,
  ...over,
});

describe("a coworker's name, as the chain confirms it", () => {
  it("is the registered name their account owns", async () => {
    expect(await checkAccountName(ANA_ACCOUNT, reads())).toEqual({ status: "person", name: "ana_w" });
  });

  it("can't be made to read as someone else's: an account listed for Ana that isn't hers shows its own owner", async () => {
    // A business sitting in the middle has to list an account it controls; the chain names that account's owner.
    expect(await checkAccountName(MALLORY_ACCOUNT, reads())).toEqual({ status: "person", name: "mallory" });
    expect(await checkAccountName(BIZ, reads())).toEqual({ status: "business", name: "dayco" });
  });

  it("isn't confirmed when the account no longer owns its primary name", async () => {
    // Ana's primary still points at ana_w, but the name now belongs to another account.
    const sold = reads({ nameOwner: async (h) => (h === ANA ? MALLORY_ACCOUNT : null) });
    expect(await checkAccountName(ANA_ACCOUNT, sold)).toEqual({ status: "unconfirmed" });
  });

  it("isn't confirmed when the name's text doesn't hash back to it", async () => {
    // queryNamePlaintext gives nothing for a name whose text and hash disagree (name_registry.ts).
    expect(await checkAccountName(ANA_ACCOUNT, reads({ namePlaintext: async () => null }))).toEqual({ status: "unconfirmed" });
  });

  it("reads as not confirmed, never as a name, when the chain can't be reached", async () => {
    const down = reads({ nameOwner: async () => null, workerName: async () => null, employerName: async () => null, namePlaintext: async () => null });
    expect(await checkAccountName(ANA_ACCOUNT, down)).toEqual({ status: "unconfirmed" });
    const failing = reads({ workerName: () => Promise.reject(new Error("offline")) });
    expect(await checkAccountName(ANA_ACCOUNT, failing)).toEqual({ status: "unconfirmed" });
  });

  it("isn't confirmed for something that isn't an account", async () => {
    expect(await checkAccountName("aleo1short", reads())).toEqual({ status: "unconfirmed" });
  });
});
