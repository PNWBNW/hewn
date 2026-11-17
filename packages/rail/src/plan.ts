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
// Rule 3 alone can leave a later payee with nothing that covers them when
// another choice would have paid everyone: records of 10.00 and 6.00, payees
// of 4.00, 6.00 and 5.00 in that order (the 6.00 goes to the first, the
// 10.00 to the second, and 2.00 and 4.00 are left for the third). So when a
// pass by the three rules stops short, the plan looks for another order of
// picks (`search`): for each payee an exact fit, else the largest record
// first, backing up whenever a choice leaves someone after it uncovered. A
// run that one record nobody has set aside covers whole is always found this
// way, on the first try: that record, or what is left of it, covers every
// payment still to come.
//
// The plan fails, before anything is signed, when the balance is short, when
// a payee is larger than every record, or when no order of picks pays
// everyone from the records as they are (they have to be combined first).
// The look for an order is bounded (`SEARCH_STEPS`); a run it can't place
// within that is refused the same way. The queue plans once, to refuse a run
// it can't pay, and again before each payment, from what the wallet lists at
// that moment: the payment spends the record the plan gives it.
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

/** How many payments the look for another order of picks may place, tries that were backed out of included, before it gives up. */
export const SEARCH_STEPS = 20_000;

/** The record set aside for `p`, when it is still there and still covers the payment. */
const ownRecord = (p: Payee, pool: readonly RecordRef[]): RecordRef | undefined =>
  pool.find((r) => r.kind === "existing" && r.plaintext === p.record && r.amount >= p.amount);

/** The records nobody has set aside: the ones any payee may take. */
const freeOf = (pool: readonly RecordRef[], setAside: ReadonlySet<string>): RecordRef[] => pool.filter((r) => r.kind !== "existing" || !setAside.has(r.plaintext));

/** The rail after a payment of `amount` from `record`: that record gone, and what it left, if anything, in its place at the end. */
const withChange = (pool: readonly RecordRef[], record: RecordRef, amount: bigint, position: number): RecordRef[] => {
  const rest = pool.filter((r) => r !== record);
  return record.amount > amount ? [...rest, { kind: "change", of: position, amount: record.amount - amount }] : rest;
};

/** One pass in the payees' order by the three rules; undefined when it leaves a payee with nothing that covers them. */
function inOrder(payees: readonly Payee[], records: readonly RecordRef[], setAside: ReadonlySet<string>): Transfer[] | undefined {
  let pool = records;
  const transfers: Transfer[] = [];
  for (const [position, p] of payees.entries()) {
    const record = p.record !== undefined ? ownRecord(p, pool) : pickRecord(p.amount, freeOf(pool, setAside));
    if (!record) return undefined;
    transfers.push({ workerId: p.workerId, amount: p.amount, record });
    pool = withChange(pool, record, p.amount, position);
  }
  return transfers;
}

/**
 * Another order of picks, when the pass by the rules stops short: for each payee an exact fit, else
 * the largest record first, backing up when a choice leaves someone after it uncovered. Undefined
 * when there is none, or none was found within `SEARCH_STEPS`.
 */
function search(payees: readonly Payee[], records: readonly RecordRef[], setAside: ReadonlySet<string>): Transfer[] | undefined {
  // Where the look has already been and found no way on: a position, with the amounts on the rail at it.
  const dead = new Set<string>();
  let steps = 0;
  const from = (position: number, pool: readonly RecordRef[]): Transfer[] | undefined => {
    const p = payees[position];
    if (!p) return [];
    const key = `${position}:${pool.map((r) => r.amount).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)).join(",")}`;
    if (dead.has(key)) return undefined;
    for (const record of p.record !== undefined ? [ownRecord(p, pool)] : choices(p.amount, freeOf(pool, setAside))) {
      if (!record || ++steps > SEARCH_STEPS) break;
      const rest = from(position + 1, withChange(pool, record, p.amount, position));
      if (rest) return [{ workerId: p.workerId, amount: p.amount, record }, ...rest];
    }
    dead.add(key);
    return undefined;
  };
  return from(0, records);
}

/** The records a payment of `amount` could spend, in the order the search tries them: an exact fit, then the largest down; one per amount, the first as listed. */
function choices(amount: bigint, free: readonly RecordRef[]): RecordRef[] {
  const byAmount = new Map<bigint, RecordRef>();
  for (const r of free) if (r.amount >= amount && !byAmount.has(r.amount)) byAmount.set(r.amount, r);
  const exact = byAmount.get(amount);
  byAmount.delete(amount);
  const down = [...byAmount.values()].sort((a, b) => (a.amount > b.amount ? -1 : a.amount < b.amount ? 1 : 0));
  return exact ? [exact, ...down] : down;
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
  // A record set aside is spent by its own payee and no other, whatever the order of the rest: missing, it stops the plan here.
  let left: readonly RecordRef[] = pool;
  for (const [position, p] of payees.entries()) {
    if (p.record === undefined) continue;
    const record = ownRecord(p, left);
    if (!record) throw new RailError("The record set aside for one of the payments is missing");
    left = withChange(left, record, p.amount, position);
  }
  const largest = usable.reduce((most, r) => (r.amount > most ? r.amount : most), 0n);
  if (payees.some((p) => p.record === undefined && p.amount > largest)) {
    throw new RailError("No single record on the rail is large enough for one of the payments; combine records first");
  }

  const transfers = inOrder(payees, pool, setAside) ?? search(payees, pool, setAside);
  if (!transfers) throw new RailError("The records on the rail can't pay everyone in this run as they are, though the balance covers it; combine records first");
  return { transfers, change: balance - needed };
}
