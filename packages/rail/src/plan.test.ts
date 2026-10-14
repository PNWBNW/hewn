import { describe, expect, it } from "vitest";
import { type RecordRef, planTransfers } from "./plan";
import type { TokenRecord } from "./records";

const rec = (amount: bigint, tag = ""): TokenRecord => ({ plaintext: `{ owner: aleo1x.private, amount: ${amount}u128.private, _nonce: ${tag || amount}group.public }`, amount });
const payee = (workerId: string, amount: bigint) => ({ workerId, amount });

const existing = (r: RecordRef) => (r.kind === "existing" ? r.plaintext : null);

describe("planTransfers", () => {
  it("gives each payee its exact-fit record before anything else", () => {
    const records = [rec(50n), rec(30n), rec(100n)];
    const plan = planTransfers([payee("a", 30n), payee("b", 50n)], records);
    expect(plan.splits).toEqual([]);
    expect(plan.transfers.map((t) => [t.workerId, existing(t.record)])).toEqual([
      ["a", records[1]!.plaintext],
      ["b", records[0]!.plaintext],
    ]);
    expect(plan.change).toBe(100n);
  });

  it("largest payee first takes the smallest record that covers it", () => {
    const records = [rec(100n), rec(60n), rec(45n)];
    const plan = planTransfers([payee("small", 40n), payee("big", 55n)], records);
    expect(plan.splits).toEqual([]);
    const by = Object.fromEntries(plan.transfers.map((t) => [t.workerId, t.record.amount]));
    expect(by).toEqual({ big: 60n, small: 45n });
    expect(plan.change).toBe(110n); // the 100 untouched, 5 + 5 come back as change records
  });

  it("one big record, five payees: four splits in a chain, change kept as one record", () => {
    const plan = planTransfers(
      [payee("a", 20n), payee("b", 20n), payee("c", 20n), payee("d", 20n), payee("e", 20n)],
      [rec(1000n)],
    );
    expect(plan.splits).toHaveLength(5);
    expect(plan.splits[0]!.source.kind).toBe("existing");
    for (let i = 1; i < 5; i++) {
      expect(plan.splits[i]!.source).toEqual({ kind: "split", split: i - 1, output: "remainder", amount: 1000n - 20n * BigInt(i) });
    }
    expect(plan.splits.map((s) => s.remainder)).toEqual([980n, 960n, 940n, 920n, 900n]);
    expect(plan.transfers.map((t) => t.record)).toEqual(
      [0, 1, 2, 3, 4].map((i) => ({ kind: "split", split: i, output: "amount", amount: 20n })),
    );
    expect(plan.change).toBe(900n);
  });

  it("a payee that exactly empties a remainder uses it without another split", () => {
    const plan = planTransfers([payee("a", 60n), payee("b", 40n)], [rec(100n)]);
    expect(plan.splits).toHaveLength(1);
    expect(plan.splits[0]).toMatchObject({ amount: 60n, remainder: 40n });
    expect(plan.transfers.find((t) => t.workerId === "b")!.record).toEqual({ kind: "split", split: 0, output: "remainder", amount: 40n });
    expect(plan.change).toBe(0n);
  });

  it("with fewer records than payees, nobody hogs a record that others could share", () => {
    // Best-fit would hand the 100 to one payee and strand the other four.
    const plan = planTransfers(
      [payee("a", 25n), payee("b", 25n), payee("c", 25n), payee("d", 25n)],
      [rec(100n), rec(10n)],
    );
    expect(plan.splits).toHaveLength(3);
    expect(plan.transfers).toHaveLength(4);
    expect(plan.change).toBe(10n);
  });

  it("refuses when the balance is short", () => {
    expect(() => planTransfers([payee("a", 70n), payee("b", 40n)], [rec(60n), rec(45n)])).toThrow(/Not enough balance/);
  });

  it("refuses when no single record covers a payee, even if the total does", () => {
    expect(() => planTransfers([payee("a", 70n), payee("b", 40n)], [rec(60n), rec(50n)])).toThrow(/combine records first/);
  });

  it("refuses zero amounts and repeated people", () => {
    expect(() => planTransfers([payee("a", 0n)], [rec(10n)])).toThrow(/more than zero/);
    expect(() => planTransfers([payee("a", 1n), payee("a", 2n)], [rec(10n)])).toThrow(/listed twice/);
  });

  it("is deterministic and keeps the payees' order in the transfers", () => {
    const payees = [payee("z", 5n), payee("y", 50n), payee("x", 5n)];
    const records = [rec(5n, "one"), rec(5n, "two"), rec(70n)];
    const a = planTransfers(payees, records);
    const b = planTransfers(payees, records);
    expect(a).toEqual(b);
    expect(a.transfers.map((t) => t.workerId)).toEqual(["z", "y", "x"]);
    // Ties in amount go by worker id (x before z), so x gets the first 5 the wallet listed.
    expect(a.transfers.map((t) => existing(t.record))).toEqual([records[1]!.plaintext, records[2]!.plaintext, records[0]!.plaintext]);
  });

  it("nothing to do when there are no payees", () => {
    expect(planTransfers([], [rec(10n)])).toEqual({ splits: [], transfers: [], change: 10n });
  });
});
