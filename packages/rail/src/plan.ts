// ---------------------------------------------------------------------------
// Which record pays whom.
//
// Every payee gets one `transfer_private`, and the transfers are fired at
// once, so each needs its own input record holding at least the payee's net.
// The plan assigns records to payees deterministically:
//
//   1. exact fit: a record whose amount equals a payee's net goes to that payee;
//   2. largest first: the remaining payees, biggest net first, each take the
//      smallest free record that covers them (best fit, so big records stay
//      free for splitting);
//   3. split: payees still unassigned are carved out of the free records,
//      biggest record first, one `split(token, amount)` per payee. Each split
//      consumes the previous one's remainder, so the splits for one source
//      record run in order; the final remainder is the change, kept as one
//      record. When a payee exactly empties a remainder, that remainder is
//      used as is (no split for it).
//
// The plan fails, before anything is signed, when the balance is short or
// when no single record can cover a payee (that needs a `join` first).
// ---------------------------------------------------------------------------

import type { TokenRecord } from "./records";
import { RailError } from "./types";

export type Payee = { workerId: string; amount: bigint };

/** A record the plan refers to: one the wallet already holds, or an output of a planned split. */
export type RecordRef =
  | { kind: "existing"; plaintext: string; amount: bigint }
  | { kind: "split"; split: number; output: "amount" | "remainder"; amount: bigint };

export type SplitStep = {
  /** Position in `splits`; later steps may use this one's remainder. */
  index: number;
  source: RecordRef;
  /** The first output holds exactly this; the second holds the rest. */
  amount: bigint;
  remainder: bigint;
};

export type Transfer = { workerId: string; amount: bigint; record: RecordRef };

export type TransferPlan = {
  splits: SplitStep[];
  transfers: Transfer[];
  /** Records left untouched plus every split's final remainder, for the balance line. */
  change: bigint;
};

const byAmountDesc = <T extends { amount: bigint }>(a: T, b: T) => (a.amount === b.amount ? 0 : a.amount > b.amount ? -1 : 1);
const byAmountAsc = <T extends { amount: bigint }>(a: T, b: T) => -byAmountDesc(a, b);

export function planTransfers(payees: readonly Payee[], records: readonly TokenRecord[]): TransferPlan {
  const seen = new Set<string>();
  for (const p of payees) {
    if (p.amount <= 0n) throw new RailError("Every payment must be more than zero");
    if (seen.has(p.workerId)) throw new RailError("A person is listed twice");
    seen.add(p.workerId);
  }
  const usable = records.filter((r) => r.amount > 0n).map((r, i) => ({ ...r, order: i }));
  const needed = payees.reduce((s, p) => s + p.amount, 0n);
  const balance = usable.reduce((s, r) => s + r.amount, 0n);
  if (needed > balance) throw new RailError("Not enough balance on the rail for this run");

  // Stable order: biggest first, ties by the order the wallet listed them / by worker id.
  const queue = [...payees].sort((a, b) => byAmountDesc(a, b) || a.workerId.localeCompare(b.workerId));
  const free = [...usable].sort((a, b) => byAmountAsc(a, b) || a.order - b.order);
  const transfers: Transfer[] = [];
  const take = (p: Payee, r: (typeof free)[number]) => {
    free.splice(free.indexOf(r), 1);
    transfers.push({ workerId: p.workerId, amount: p.amount, record: { kind: "existing", plaintext: r.plaintext, amount: r.amount } });
  };

  // 1. Exact fits.
  const unassigned: Payee[] = [];
  for (const p of queue) {
    const exact = free.find((r) => r.amount === p.amount);
    if (exact) take(p, exact);
    else unassigned.push(p);
  }

  // 2. Best fit, largest payee first, but only when there are enough free
  //    records to go round; with fewer records than payees, handing a big
  //    record to one person would starve the others, so they all go to 3.
  const waiting: Payee[] = [];
  const enough = free.length >= unassigned.length;
  for (const p of unassigned) {
    const fit = enough ? free.find((r) => r.amount >= p.amount) : undefined; // ascending: the smallest that covers
    if (fit) take(p, fit);
    else waiting.push(p);
  }

  // 3. Split the free records, biggest first, one split per remaining payee.
  const splits: SplitStep[] = [];
  const sources = [...free].sort((a, b) => byAmountDesc(a, b) || a.order - b.order);
  let remaining = [...waiting];
  for (const src of sources) {
    if (remaining.length === 0) break;
    let current: RecordRef = { kind: "existing", plaintext: src.plaintext, amount: src.amount };
    const next: Payee[] = [];
    for (const p of remaining) {
      if (p.amount > current.amount) {
        next.push(p);
        continue;
      }
      if (p.amount === current.amount) {
        transfers.push({ workerId: p.workerId, amount: p.amount, record: current });
        current = { ...current, amount: 0n };
        continue;
      }
      const step: SplitStep = { index: splits.length, source: current, amount: p.amount, remainder: current.amount - p.amount };
      splits.push(step);
      transfers.push({ workerId: p.workerId, amount: p.amount, record: { kind: "split", split: step.index, output: "amount", amount: p.amount } });
      current = { kind: "split", split: step.index, output: "remainder", amount: step.remainder };
    }
    remaining = next;
  }
  if (remaining.length > 0) {
    throw new RailError("No single record on the rail is large enough for one of the payments; combine records first");
  }

  const paid = transfers.reduce((s, t) => s + t.amount, 0n);
  // Transfers keep the order the payees were given, so progress reads top to bottom.
  const position = new Map(payees.map((p, i) => [p.workerId, i]));
  transfers.sort((a, b) => position.get(a.workerId)! - position.get(b.workerId)!);
  return { splits, transfers, change: balance - paid };
}
