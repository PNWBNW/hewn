// ---------------------------------------------------------------------------
// How a rail payment reads on the pay panel when Shield never confirmed it,
// what "pay again" leaves on it, and what the books tell the look for it
// (sent_payment.ts) about every other payment: which transfers are already
// some payment's settlement, and whether another open payment could own a
// transfer it finds. Pure, so all of it is tested without a screen.
// ---------------------------------------------------------------------------

import type { PayRun, Settlement } from "@pnw/payroll";
import { NOT_PAID, NOT_SEEN, centsToMinor } from "@pnw/rail";
import { transactionIdOf } from "./history_probe";

/** Added to a settled line the pay queue found in the account's own transfers instead of hearing it from Shield. */
export const FOUND_NOTE = "found in Shield's history";

/**
 * A line whose outcome isn't known. The pay queue's sentence leads with where it stands when it
 * knows more than "not confirmed": not seen on chain yet (its record is still unspent, a while
 * after the try ended), or not paid (its record went into something else).
 */
export function unconfirmedLabel(failure: string): string {
  return failure.startsWith(NOT_SEEN) || failure.startsWith(NOT_PAID) ? failure : `Not confirmed · ${failure}`;
}

export const PAY_AGAIN_NOTE = "Marked to pay again after checking Shield";

/**
 * What "pay again" leaves on a payment. While the record its last try set aside is still listed
 * (`listed`), the line keeps that record's tag, so the next try spends the same record and the
 * network lets at most one of the two land. Only once that record is gone does the line go back to
 * taking a fresh one. The height it was first asked at stays either way: a later look still reads
 * back that far.
 */
export function payAgainTarget(was: Pick<Settlement, "attempt" | "since"> | undefined, listed: boolean): Settlement {
  return {
    status: "failed",
    failure: PAY_AGAIN_NOTE,
    ...(listed && was?.attempt ? { attempt: was.attempt } : {}),
    ...(was?.since !== undefined ? { since: was.since } : {}),
  };
}

type Runs = readonly Pick<PayRun, "id" | "mode" | "paychecks">[];

/** Every transfer the books hold as a settled payment, in any run: one transfer settles one payment, so none is found again. */
export function claimedTransfers(runs: Runs): Set<string> {
  const ids = runs.flatMap((r) => r.paychecks).flatMap((p) => (p.settlement.status === "settled" ? [transactionIdOf(p.settlement.reference ?? "")] : []));
  return new Set(ids.filter((id): id is string => id !== null));
}

/** Whether Shield was ever asked for this payment: a try called failed, or anything a try leaves behind. */
const asked = (s: Settlement): boolean => s.status === "failed" || !!(s.attempt || s.reference || s.failure) || s.since !== undefined;

/**
 * What the books' other open payments mean for a look for this one (`self`: its run and payee id;
 * `to`, `minor`, `attempt`: what the pay queue asks about it).
 *
 * `contested`: another rail payment, not settled, is to the same account for the same amount, and
 * Shield has been asked for it (in another run), or it is being paid alongside this one (the same
 * run). A transfer known only by payee and amount could then be either's, so the look must not
 * take one for this payment. A payment in another run that Shield was never asked for can't have
 * a transfer, and doesn't count.
 *
 * `sameRecord`: one of those payments last set aside the very record this one did (two runs can
 * pick the same record). What spent that record could then be either's too, so the look is given
 * no record for this payment.
 */
export function rivalPayments(
  runs: Runs,
  links: ReadonlyMap<string, string>,
  self: { runId: string; workerId: string },
  query: { to: string; minor: bigint; attempt?: string },
): { contested: boolean; sameRecord: boolean } {
  const rivals = runs
    .filter((r) => r.mode === "rail")
    .flatMap((r) => r.paychecks.filter((p) => !(r.id === self.runId && p.workerId === self.workerId) && (r.id === self.runId || asked(p.settlement))))
    .filter((p) => p.settlement.status !== "settled" && p.net > 0n && links.get(p.workerId) === query.to && centsToMinor(p.net) === query.minor);
  return { contested: rivals.length > 0, sameRecord: query.attempt !== undefined && rivals.some((p) => p.settlement.attempt === query.attempt) };
}
