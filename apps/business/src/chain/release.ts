// ---------------------------------------------------------------------------
// Releasing a rail run: the seam between the pay panel and whatever pays the
// run's lines.
//
// A `Releaser` is one way of paying a run through Shield. Today there is one:
// the pay queue (@pnw/rail), which asks for one payment at a time, each made
// from what the last one left (`sequentialReleaser`). A way that pays a run
// in fewer approvals would be another releaser, offered ahead of this one
// whenever it says it is available (`pickReleaser`).
//
// A releaser also says, before Shield is asked for anything, what it expects
// to ask it to approve (`prompts`): one line per approval, in the order they
// will come up, so the person can be told how many times Shield will ask and
// for what. For the queue that is one payment per person still to pay, then
// one paystub letter per person, which the pay panel sends once the payments
// are done (deliver.ts). Nothing is prepared first, so there is nothing else.
//
// It is what the run expects, not a promise. Shield can ask fewer times: a
// line whose kept record has gone is looked for, not asked; a run that stops
// part-way asks for nobody after the stop; a paystub that can't be sent yet
// isn't asked for. It can ask more: a payment whose record went into
// something else before Shield spent it (money arrived and Shield combined
// the two) and that nothing paid is asked again from a record listed now, up
// to two more times in a run (rail/queue.ts `MAX_ASKS`).
//
// Every payment's record is handed to Shield as its plaintext: the very
// record whose tag the books kept before asking (rail/queue.ts). A releaser
// must never leave the choice of record to Shield (a records request with
// filters): the books would no longer know which record a try spends, and
// that knowledge is what lets a second try spend the same one.
//
// Program and function names come from @pnw/config, through the modules that
// already use them. Nothing here asks Shield, signs or logs anything.
// ---------------------------------------------------------------------------

import { type PayQueueContext, type PayQueueResult, TRANSFER_FUNCTION, USDCX_PROGRAM, centsToMinor, outstanding, runPayQueue } from "@pnw/rail";
import { LETTERS_PROGRAM, SEND_FUNCTION } from "./letters";

/** One approval Shield will ask for. */
export type Prompt = {
  kind: "payment" | "paystub";
  program: string;
  /** The function. A paystub's is `send`; one too long for a single letter goes out as `send_page`, still one approval. */
  fn: string;
  /** Whose payment or paystub it is. */
  workerId: string;
  /** A payment: the payee's account, when they have one on the rail. */
  to?: string;
  /** A payment: the amount in USDCx minor units (millionths of a dollar), as Shield is given it. */
  minor?: bigint;
};

/** The run a releaser pays: what the pay queue reads of it. */
export type ReleaseRun = PayQueueContext["run"];

export interface Releaser {
  /** How it pays: one approval per payment ("sequential"), or a run in fewer ("batch", "wrapper": none exists yet). */
  mode: "sequential" | "batch" | "wrapper";
  /** Whether this way of paying can be used right now. */
  available(): Promise<boolean>;
  /** What Shield is expected to be asked to approve for this run as it stands, in order (see the header for when it differs). Asks nothing of Shield. */
  prompts(run: ReleaseRun, links: ReadonlyMap<string, string>): Prompt[];
  /** Pays what the run still owes; every outcome is reported through the context's `onProgress`. */
  release(ctx: PayQueueContext): Promise<PayQueueResult>;
}

/** The pay queue: one payment at a time, each from what the last one left. Always available. */
export const sequentialReleaser: Releaser = {
  mode: "sequential",
  available: async () => true,
  prompts(run, links) {
    if (run.mode !== "rail") return [];
    const due = outstanding(run);
    // One Shield already took is asked about, not sent again: no prompt for its payment, one for its paystub.
    const toAsk = due.filter((p) => !(p.settlement.status === "pending" && p.settlement.reference));
    return [
      ...toAsk.map((p): Prompt => {
        const to = links.get(p.workerId);
        return { kind: "payment", program: USDCX_PROGRAM, fn: TRANSFER_FUNCTION, workerId: p.workerId, ...(to ? { to } : {}), minor: centsToMinor(p.net) };
      }),
      ...due.map((p): Prompt => ({ kind: "paystub", program: LETTERS_PROGRAM, fn: SEND_FUNCTION, workerId: p.workerId })),
    ];
  },
  release: (ctx) => runPayQueue(ctx),
};

/** The first of `others` that is available, else the one-at-a-time queue. One that can't say is passed over. */
export async function pickReleaser(others: readonly Releaser[] = []): Promise<Releaser> {
  for (const releaser of others) if (await releaser.available().catch(() => false)) return releaser;
  return sequentialReleaser;
}

/** "Shield will ask you 24 times, one at a time: 12 payments, then 12 paystubs." Null when it will ask nothing. */
export function promptSummary(prompts: readonly Prompt[]): string | null {
  if (prompts.length === 0) return null;
  const parts = (["payment", "paystub"] as const)
    .map((kind) => [prompts.filter((p) => p.kind === kind).length, kind] as const)
    .filter(([count]) => count > 0)
    .map(([count, kind]) => `${count} ${kind}${count === 1 ? "" : "s"}`);
  return `Shield will ask you ${prompts.length === 1 ? "once" : `${prompts.length} times, one at a time`}: ${parts.join(", then ")}.`;
}
