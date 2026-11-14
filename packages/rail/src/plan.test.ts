import { describe, expect, it } from "vitest";
import { type RecordRef, type TransferPlan, pickRecord, planTransfers } from "./plan";
import type { TokenRecord } from "./records";

const rec = (amount: bigint, tag = ""): TokenRecord => ({ plaintext: `{ owner: aleo1x.private, amount: ${amount}u128.private, _nonce: ${tag || amount}group.public }`, amount });
const payee = (workerId: string, amount: bigint, record?: TokenRecord) => ({ workerId, amount, ...(record ? { record: record.plaintext } : {}) });

const existing = (r: RecordRef) => (r.kind === "existing" ? r.plaintext : null);

/**
 * Pays a plan out against the records it was made from, the way the chain would: every payment
 * spends a record that is there and covers it, a record is spent once, and what a payment leaves is
 * there for the ones after it. Returns what is left on the rail.
 */
function payOut(plan: TransferPlan, records: readonly TokenRecord[]): bigint[] {
  const held = new Map(records.map((r) => [r.plaintext, r.amount]));
  const left = new Map<number, bigint>();
  plan.transfers.forEach((t, position) => {
    const from = t.record.kind === "existing" ? held : left;
    const key = t.record.kind === "existing" ? t.record.plaintext : t.record.of;
    const amount = (from as Map<unknown, bigint>).get(key);
    expect(amount, `payment ${position} spends a record that is there`).toBe(t.record.amount);
    expect(t.record.amount >= t.amount, `payment ${position} is covered`).toBe(true);
    (from as Map<unknown, bigint>).delete(key);
    if (t.record.amount > t.amount) left.set(position, t.record.amount - t.amount);
  });
  return [...held.values(), ...left.values()];
}

/** Whether the payments can be shared out among the records at all: each to one record, no record asked for more than it holds. */
function canBeShared(amounts: readonly bigint[], records: readonly bigint[]): boolean {
  const room = [...records];
  const place = (i: number): boolean => {
    if (i === amounts.length) return true;
    for (let r = 0; r < room.length; r++) {
      if (room[r]! < amounts[i]!) continue;
      room[r]! -= amounts[i]!;
      const done = place(i + 1);
      room[r]! += amounts[i]!;
      if (done) return true;
    }
    return false;
  };
  return place(0);
}

/** Numbers that look random and are the same on every run. */
function dice(seed: number) {
  let state = seed;
  return (below: number) => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return Math.floor((state / 2147483648) * below);
  };
}

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

  it("records of 10.00 and 6.00 pay 4.00, 6.00 and 5.00 in that order: the first is paid from the 10.00, so the last is left a record that covers it", () => {
    const records = [rec(1000n), rec(600n)];
    // The smallest record that covers the first payee is the 6.00, and taking it leaves 2.00 and 4.00 for the last.
    const plan = planTransfers([payee("a", 400n), payee("b", 600n), payee("c", 500n)], records);
    expect(plan.transfers.map((t) => t.record)).toEqual([
      { kind: "existing", plaintext: records[0]!.plaintext, amount: 1000n },
      { kind: "existing", plaintext: records[1]!.plaintext, amount: 600n },
      { kind: "change", of: 0, amount: 600n },
    ]);
    expect(plan.change).toBe(100n);
    expect(payOut(plan, records)).toEqual([100n]);
  });

  it("looking for another order backs up as far as it has to: here to the first payee, who takes neither the smallest nor the largest record", () => {
    const records = [rec(1000n), rec(700n), rec(600n)];
    // Only one sharing-out pays everyone: 4.00 and 3.00 from the 7.00, 6.00 from the 6.00, the two 5.00s from the 10.00.
    const plan = planTransfers([payee("a", 400n), payee("b", 600n), payee("c", 300n), payee("d", 500n), payee("e", 500n)], records);
    expect(plan.transfers.map((t) => t.record)).toEqual([
      { kind: "existing", plaintext: records[1]!.plaintext, amount: 700n },
      { kind: "existing", plaintext: records[2]!.plaintext, amount: 600n },
      { kind: "change", of: 0, amount: 300n },
      { kind: "existing", plaintext: records[0]!.plaintext, amount: 1000n },
      { kind: "change", of: 3, amount: 500n },
    ]);
    expect(plan.change).toBe(0n);
    expect(payOut(plan, records)).toEqual([]);
  });

  it("looking for another order never hands a set-aside record to anyone else", () => {
    const records = [rec(1000n), rec(600n), rec(150n)];
    // "c" tried before with the 1.50. By the rules alone "a" takes the 6.00 and "b" the 10.00, and "d" is left 2.00, 4.00 and 0.50.
    const plan = planTransfers([payee("a", 400n), payee("b", 600n), payee("c", 100n, records[2]), payee("d", 500n)], records);
    expect(plan.transfers.map((t) => t.record)).toEqual([
      { kind: "existing", plaintext: records[0]!.plaintext, amount: 1000n },
      { kind: "existing", plaintext: records[1]!.plaintext, amount: 600n },
      { kind: "existing", plaintext: records[2]!.plaintext, amount: 150n },
      { kind: "change", of: 0, amount: 600n },
    ]);
    expect(payOut(plan, records)).toEqual([50n, 100n]);
  });

  it("a run one record covers whole is planned whatever else is listed and whatever the order", () => {
    const roll = dice(7);
    for (let n = 0; n < 200; n++) {
      const amounts = Array.from({ length: 1 + roll(12) }, () => BigInt(1 + roll(500)));
      const total = amounts.reduce((a, b) => a + b, 0n);
      const others = Array.from({ length: roll(4) }, (_x, i) => rec(BigInt(1 + roll(600)), `other${n}-${i}`));
      const records = [...others];
      records.splice(roll(records.length + 1), 0, rec(total + BigInt(roll(3)), `whole${n}`));
      const plan = planTransfers(amounts.map((a, i) => payee(`p${i}`, a)), records);
      expect(plan.transfers.map((t) => t.amount)).toEqual(amounts);
      expect(payOut(plan, records).reduce((a, b) => a + b, 0n)).toBe(plan.change);
    }
  });

  it("plans every run the records can pay between them, and refuses only the ones they can't", () => {
    const roll = dice(11);
    let planned = 0;
    let refused = 0;
    for (let n = 0; n < 1500; n++) {
      const records = Array.from({ length: 2 + roll(2) }, (_x, i) => rec(BigInt(20 + roll(80)), `r${n}-${i}`));
      const balance = records.reduce((s, r) => s + r.amount, 0n);
      const amounts = Array.from({ length: 1 + roll(6) }, () => BigInt(5 + roll(45)));
      if (amounts.reduce((a, b) => a + b, 0n) > balance) continue;
      const payees = amounts.map((a, i) => payee(`p${i}`, a));
      if (canBeShared(amounts, records.map((r) => r.amount))) {
        const plan = planTransfers(payees, records);
        expect(payOut(plan, records).reduce((a, b) => a + b, 0n)).toBe(plan.change);
        planned++;
      } else {
        expect(() => planTransfers(payees, records)).toThrow(/combine records first/);
        refused++;
      }
    }
    // Both kinds came up, so both halves were checked.
    expect(planned).toBeGreaterThan(500);
    expect(refused).toBeGreaterThan(30);
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
    expect(() => planTransfers([payee("a", 70n), payee("b", 40n)], [rec(60n), rec(50n)])).toThrow(/No single record on the rail is large enough for one of the payments; combine records first/);
  });

  it("refuses when every payee is covered alone but no order of picks pays them all, and says the balance is there", () => {
    // The change of earlier payments counts only as the separate records it comes back as.
    expect(() => planTransfers([payee("a", 5n), payee("b", 5n), payee("c", 6n)], [rec(9n), rec(7n)])).toThrow(/can't pay everyone in this run as they are, though the balance covers it; combine records first/);
  });

  it("gives up looking, and refuses, on a long run that no order of picks pays: it doesn't look for ever", () => {
    // Four payments of 1,000,000 can't come out of three records of about 1,600,000, and the 18 before them, each
    // twice the one before, can be shared out among the three in 387 million ways that all leave different amounts.
    const records = [rec(1_600_000n), rec(1_600_001n), rec(1_600_002n)];
    const payees = [...Array.from({ length: 18 }, (_x, i) => payee(`s${i}`, 2n ** BigInt(i))), ...Array.from({ length: 4 }, (_x, i) => payee(`b${i}`, 1_000_000n))];
    const started = Date.now();
    expect(() => planTransfers(payees, records)).toThrow(/can't pay everyone in this run as they are, though the balance covers it; combine records first/);
    expect(Date.now() - started).toBeLessThan(2_000);
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
