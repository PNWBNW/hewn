// ---------------------------------------------------------------------------
// How a rail payment reads on the pay panel when Shield never confirmed it,
// and what "pay again" leaves on it. Pure, so both are tested without a screen.
// ---------------------------------------------------------------------------

import type { Settlement } from "@pnw/payroll";
import { NOT_PAID, NOT_SEEN } from "@pnw/rail";

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
