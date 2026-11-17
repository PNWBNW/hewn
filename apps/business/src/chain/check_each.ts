// ---------------------------------------------------------------------------
// Checking many conversations in one go (the Messages list, the hours check,
// a person's offers): each is checked on its own, so one that can't be read
// (a letter that won't open, keys that can't be made, a read that failed) is
// counted and passed over, and the rest are still checked. Only Shield not
// being connected stops the whole check, since then nothing can be read.
// Nothing here logs a key or a message.
// ---------------------------------------------------------------------------

/** What checking one conversation said: Shield isn't connected (`off`), or this one couldn't be read (`failed`). */
export type OneCheck = { off?: boolean; failed?: string } | void;

export type EachOutcome = {
  /** Shield isn't connected: the check stopped there. */
  off: boolean;
  /** How many conversations couldn't be checked. */
  failed: number;
  /** Why the first of them couldn't, when it said. */
  reason?: string;
};

/** Checks each of `items` in turn; one that throws or fails is counted and the next goes on. */
export async function checkEach<T>(items: Iterable<T>, check: (item: T) => Promise<OneCheck>): Promise<EachOutcome> {
  const outcome: EachOutcome = { off: false, failed: 0 };
  const failed = (why: unknown) => {
    outcome.failed++;
    if (outcome.reason === undefined && typeof why === "string" && why) outcome.reason = why;
  };
  for (const item of items) {
    try {
      const r = await check(item);
      if (r?.off) return { ...outcome, off: true };
      if (r?.failed) failed(r.failed);
    } catch (e) {
      failed(e instanceof Error ? e.message : undefined);
    }
  }
  return outcome;
}

/** Adds one outcome to another, for a check made of several rounds. */
export const together = (a: EachOutcome, b: EachOutcome): EachOutcome => ({
  off: a.off || b.off,
  failed: a.failed + b.failed,
  ...((a.reason ?? b.reason) !== undefined ? { reason: (a.reason ?? b.reason)! } : {}),
});

/** The line a check ends with when some conversations couldn't be checked; null when all were. */
export function couldntCheck(outcome: Pick<EachOutcome, "failed" | "reason">): string | null {
  if (outcome.failed === 0) return null;
  const line = `Couldn't check ${outcome.failed} conversation${outcome.failed === 1 ? "" : "s"}`;
  return outcome.reason ? `${line}: ${outcome.reason}` : line;
}
