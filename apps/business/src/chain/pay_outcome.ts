// ---------------------------------------------------------------------------
// How a rail payment reads on the pay panel when Shield never confirmed it,
// what "pay again" leaves on it, and what the books tell the look for it
// (sent_payment.ts) about every other payment: which transfers are already
// some payment's settlement, and whether another open payment could own a
// transfer it finds. Also what the panel shows once a press of Pay now or
// Continue ends part-way: whether it calls the rail short, and which lines go
// back to what the books say. Pure but for one read of Shield's record list,
// so all of it is tested without a screen.
// ---------------------------------------------------------------------------

import type { PayRun, Settlement } from "@pnw/payroll";
import { NOT_LISTED, NOT_PAID, NOT_SEEN, type PaymentQuery, type RailWallet, centsToMinor, recordStillListed } from "@pnw/rail";
import { transactionIdOf } from "./history_probe";
import { SHIELD_WAIT_MS, answered } from "./review_feed";
import type { SentPaymentQuery } from "./sent_payment";

/** Added to a settled line the pay queue found in the account's own transfers instead of hearing it from Shield. */
export const FOUND_NOTE = "found in Shield's history";

/** How a line reads whose outcome isn't known; a sentence that already starts with it is shown as it is. */
export const NOT_CONFIRMED = "Not confirmed";

/** What a line reads while the account's own transfers are looked through for it. */
export const LOOKING = "Looking for it in Shield's history";

/**
 * A line whose outcome isn't known. The pay queue's sentence leads with where it stands when it
 * knows more than "not confirmed": not seen on chain yet (its record is still unspent, a while
 * after the try ended), or not paid (its record went into something else).
 */
export function unconfirmedLabel(failure: string): string {
  return [NOT_SEEN, NOT_PAID, NOT_CONFIRMED].some((lead) => failure.startsWith(lead)) ? failure : `${NOT_CONFIRMED} · ${failure}`;
}

export const PAY_AGAIN_NOTE = "Marked to pay again after checking Shield";

/**
 * What "pay again" leaves on a payment. While the record its last try set aside is still listed
 * (`listed`), the line keeps that record's tag, so the next try spends the same record and the
 * network lets at most one of the two land. Otherwise the caller has found that record gone into
 * something that didn't pay them (release.ts `payAgain`; never merely that nothing was found):
 * the line goes back to taking a fresh one, and keeps the old tag as the record it stopped waiting
 * on, for the run's next marker to say so. The height it was first asked at stays either way: a
 * later look still reads back that far.
 */
export function payAgainTarget(was: Pick<Settlement, "attempt" | "since"> | undefined, listed: boolean): Settlement {
  return {
    status: "failed",
    failure: PAY_AGAIN_NOTE,
    ...(was?.attempt ? (listed ? { attempt: was.attempt } : { replaces: was.attempt }) : {}),
    ...(was?.since !== undefined ? { since: was.since } : {}),
  };
}

/**
 * Whether the record a payment's last try set aside is still listed, asked when the person chooses
 * "pay again". Shield not answering in time (over the relay it answers only once its app is open),
 * or answering with an error, counts as listed: the record is kept, which is the safe way round, and
 * the next run finds out.
 */
export function recordListedForPayAgain(wallet: RailWallet, attempt: string, waitMs = SHIELD_WAIT_MS): Promise<boolean> {
  return answered(recordStillListed(wallet, attempt), waitMs, "the records request").catch(() => true);
}

/**
 * Whether the pay panel says the rail is short for what is still due (`dueMinor`), and holds
 * Continue back. Not while the last run stopped because Shield hadn't yet listed what its last
 * payment left (`stalledWhy` is the queue's `NOT_LISTED`): the balance read just then is missing
 * that change, so it would ask for funds that are there. Continue reads the records again, and the
 * queue refuses before asking anything if they still don't cover the run.
 */
export function shortOnRail(balance: bigint | null, dueMinor: bigint, stalledWhy: string | null): boolean {
  return balance !== null && balance < dueMinor && stalledWhy !== NOT_LISTED;
}

/**
 * The lines' stages once a press of Pay now or Continue has ended. Every line due is "waiting" as the
 * run begins; one still waiting at the end was never reached (the run stopped before it, or was
 * refused before anything was asked). It goes back to what the books hold for it, with the outcome
 * and the button an earlier run left it.
 */
export function stagesAfterPress<S extends { kind: string }>(stages: Readonly<Record<string, S>>): Record<string, S> {
  return Object.fromEntries(Object.entries(stages).filter(([, s]) => s.kind !== "waiting"));
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

/**
 * What the look for one payment (sent_payment.ts) is told, from the books as they stood when the
 * run began (`runs`; `accounts`: each person's account on the rail, payable now or not). Transfers
 * the books already hold as a settled payment are never found again (`claimed`). While another
 * open payment is to the same person for the same amount, a transfer known only by payee and amount
 * is found for neither (`contested`), and when that payment set aside the very record this one did,
 * the look is given no record for this one.
 */
export function lookQuery(runs: Runs, accounts: ReadonlyMap<string, string>, runId: string, q: PaymentQuery): Omit<SentPaymentQuery, "deps"> {
  const rival = rivalPayments(runs, accounts, { runId, workerId: q.workerId }, q);
  return {
    to: q.to,
    minor: q.minor,
    ids: q.ids,
    claimed: claimedTransfers(runs),
    contested: rival.contested,
    ...(q.attempt && !rival.sameRecord ? { attempt: q.attempt } : {}),
    ...(q.since !== undefined ? { since: q.since } : {}),
  };
}
