import { describe, expect, it } from "vitest";
import { type RecordRef, pickRecord, planTransfers } from "./plan";
import type { TokenRecord } from "./records";

const rec = (amount: bigint, tag = ""): TokenRecord => ({ plaintext: `{ owner: aleo1x.private, amount: ${amount}u128.private, _nonce: ${tag || amount}group.public }`, amount });
const payee = (workerId: string, amount: bigint, record?: TokenRecord) => ({ workerId, amount, ...(record ? { record: record.plaintext } : {}) });

const existing = (r: RecordRef) => (r.kind === "existing" ? r.plaintext : null);

describe("pickRecord", () => {
  it("takes the record that fits exactly, else the smallest that covers the amount; between equals, the first listed", () => {
    const records = [rec(100n), rec(30n, "one"), rec(45n), rec(30n, "two")];
    expect(pickRecord(30n, records)).toBe(records[1]);
    expect(pickRecord(40n, records)).toBe(records[2]);
    expect(pickRecord(46n, records)).toBe(records[0]);
    expect(pickRecord(101n, records)).toBeUndefined();
    expect(pickRecord(1n, [])).toBeUndefined();
    // An empty record covers nothing.
    expect(pickRecord(1n, [rec(0n)])).toBeUndefined();
  });
});

describe("planTransfers", () => {
  it("one record, five payees: no split, each paid from the change of the one before, in the order given", () => {
    const records = [rec(1000n)];
    const plan = planTransfers([payee("a", 20n), payee("b", 30n), payee("c", 20n), payee("d", 20n), payee("e", 10n)], records);
    expect(plan).not.toHaveProperty("splits");
    expect(plan.transfers.map((t) => t.workerId)).toEqual(["a", "b", "c", "d", "e"]);
    expect(plan.transfers[0]!.record).toEqual({ kind: "existing", plaintext: records[0]!.plaintext, amount: 1000n });
    expect(plan.transfers.slice(1).map((t) => t.record)).toEqual([
      { kind: "change", of: 0, amount: 980n },
      { kind: "change", of: 1, amount: 950n },
      { kind: "change", of: 2, amount: 930n },
      { kind: "change", of: 3, amount: 910n },
    ]);
    expect(plan.change).toBe(900n);
  });

  it("gives a payee the record that fits it exactly before any other", () => {
    const records = [rec(50n), rec(30n), rec(100n)];
    const plan = planTransfers([payee("a", 30n), payee("b", 50n)], records);
    expect(plan.transfers.map((t) => [t.workerId, existing(t.record)])).toEqual([
      ["a", records[1]!.plaintext],
      ["b", records[0]!.plaintext],
    ]);
    expect(plan.change).toBe(100n);
  });

  it("else the smallest record that covers it, so the large ones stay whole for larger payments", () => {
    const records = [rec(100n), rec(60n)];
    // Taking the 100 for the first payee would leave nothing that covers the second.
    const plan = planTransfers([payee("small", 50n), payee("big", 90n)], records);
    expect(plan.transfers.map((t) => [t.workerId, existing(t.record)])).toEqual([
      ["small", records[1]!.plaintext],
      ["big", records[0]!.plaintext],
    ]);
    expect(plan.change).toBe(20n);
  });

  it("a payment's change is a record like any other for the payees after it, exact fits included", () => {
    const records = [rec(100n), rec(500n)];
    const plan = planTransfers([payee("a", 60n), payee("b", 40n), payee("c", 300n)], records);
    expect(plan.transfers.map((t) => t.record)).toEqual([
      { kind: "existing", plaintext: records[0]!.plaintext, amount: 100n },
      { kind: "change", of: 0, amount: 40n }, // exactly what the first payment left: nothing comes back from this one
      { kind: "existing", plaintext: records[1]!.plaintext, amount: 500n },
    ]);
    expect(plan.change).toBe(200n);
  });

  it("a payee with a record set aside spends that one, and nobody before it takes it", () => {
    const records = [rec(30n), rec(100n)];
    // "b" tried before with the 30, though the 100 would do; "a" fits the 30 exactly but may not have it.
    const plan = planTransfers([payee("a", 30n), payee("b", 10n, records[0]), payee("c", 20n)], records);
    expect(plan.transfers.map((t) => t.record)).toEqual([
      { kind: "existing", plaintext: records[1]!.plaintext, amount: 100n },
      { kind: "existing", plaintext: records[0]!.plaintext, amount: 30n },
      { kind: "change", of: 1, amount: 20n },
    ]);
    expect(plan.change).toBe(70n);
  });

  it("refuses when a record set aside is gone or no longer covers its payment", () => {
    expect(() => planTransfers([payee("a", 10n, rec(30n, "gone"))], [rec(100n)])).toThrow(/set aside for one of the payments is missing/);
    const small = rec(5n);
    expect(() => planTransfers([payee("a", 10n, small)], [small, rec(100n)])).toThrow(/set aside for one of the payments is missing/);
  });

  it("refuses when the balance is short", () => {
    expect(() => planTransfers([payee("a", 70n), payee("b", 40n)], [rec(60n), rec(45n)])).toThrow(/Not enough balance/);
  });

  it("refuses when no single record covers a payee, even if the total does", () => {
    expect(() => planTransfers([payee("a", 70n), payee("b", 40n)], [rec(60n), rec(50n)])).toThrow(/combine records first/);
    // The change of earlier payments counts only as the separate records it comes back as.
    expect(() => planTransfers([payee("a", 5n), payee("b", 5n), payee("c", 6n)], [rec(9n), rec(7n)])).toThrow(/combine records first/);
  });

  it("refuses zero amounts and repeated people", () => {
    expect(() => planTransfers([payee("a", 0n)], [rec(10n)])).toThrow(/more than zero/);
    expect(() => planTransfers([payee("a", 1n), payee("a", 2n)], [rec(10n)])).toThrow(/listed twice/);
  });

  it("is deterministic: between records of one amount, the first the wallet listed", () => {
    const payees = [payee("z", 5n), payee("y", 50n), payee("x", 5n)];
    const records = [rec(5n, "one"), rec(5n, "two"), rec(70n)];
    const a = planTransfers(payees, records);
    expect(a).toEqual(planTransfers(payees, records));
    expect(a.transfers.map((t) => t.workerId)).toEqual(["z", "y", "x"]);
    expect(a.transfers.map((t) => existing(t.record))).toEqual([records[0]!.plaintext, records[2]!.plaintext, records[1]!.plaintext]);
  });

  it("nothing to do when there are no payees", () => {
    expect(planTransfers([], [rec(10n)])).toEqual({ transfers: [], change: 10n });
  });
});
