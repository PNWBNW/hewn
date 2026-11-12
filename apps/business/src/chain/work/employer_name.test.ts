import { describe, expect, it } from "vitest";
import { computeNameHash } from "@pnw/records/registry/name_registry";
import { type NameReads, employerNameFor } from "./employer_name";
import { emptyWork, forgetEmployerName, upsertAgreement } from "../../books/work";

const BUSINESS = `aleo1${"q".repeat(58)}`;
const STRANGER = `aleo1${"p".repeat(58)}`;
const ACME = computeNameHash("acme");

/** A registry where `acme` belongs to BUSINESS; `calls` counts what was asked. */
function registry(owner: string | null = BUSINESS, opts: { throws?: boolean } = {}) {
  const calls = { owner: 0, plaintext: 0 };
  const reads: NameReads = {
    owner: async (h) => {
      calls.owner++;
      if (opts.throws) throw new Error("offline");
      return h === ACME ? owner : null;
    },
    plaintext: async (h) => {
      calls.plaintext++;
      return h === ACME ? "acme" : null;
    },
  };
  return { reads, calls };
}

describe("employerNameFor", () => {
  it("shows the name when the account that sent the offer owns it", async () => {
    const { reads } = registry();
    expect(await employerNameFor(ACME, BUSINESS, undefined, reads)).toEqual({ state: "owned", name: "acme" });
    expect(await employerNameFor(`${ACME}field`, `${BUSINESS}.private`, undefined, reads)).toEqual({ state: "owned", name: "acme" });
  });

  it("refuses a real business's name sent from another account", async () => {
    const { reads } = registry();
    expect(await employerNameFor(ACME, STRANGER, undefined, reads)).toEqual({ state: "not-theirs" });
  });

  it("refuses a name kept on this device once the sender no longer owns it", async () => {
    const { reads, calls } = registry(STRANGER);
    expect(await employerNameFor(ACME, BUSINESS, "acme", reads)).toEqual({ state: "not-theirs" });
    expect(calls.owner).toBe(1);
  });

  it("asks the registry about ownership even with a kept name, and skips only the text lookup", async () => {
    const { reads, calls } = registry();
    expect(await employerNameFor(ACME, BUSINESS, "acme", reads)).toEqual({ state: "owned", name: "acme" });
    expect(calls).toEqual({ owner: 1, plaintext: 0 });
  });

  it("ignores a kept name that doesn't hash to the record", async () => {
    const { reads, calls } = registry();
    expect(await employerNameFor(ACME, BUSINESS, "acme-corp", reads)).toEqual({ state: "owned", name: "acme" });
    expect(calls.plaintext).toBe(1);
  });

  it("confirms nothing when the registry can't be asked or knows no owner", async () => {
    expect(await employerNameFor(ACME, BUSINESS, "acme", registry(BUSINESS, { throws: true }).reads)).toEqual({ state: "unknown" });
    expect(await employerNameFor(ACME, BUSINESS, "acme", registry(null).reads)).toEqual({ state: "unknown" });
  });

  it("an owned name with no text in the registry shows the account", async () => {
    const reads: NameReads = { owner: async () => BUSINESS, plaintext: async () => null };
    expect(await employerNameFor(ACME, BUSINESS, undefined, reads)).toEqual({ state: "owned" });
  });

  it("treats a missing hash or sender as not theirs, without asking", async () => {
    const { reads, calls } = registry();
    expect(await employerNameFor("", BUSINESS, undefined, reads)).toEqual({ state: "not-theirs" });
    expect(await employerNameFor(ACME, "", undefined, reads)).toEqual({ state: "not-theirs" });
    expect(calls.owner).toBe(0);
  });
});

describe("forgetEmployerName", () => {
  it("drops a stored name that upsertAgreement would otherwise keep", () => {
    const base = { agreementId: "0a", partiesKey: "b".repeat(64), employerAddress: STRANGER, employerNameHash: ACME, status: "pending" as const };
    const stored = upsertAgreement(emptyWork("Sam"), { ...base, employerName: "acme" });
    // Saving the agreement again without a name keeps the old one...
    const resaved = upsertAgreement(stored, base);
    expect(resaved.agreements[0]!.employerName).toBe("acme");
    // ...so a name that turned out not to be the sender's is removed on purpose.
    const cleaned = forgetEmployerName(resaved, "0a");
    expect(cleaned.agreements[0]!.employerName).toBeUndefined();
    expect(cleaned.agreements[0]!.employerNameHash).toBe(ACME);
    expect(forgetEmployerName(cleaned, "0a")).toBe(cleaned);
  });
});
