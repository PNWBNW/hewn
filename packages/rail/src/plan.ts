// ---------------------------------------------------------------------------
// Which record pays whom.
//
// A run is paid one person at a time, in the order the payees are given.
// Each `transfer_private` spends one record whole: the payee's amount goes to
// them and the rest comes back to the account as one new record, the change.
// Nothing is prepared beforehand, so with a single record on the rail every
// payment after the first is made from the change of the one before it.
//
// For each payee in turn, the record it spends is:
//
//   1. the record set aside for it on an earlier try, when it has one (a
//      retry spends the very record the first try did);
//   2. else a record whose amount equals the payee's exactly;
//   3. else the smallest record that covers it, so the large ones stay whole
//      for the larger payments still to come.
//
// A record set aside for another payee is never taken, and the change a
// payment leaves is a record like any other for the payees after it.
//
// The plan fails, before anything is signed, when the balance is short or
// when no single record can cover a payee (records have to be combined
// first). The queue plans once this way, to refuse a run it can't pay, and
// then picks each payment's record afresh from what the wallet lists at that
// moment, by the same rule (`pickRecord`).
// ---------------------------------------------------------------------------

import type { TokenRecord } from "./records";
import { RailError } from "./types";

export type Payee = {
  workerId: string;
  amount: bigint;
  /** The plaintext of the record an earlier try set aside for this payment: it spends that one and no other. */
  record?: string;
};

/** A record the plan refers to: one the wallet holds now, or the change a planned payment will leave. */
export type RecordRef =
  | { kind: "existing"; plaintext: string; amount: bigint }
  /** `of`: the position in `transfers` of the payment that leaves it. */
  | { kind: "change"; of: number; amount: bigint };

export type Transfer = { workerId: string; amount: bigint; record: RecordRef };

export type TransferPlan = {
  /** One per payee, in the order they were given: the order they are paid in. */
  transfers: Transfer[];
  /** What is left on the rail once everyone is paid, for the balance line. */
  change: bigint;
};

/**
 * The record a payment of `amount` spends, out of the ones free to it: one that fits exactly, else
 * the smallest that covers it; between equals, the first as listed. Undefined when none covers it.
 */
export function pickRecord<R extends { amount: bigint }>(amount: bigint, free: readonly R[]): R | undefined {
  let best: R | undefined;
  for (const r of free) {
    if (r.amount < amount) continue;
    if (r.amount === amount) return r;
    if (!best || r.amount < best.amount) best = r;
  }
  return best;
}

export function planTransfers(payees: readonly Payee[], records: readonly TokenRecord[]): TransferPlan {
  const seen = new Set<string>();
  for (const p of payees) {
    if (p.amount <= 0n) throw new RailError("Every payment must be more than zero");
    if (seen.has(p.workerId)) throw new RailError("A person is listed twice");
    seen.add(p.workerId);
  }
  const usable = records.filter((r) => r.amount > 0n);
  const needed = payees.reduce((s, p) => s + p.amount, 0n);
  const balance = usable.reduce((s, r) => s + r.amount, 0n);
  if (needed > balance) throw new RailError("Not enough balance on the rail for this run");

  // Records set aside for a payee stay out of everyone else's reach until that payee has been paid from them.
  const setAside = new Set(payees.flatMap((p) => (p.record !== undefined ? [p.record] : [])));
  const pool: RecordRef[] = usable.map((r) => ({ kind: "existing", plaintext: r.plaintext, amount: r.amount }));
  const transfers: Transfer[] = [];
  payees.forEach((p, position) => {
    let record: RecordRef | undefined;
    if (p.record !== undefined) {
      record = pool.find((r) => r.kind === "existing" && r.plaintext === p.record && r.amount >= p.amount);
      if (!record) throw new RailError("The record set aside for one of the payments is missing");
    } else {
      record = pickRecord(
        p.amount,
        pool.filter((r) => r.kind !== "existing" || !setAside.has(r.plaintext)),
      );
      if (!record) throw new RailError("No single record on the rail is large enough for one of the payments; combine records first");
    }
    pool.splice(pool.indexOf(record), 1);
    transfers.push({ workerId: p.workerId, amount: p.amount, record });
    if (record.amount > p.amount) pool.push({ kind: "change", of: position, amount: record.amount - p.amount });
  });
  return { transfers, change: balance - needed };
}
