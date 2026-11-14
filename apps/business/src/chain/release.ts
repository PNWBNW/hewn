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
// A releaser also says, before Shield is asked for anything, what it will be
// asked to approve (`prompts`): one line per approval, in the order they will
// come up, so the person can be told how many times Shield will ask and for
// what. For the queue that is one payment per person still to pay, then one
// paystub letter per person, which the pay panel sends once the payments are
// done (deliver.ts). Nothing is prepared first, so there is nothing else.
//
// Every payment's record is handed to Shield as its plaintext: the very
// record whose tag the books kept before asking (rail/queue.ts). A releaser
// must never leave the choice of record to Shield (a records request with
// filters): the books would no longer know which record a try spends, and
// that knowledge is what lets a second try spend the same one.
//
// `releaseRun` is a whole release, as the pay panel runs one, with no screen in
// it: the run as the books hold it now, each payment's record kept before
// Shield is asked for it, every outcome written to the books as it happens,
// then the paystub of each paycheck settled this time, one letter at a time.
// The panel keeps only what it shows.
//
// Program and function names come from @pnw/config, through the modules that
// already use them. Shield is asked only through the releaser and the look
// for an unconfirmed payment; nothing here signs or logs anything.
// ---------------------------------------------------------------------------

import { type Payroll, type Settlement, markPaycheckSettlement } from "@pnw/payroll";
import {
  type PayQueueContext,
  type PayQueueEvent,
  type PayQueueResult,
  type PaymentQuery,
  type RailNetwork,
  type RailWallet,
  TRANSFER_FUNCTION,
  USDCX_PROGRAM,
  centsToMinor,
  outstanding,
  runPayQueue,
  systemClock,
} from "@pnw/rail";
import type { Company } from "../books/company";
import { LETTERS_PROGRAM, SEND_FUNCTION } from "./letters";
import { claimedTransfers, rivalPayments } from "./pay_outcome";
import { type SentPaymentDeps, findSentPayment } from "./sent_payment";

/** One approval Shield will ask for. */
export type Prompt = {
  kind: "payment" | "paystub";
  program: string;
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
  /** What Shield will be asked to approve for this run as it stands, in order. Asks nothing of Shield. */
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

// ---- Writing a payment's standing to the books ----------------------------------------------

/** Moves one paycheck to `target` through whatever intermediate step the rules need. */
export function settleTo(payroll: Payroll, runId: string, workerId: string, target: Settlement): Payroll {
  const current = payroll.runs.find((r) => r.id === runId)?.paychecks.find((p) => p.workerId === workerId)?.settlement;
  if (!current || current.status === "settled") return payroll; // never touch a settled paycheck
  let next = payroll;
  if (current.status === "failed") next = markPaycheckSettlement(next, runId, workerId, { status: "pending" }); // a retry
  if (target.status === "pending" && !target.reference && !target.attempt && !target.failure) return next; // nothing to note
  return markPaycheckSettlement(next, runId, workerId, target);
}

// ---- A whole release ------------------------------------------------------------------------

export type ReleaseContext = {
  /** Shield, bound to the linked account. */
  wallet: RailWallet;
  /** The explorer. */
  network: RailNetwork;
  runId: string;
  /** workerId → account, for everyone who can be paid on the rail now (books/rail `payableLinks`). */
  links: ReadonlyMap<string, string>;
  /** Applies one change to the open books and resolves them as they then stand (the provider's `updateCompany`). */
  updateCompany(op: (company: Company) => Company): Promise<Company>;
  /** What the look for a payment Shield didn't confirm reads (sent_payment.ts); the explorer is `network`. */
  lookup: Omit<SentPaymentDeps, "network">;
  /** Sends one settled paycheck's paystub. Never throws, never touches the settlement. */
  deliver(workerId: string): Promise<void>;
  /** What Shield will be asked for this run as it stands, said before it is asked anything. */
  onPrompts?(prompts: readonly Prompt[]): void;
  /** Every event of the pay queue as it happens, for the screen. */
  onEvent?(event: PayQueueEvent): void;
  /** A write to the books that didn't go through. The release goes on. */
  onError?(error: unknown): void;
  /** Once the payments are done, before the paystubs go. Not called when the release threw. */
  onPaid?(): void | Promise<void>;
  /** Other ways of paying a run, offered ahead of the one-at-a-time queue (`pickReleaser`). */
  releasers?: readonly Releaser[];
  /** Test seams, handed to the pay queue as they are. */
  queue?: Pick<PayQueueContext, "clock" | "sleep" | "limits" | "tree">;
};

/**
 * Releases what a rail run still owes, as the books hold it now. Every outcome is written to the
 * books as it happens; the paystub of each paycheck settled this time is then sent, one at a time,
 * whether or not the release went on to throw. Resolves whether the run stopped short (`stalled`:
 * its events said where and why); throws what stopped it from starting or going on.
 */
export async function releaseRun(ctx: ReleaseContext): Promise<{ stalled: boolean }> {
  const { wallet, network, runId, links } = ctx;
  const clock = ctx.queue?.clock ?? systemClock;
  const write = (workerId: string, target: Settlement) => ctx.updateCompany((c) => ({ ...c, payroll: settleTo(c.payroll, runId, workerId, target) }));
  const note = (workerId: string, target: Settlement) => void write(workerId, target).catch((e: unknown) => ctx.onError?.(e));
  const settled: Promise<string | null>[] = [];
  const onProgress = (e: PayQueueEvent) => {
    ctx.onEvent?.(e);
    switch (e.kind) {
      case "sent":
        note(e.workerId, { status: "pending", reference: e.reference, ...(e.attempt ? { attempt: e.attempt } : {}), ...(e.since !== undefined ? { since: e.since } : {}) });
        break;
      case "settled":
        // The paystub goes out once everyone is paid (a letter is its own Shield approval, so
        // it never races the payments); a failed send never touches the settlement.
        settled.push(
          write(e.workerId, {
            status: "settled",
            reference: e.transactionId,
            settledAt: new Date(clock.now()).toISOString(),
            ...(e.height !== undefined ? { height: e.height } : {}),
            ...(e.feeMicrocredits !== undefined ? { feeMicrocredits: e.feeMicrocredits } : {}),
          }).then(
            () => e.workerId,
            (err: unknown) => {
              ctx.onError?.(err);
              return null;
            },
          ),
        );
        break;
      case "failed":
        note(e.workerId, { status: "failed", failure: e.failure, ...(e.attempt ? { attempt: e.attempt } : {}), ...(e.since !== undefined ? { since: e.since } : {}) });
        break;
      case "unconfirmed":
        note(e.workerId, {
          status: "pending",
          failure: e.failure,
          ...(e.reference ? { reference: e.reference } : {}),
          ...(e.attempt ? { attempt: e.attempt } : {}),
          ...(e.since !== undefined ? { since: e.since } : {}),
          ...(e.endedAt ? { endedAt: e.endedAt } : {}),
        });
        break;
    }
  };
  // The record each transfer will spend is kept just before Shield is asked for it, with the chain's height when
  // the run began: a later run, after a pause or a reload, checks the record instead of paying twice, and a later
  // look reads back no further than that height.
  const beforeSend = async (workerId: string, attempt: string, since?: number) => {
    await write(workerId, { status: "pending", attempt, ...(since !== undefined ? { since } : {}) });
  };

  let stalled = false;
  let stopped: { error: unknown } | null = null;
  try {
    // The run as it is now, so a reopened panel resumes exactly what's outstanding.
    const books = await ctx.updateCompany((c) => c);
    const latest = books.payroll.runs.find((r) => r.id === runId);
    if (!latest) throw new Error("Pay run not found");
    // Before a payment is called unconfirmed, it is looked for in this account's own transfers. Transfers the
    // books already hold as someone's settled paycheck are never found a second time, and while another open
    // paycheck is to the same person for the same amount, one known only by payee and amount is found for neither.
    const claimed = claimedTransfers(books.payroll.runs);
    // Each person's account on the rail, payable right now or not: for telling whose a transfer could be, more is safer.
    const accounts = new Map((books.rail?.links ?? []).map((l) => [l.workerId, l.address]));
    const findPayment = (q: PaymentQuery) => {
      const rival = rivalPayments(books.payroll.runs, accounts, { runId, workerId: q.workerId }, q);
      return findSentPayment({
        to: q.to,
        minor: q.minor,
        ids: q.ids,
        claimed,
        contested: rival.contested,
        ...(q.attempt && !rival.sameRecord ? { attempt: q.attempt } : {}),
        ...(q.since !== undefined ? { since: q.since } : {}),
        deps: { ...ctx.lookup, network },
      });
    };
    // How the run is paid: the one-at-a-time queue, unless another way is offered and available. First, how many times Shield will ask.
    const releaser = await pickReleaser(ctx.releasers);
    ctx.onPrompts?.(releaser.prompts(latest, links));
    stalled = !!(await releaser.release({ wallet, network, run: latest, links, onProgress, beforeSend, findPayment, ...ctx.queue })).stalled;
    await ctx.onPaid?.();
  } catch (error) {
    stopped = { error };
  }
  // Then each paystub settled this time, one letter (one approval) at a time; `deliver` never throws.
  for (const workerId of await Promise.all(settled)) if (workerId) await ctx.deliver(workerId);
  if (stopped) throw stopped.error;
  return { stalled };
}
