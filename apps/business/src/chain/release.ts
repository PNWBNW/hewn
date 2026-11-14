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
// it: the run as the books hold it now, put beside the notes the account keeps
// about its pay runs (run_marker.ts), each payment's record kept before
// Shield is asked for it, every outcome written to the books as it happens,
// then the paystub of each paycheck this device paid and saw settle this
// time, one letter at a time. The panel keeps only what it shows.
//
// Program and function names come from @pnw/config, through the modules that
// already use them. Shield is asked only through the releaser and the look
// for an unconfirmed payment; nothing here signs or logs anything.
// ---------------------------------------------------------------------------

import { type Payroll, type Settlement, markPaycheckSettlement } from "@pnw/payroll";
import {
  type ConfirmedTransaction,
  DEFAULT_LIMITS,
  type ListedMarker,
  MARKER_VERSION,
  type MarkedPayment,
  type MarkerLine,
  type PayQueueContext,
  type PayQueueEvent,
  type PayQueueResult,
  type PaymentLookup,
  type PaymentQuery,
  type QueuedLine,
  type RailNetwork,
  type RailWallet,
  type RunMarker,
  TRANSFER_FUNCTION,
  TransactionRejected,
  USDCX_PROGRAM,
  beaten,
  centsToMinor,
  confirmTransaction,
  decideLines,
  isOnChainId,
  newMarkerId,
  outstanding,
  parseTokenPlaintext,
  recordStillListed,
  recordTag,
  runPayQueue,
  systemClock,
} from "@pnw/rail";
import type { Company } from "../books/company";
import { transactionIdOf } from "./history_probe";
import { LETTERS_PROGRAM, SEND_FUNCTION } from "./letters";
import { NOT_CONFIRMED, claimedTransfers, payAgainTarget, rivalPayments } from "./pay_outcome";
import { type MarkerDesk, markerFunction } from "./run_marker";
import { type SentPaymentDeps, findSentPayment } from "./sent_payment";

/** One approval Shield will ask for. */
export type Prompt =
  /** The run's marker, a letter to the account itself: `lines` is how many payments it names. */
  | { kind: "marker"; program: string; fn: string; lines: number }
  | {
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

const PROMPT_WORDS: Record<Prompt["kind"], [one: string, many: string]> = {
  marker: ["note to your own account", "notes to your own account"],
  payment: ["payment", "payments"],
  paystub: ["paystub", "paystubs"],
};

/** "Shield will ask you 25 times, one at a time: 1 note to your own account, then 12 payments, then 12 paystubs." Null when it will ask nothing. */
export function promptSummary(prompts: readonly Prompt[]): string | null {
  if (prompts.length === 0) return null;
  const parts = (["marker", "payment", "paystub"] as const)
    .map((kind) => [prompts.filter((p) => p.kind === kind).length, kind] as const)
    .filter(([count]) => count > 0)
    .map(([count, kind]) => `${count} ${PROMPT_WORDS[kind][count === 1 ? 0 : 1]}`);
  return `Shield will ask you ${prompts.length === 1 ? "once" : `${prompts.length} times, one at a time`}: ${parts.join(", then ")}.`;
}

// ---- Writing a payment's standing to the books ----------------------------------------------

/**
 * Moves one paycheck to `target` through whatever intermediate step the rules need. Two things
 * stay with a paycheck until it settles, whatever `target` leaves out: the marker this device sent
 * for it, and the record it stopped waiting on (`Settlement.marker`, `Settlement.replaces`).
 */
export function settleTo(payroll: Payroll, runId: string, workerId: string, target: Settlement): Payroll {
  const current = payroll.runs.find((r) => r.id === runId)?.paychecks.find((p) => p.workerId === workerId)?.settlement;
  if (!current || current.status === "settled") return payroll; // never touch a settled paycheck
  const marker = target.marker ?? current.marker;
  // A record never takes its own place: once a paycheck holds a record again, an older note that it gave that one up is dropped.
  const replaces = [target.replaces, current.replaces].find((tag) => tag !== undefined && tag !== target.attempt);
  const kept = target.status === "settled" ? {} : { ...(marker ? { marker } : {}), ...(replaces ? { replaces } : {}) };
  let next = payroll;
  if (current.status === "failed") next = markPaycheckSettlement(next, runId, workerId, { status: "pending", ...kept }); // a retry
  const nothingNew = (kept.marker === current.marker || current.status === "failed") && (kept.replaces === current.replaces || current.status === "failed");
  if (target.status === "pending" && !target.reference && !target.attempt && !target.failure && nothingNew) return next; // nothing to note
  return markPaycheckSettlement(next, runId, workerId, { ...target, ...kept });
}

// ---- A whole release ------------------------------------------------------------------------

/** How long a run marked on another device may go without paying anyone before this device may go on with it. A starting value. */
export const TAKE_OVER_AFTER_MS = 30 * 60_000;

/** How a line starts that another device is paying: nothing is sent for it from here. */
export const IN_PROGRESS = "In progress on another device";
/** How a line starts that this device won't pay as its books hold it. */
export const NOT_FROM_HERE = "Not paid from here";
/** What stops a release whose marker came second. */
export const MARKED_FIRST = "Another device marked this run first; open it again to see where it stands";

/** A time of day, for "from 3:45 PM". */
const clockTime = (ms: number): string => new Date(ms).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

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
  /** The account's run markers (run_marker.ts): read before anything is asked, and one sent before the first payment. */
  markers: MarkerDesk;
  /**
   * Sends one settled paycheck's paystub. Never throws, never touches the settlement. Called for a
   * paycheck this device asked Shield to pay; one found already paid from another device is left
   * to the person, since that device may have sent it.
   */
  deliver(workerId: string): Promise<void>;
  /** What Shield will be asked for this run as it stands, said before it is asked anything. */
  onPrompts?(prompts: readonly Prompt[]): void;
  /** Every event of the pay queue as it happens, for the screen. */
  onEvent?(event: PayQueueEvent): void;
  /** A payment nothing is sent for from this device this time, and why (it starts with `IN_PROGRESS` or `NOT_FROM_HERE`). */
  onHeld?(workerId: string, why: string): void;
  /** A write to the books that didn't go through. The release goes on. */
  onError?(error: unknown): void;
  /** Once the payments are done, before the paystubs go. Not called when the release threw. */
  onPaid?(): void | Promise<void>;
  /** Other ways of paying a run, offered ahead of the one-at-a-time queue (`pickReleaser`). */
  releasers?: readonly Releaser[];
  /** Test seams, handed to the pay queue as they are. */
  queue?: Pick<PayQueueContext, "clock" | "sleep" | "limits" | "tree">;
};

type Books = Company;

/** The look for one payment in the account's own transfers, as the books stand (`books`). `claimed` grows as transfers are taken. */
function paymentFinder(ctx: Pick<ReleaseContext, "network" | "runId" | "lookup">, books: Books, claimed: Set<string>) {
  // Each person's account on the rail, payable right now or not: for telling whose a transfer could be, more is safer.
  const accounts = new Map((books.rail?.links ?? []).map((l) => [l.workerId, l.address]));
  return (q: PaymentQuery): Promise<PaymentLookup> => {
    const rival = rivalPayments(books.payroll.runs, accounts, { runId: ctx.runId, workerId: q.workerId }, q);
    return findSentPayment({
      to: q.to,
      minor: q.minor,
      ids: q.ids,
      claimed,
      contested: rival.contested,
      ...(q.attempt && !rival.sameRecord ? { attempt: q.attempt } : {}),
      ...(q.since !== undefined ? { since: q.since } : {}),
      deps: { ...ctx.lookup, network: ctx.network },
    });
  };
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);

/** When a block was made, in milliseconds, from the explorer; null when it can't be read. */
async function blockTime(network: RailNetwork, height: number): Promise<number | null> {
  try {
    const doc = await network.fetchJson(`block/${height}`);
    const header = isObj(doc) && isObj(doc.header) ? doc.header : null;
    const stamp = header && isObj(header.metadata) ? header.metadata.timestamp : undefined;
    const seconds = typeof stamp === "number" ? stamp : typeof stamp === "string" && /^\d+$/.test(stamp) ? Number(stamp) : Number.NaN;
    return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : null;
  } catch {
    return null;
  }
}

/** The chain's own clock: when its newest block was made. */
async function chainNow(network: RailNetwork): Promise<number | null> {
  try {
    const height = await network.fetchJson("block/height/latest");
    return typeof height === "number" && Number.isInteger(height) && height >= 0 ? await blockTime(network, height) : null;
  } catch {
    return null;
  }
}

/** The account's unspent stablecoin records as Shield lists them now, each with its tag and the transaction that made it, when Shield says. */
async function unspentRecords(wallet: RailWallet): Promise<{ tag: string; amount: bigint; madeBy: string | null }[]> {
  const out: { tag: string; amount: bigint; madeBy: string | null }[] = [];
  for (const raw of await wallet.requestRecords(USDCX_PROGRAM, true)) {
    if (!isObj(raw) || raw.spent === true || (raw.recordName !== undefined && raw.recordName !== "Token") || typeof raw.recordPlaintext !== "string") continue;
    const token = parseTokenPlaintext(raw.recordPlaintext);
    if (token) out.push({ tag: await recordTag(token.plaintext), amount: token.amount, madeBy: transactionIdOf(raw, ["transactionId", "transaction_id", "txId"]) });
  }
  return out;
}

/**
 * Releases what a rail run still owes, as the books hold it now.
 *
 * First the account's run markers are read (no approval), and each payment still owed is put
 * beside them (@pnw/rail `decideLines`):
 *
 *   - no marker covers it: it is paid, and marked first. Before Shield is asked for the first
 *     payment, one marker goes out naming every such payment (one approval), and the release waits
 *     until the account lists it. If another device's marker for the same payee and period was
 *     accepted before it, nothing is paid from here;
 *   - a marker names the record that pays it: that record's tag is kept, and the payment goes out
 *     only by spending that record, so the network lets one transfer through whichever device asks;
 *   - it is a later payment of a run this device marked (or took over): it goes on, once it has
 *     been looked for in the account's own transfers and not found;
 *   - it is a later payment of a run another device marked: it is looked for, and settled if it is
 *     there. Otherwise nothing is sent for it (`onHeld`), until the chain shows that run has paid
 *     someone and then nobody for `TAKE_OVER_AFTER_MS`. Then this device goes on with it, from the
 *     record that run would have paid from next and no other: what its last payment left, and only
 *     while that is the one record Shield lists for the account, so the device that started the
 *     run, opened again, has no other record to pay the same person from;
 *   - a marker pays the same account another amount for a period that overlaps, or names a record
 *     other than the one this device holds for it: nothing is sent for it from here.
 *
 * Every outcome is written to the books as it happens. The paystub of each paycheck settled this
 * time is then sent, one at a time, whether or not the release went on to throw: those this device
 * asked Shield to pay, now or on an earlier release. A paycheck found paid that this device never
 * asked for was paid from another device, which sends its paystub; nothing is asked for it here.
 * Resolves whether the run stopped short (`stalled`: its events said where and why); throws what
 * stopped it from starting or going on.
 */
export async function releaseRun(ctx: ReleaseContext): Promise<{ stalled: boolean }> {
  const { wallet, network, runId, links } = ctx;
  const clock = ctx.queue?.clock ?? systemClock;
  const write = (workerId: string, target: Settlement) => ctx.updateCompany((c) => ({ ...c, payroll: settleTo(c.payroll, runId, workerId, target) }));
  const note = (workerId: string, target: Settlement) => void write(workerId, target).catch((e: unknown) => ctx.onError?.(e));
  const settled: Promise<string | null>[] = [];
  /** The paychecks this device has asked Shield to pay, on an earlier release or in this one: their paystubs are its to send. */
  const asked = new Set<string>();
  const onProgress = (e: PayQueueEvent) => {
    ctx.onEvent?.(e);
    switch (e.kind) {
      case "approving":
        asked.add(e.workerId);
        break;
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

  let stalled = false;
  let stopped: { error: unknown } | null = null;
  try {
    // The run as it is now, so a reopened panel resumes exactly what's outstanding.
    const books = await ctx.updateCompany((c) => c);
    const posted = books.payroll.runs.find((r) => r.id === runId);
    if (!posted) throw new Error("Pay run not found");
    for (const p of posted.paychecks) if (p.settlement.attempt || p.settlement.reference) asked.add(p.workerId);
    // Before a payment is called unconfirmed, it is looked for in this account's own transfers. Transfers the
    // books already hold as someone's settled paycheck are never found a second time, and while another open
    // paycheck is to the same person for the same amount, one known only by payee and amount is found for neither.
    const claimed = claimedTransfers(books.payroll.runs);
    const findPayment = paymentFinder(ctx, books, claimed);
    const releaser = await pickReleaser(ctx.releasers);

    // ---- What the markers say about each payment still owed -------------------------------
    // Left to the pay queue to refuse as it always has: a run that isn't on the rail, or someone with no account on it.
    const due = posted.mode === "rail" ? outstanding(posted) : [];
    const marking = due.length > 0 && due.every((p) => links.get(p.workerId));
    /** The payments nothing is sent for from here this time. */
    const held = new Set<string>();
    /** The payments no marker covers yet: marked before the first of them is asked for. */
    const fresh = new Set<string>();
    /** Every marker listed, as of the last reading. */
    let listed: ListedMarker[] = [];
    const hold = (workerId: string, why: string) => {
      held.add(workerId);
      ctx.onHeld?.(workerId, why);
    };

    if (marking) {
      const paid = posted.paychecks.filter((p) => p.net > 0n).map((p) => links.get(p.workerId));
      if (paid.some((to, i) => to !== undefined && paid.indexOf(to) !== i)) {
        // A marker tells payments apart by payee, period and amount, so a run holds one payment to an account.
        throw new Error("Two people in this run are paid to the same account, and a run on the rail pays an account once. Pay one of them outside the app, or change their account.");
      }
      try {
        listed = await ctx.markers.read();
      } catch (e) {
        throw new Error(`Nothing was paid: the notes this account keeps about its pay runs couldn't be read (${e instanceof Error ? e.message : String(e)})`);
      }
      // A record a listed marker has given up is one no payment waits on any longer, whichever device kept its tag.
      const givenUp = new Set(listed.flatMap((l) => l.marker.lines.flatMap((line) => (line.replaces !== undefined ? [line.replaces] : []))));
      // One Shield already holds a request for is only asked about: nothing is decided for it.
      const open = due.filter((p) => !(p.settlement.status === "pending" && p.settlement.reference));
      const payments = open.map((p): MarkedPayment => {
        const attempt = p.settlement.attempt && !givenUp.has(p.settlement.attempt) ? p.settlement.attempt : undefined;
        return {
          workerId: p.workerId,
          to: links.get(p.workerId)!,
          minor: centsToMinor(p.net),
          from: posted.periodStart,
          until: posted.periodEnd,
          ...(attempt ? { attempt } : {}),
          ...(p.settlement.replaces ? { replaces: p.settlement.replaces } : {}),
        };
      });
      const own = new Set(posted.paychecks.flatMap((p) => (p.settlement.marker ? [p.settlement.marker] : [])));
      const decisions = decideLines(listed, payments, own);

      /** Looks for a payment this device hasn't asked for (`tag`: the record a marker names for it); settles it if it is there. */
      const lookFor = async (payment: MarkedPayment, since: number, tag?: string): Promise<boolean> => {
        const query = { workerId: payment.workerId, to: payment.to, minor: payment.minor, ids: [], since, ...(tag ? { attempt: tag } : {}) };
        const answer = await findPayment(query).catch(() => "unknown" as const);
        if (typeof answer !== "object" || !isOnChainId(answer.found) || claimed.has(answer.found)) return false;
        let confirmed: ConfirmedTransaction | null = null;
        try {
          confirmed = await confirmTransaction(network, answer.found);
        } catch (e) {
          if (e instanceof TransactionRejected) return false;
        }
        claimed.add(answer.found); // one transfer settles one payment
        onProgress({
          kind: "settled",
          workerId: payment.workerId,
          transactionId: answer.found,
          ...(confirmed?.height !== undefined ? { height: confirmed.height } : {}),
          ...(confirmed?.feeMicrocredits !== undefined ? { feeMicrocredits: confirmed.feeMicrocredits } : {}),
          found: true,
        });
        return true;
      };

      /** By marker: the payments of a run another device marked that weren't found, in the run's order. */
      const elsewhere = new Map<string, { payment: MarkedPayment; since: number }[]>();
      for (const [i, decision] of decisions.entries()) {
        const payment = payments[i]!;
        const settlement = open[i]!.settlement;
        switch (decision.kind) {
          case "fresh":
            fresh.add(payment.workerId);
            break;
          case "refused":
            hold(
              payment.workerId,
              decision.why === "other-amount"
                ? `${NOT_FROM_HERE}: another device is paying this account a different amount for a pay period that overlaps this one. Open the run there, or restore the newest backup here.`
                : `${NOT_FROM_HERE}: another device is paying this from a different record than the one kept here. Open the run there.`,
            );
            break;
          case "resume":
            if (decision.tag !== undefined) {
              // Only that record pays it, on any device. A device that doesn't hold its tag yet hasn't asked for it: the
              // payment is looked for, no further back than its marker, and if it isn't there the tag is kept.
              const since = settlement.since ?? decision.since;
              if (settlement.attempt !== decision.tag && !(await lookFor(payment, since, decision.tag))) await write(payment.workerId, { status: "pending", attempt: decision.tag, since });
            } else if (!payment.attempt) {
              // A later payment of this device's own run that it holds no record for: looked for before it is asked for.
              await lookFor(payment, settlement.since ?? decision.since);
            }
            break;
          case "elsewhere":
            if (!(await lookFor(payment, decision.since))) {
              elsewhere.set(decision.marker, [...(elsewhere.get(decision.marker) ?? []), { payment, since: decision.since }]);
            }
            break;
        }
      }

      // ---- A run another device marked: wait, or go on with it -----------------------------
      if (elsewhere.size > 0) {
        const now = await chainNow(network);
        const after = await ctx.updateCompany((c) => c);
        const paychecks = after.payroll.runs.find((r) => r.id === runId)?.paychecks ?? [];
        for (const [markerId, lines] of elsewhere) {
          const waitFor = (why: string) => lines.forEach((l) => hold(l.payment.workerId, why));
          const theirs = listed.find((l) => l.marker.id === markerId)!;
          // That run's steps so far: its marker, then each payment of it the books now hold as settled.
          const steps = paychecks
            .filter((p) => p.settlement.status === "settled" && theirs.marker.lines.some((line) => line.to === links.get(p.workerId) && line.minor === centsToMinor(p.net)))
            .map((p) => ({ height: p.settlement.height, id: transactionIdOf(p.settlement.reference ?? "") }));
          if (steps.some((s) => s.height === undefined || s.id === null)) {
            waitFor(`${IN_PROGRESS}. When it last paid someone couldn't be read just now; try again in a minute.`);
            continue;
          }
          const last = steps.reduce<{ height: number; id: string | null }>((a, b) => (b.height! > a.height ? { height: b.height!, id: b.id } : a), { height: theirs.height, id: null });
          if (last.id === null) {
            // That run's first payment is the one its marker names a record for: it goes first, by spending that record.
            waitFor(`${IN_PROGRESS}. Its first payment hasn't been found yet, and the ones after it are paid from what that one leaves.`);
            continue;
          }
          const lastAt = await blockTime(network, last.height);
          if (now === null || lastAt === null) {
            waitFor(`${IN_PROGRESS}. When it last paid someone couldn't be read just now; try again in a minute.`);
            continue;
          }
          if (now - lastAt < TAKE_OVER_AFTER_MS) {
            waitFor(`${IN_PROGRESS}. If it has stopped there, this device can go on with it from ${clockTime(clock.now() + TAKE_OVER_AFTER_MS - (now - lastAt))}.`);
            continue;
          }
          // It has paid nobody for long enough. This device goes on from the record that run would have paid from next,
          // and no other: if a payment of that run is still on its way, the two spend the same record and one lands.
          // That record has to be the only one the account holds, so the device that started the run, opened again,
          // has no other record to pay the same person from.
          const first = lines[0]!;
          const records = await unspentRecords(wallet).catch(() => []);
          const record = records.length === 1 && records[0]!.madeBy === last.id ? records[0]! : undefined;
          if (!record || record.amount < first.payment.minor) {
            waitFor(
              `${IN_PROGRESS}, and this device can't go on with it: it would pay only from what that run's last payment left, and only while that is the one record Shield lists for this account. Go on with the run on the device that started it, or pay anyone it didn't pay in Shield; the run then finds the payment.`,
            );
            continue;
          }
          for (const [n, line] of lines.entries()) {
            await write(line.payment.workerId, { status: "pending", marker: markerId, since: line.since, ...(n === 0 ? { attempt: record.tag } : {}) });
          }
        }
      }
    }

    // ---- The step before the first payment: the marker --------------------------------------
    /** Sends one marker and waits until it is listed; throws when another device's came first. */
    const mark = async (lines: MarkerLine[]): Promise<void> => {
      const marker: RunMarker = { v: MARKER_VERSION, id: newMarkerId(), from: posted.periodStart, until: posted.periodEnd, lines };
      // Kept before it is sent: a marker that lands after Shield reported an error is still known as this device's own.
      await ctx.updateCompany((c) => ({ ...c, payroll: lines.reduce((payroll, line) => keepMarker(payroll, runId, workerOf(line.to), marker.id), c.payroll) }));
      await ctx.markers.send(marker);
      listed = await ctx.markers.awaitListed(marker.id);
      if (beaten(listed, marker.id)) throw new Error(MARKED_FIRST);
    };
    const workerOf = (to: string): string => posted.paychecks.find((p) => p.net > 0n && links.get(p.workerId) === to)!.workerId;
    const settlementOf = async (workerId: string): Promise<Settlement | undefined> =>
      (await ctx.updateCompany((c) => c)).payroll.runs.find((r) => r.id === runId)?.paychecks.find((p) => p.workerId === workerId)?.settlement;

    const beforeTransfers = async (lines: readonly QueuedLine[]) => {
      const unmarked = lines.filter((l) => fresh.has(l.workerId));
      if (unmarked.length === 0) return;
      const marked: MarkerLine[] = [];
      for (const l of unmarked) {
        const replaces = (await settlementOf(l.workerId))?.replaces;
        marked.push({ to: l.to, minor: l.minor, ...(l.attempt ? { tag: l.attempt } : {}), ...(replaces && replaces !== l.attempt ? { replaces } : {}) });
      }
      await mark(marked);
      for (const l of unmarked) fresh.delete(l.workerId);
    };

    // The record each transfer will spend is kept just before Shield is asked for it, with the chain's height when
    // the run began: a later run, after a pause or a reload, checks the record instead of paying twice, and a later
    // look reads back no further than that height.
    const beforeSend = async (workerId: string, attempt: string, since?: number) => {
      const before = await settlementOf(workerId);
      const gaveUp = before?.attempt && before.attempt !== attempt ? before.attempt : undefined;
      await write(workerId, { status: "pending", attempt, ...(since !== undefined ? { since } : {}), ...(gaveUp ? { replaces: gaveUp } : {}) });
      // The payment is being asked again from another record (the one it held went into something else). If a listed
      // marker names the old record, a new line takes its place before Shield is asked, so every device follows the new one.
      if (gaveUp && marking && listed.some((l) => l.marker.lines.some((line) => line.tag === gaveUp))) {
        await mark([{ to: links.get(workerId)!, minor: centsToMinor(posted.paychecks.find((p) => p.workerId === workerId)!.net), tag: attempt, replaces: gaveUp }]);
      }
    };

    // ---- Pay ---------------------------------------------------------------------------------
    // The run as the books hold it after all that, less the payments nothing is sent for from here.
    const now = (await ctx.updateCompany((c) => c)).payroll.runs.find((r) => r.id === runId)!;
    const run = { ...now, paychecks: now.paychecks.filter((p) => !held.has(p.workerId)) };
    // First, how many times Shield will ask: the marker, the payments, then the paystubs.
    const plan = releaser.prompts(run, links);
    const toMark = plan.filter((p) => p.kind === "payment" && fresh.has(p.workerId)).length;
    ctx.onPrompts?.([...(toMark > 0 ? [{ kind: "marker" as const, program: LETTERS_PROGRAM, fn: markerFunction(toMark), lines: toMark }] : []), ...plan]);
    stalled = !!(await releaser.release({ wallet, network, run, links, onProgress, beforeSend, findPayment, ...(marking ? { beforeTransfers } : {}), ...ctx.queue })).stalled;
    await ctx.onPaid?.();
  } catch (error) {
    stopped = { error };
  }
  // Then the paystub of each paycheck settled this time that this device asked for, one letter (one approval) at a
  // time; `deliver` never throws.
  for (const workerId of await Promise.all(settled)) if (workerId && asked.has(workerId)) await ctx.deliver(workerId);
  if (stopped) throw stopped.error;
  return { stalled };
}

/** Notes on one paycheck the marker this device is about to send for it. A paycheck called failed goes back to pending: it is about to be asked for. */
function keepMarker(payroll: Payroll, runId: string, workerId: string, marker: string): Payroll {
  const current = payroll.runs.find((r) => r.id === runId)?.paychecks.find((p) => p.workerId === workerId)?.settlement;
  if (!current || current.status === "settled") return payroll;
  const { status: _status, failure: _failure, ...kept } = current;
  return markPaycheckSettlement(payroll, runId, workerId, current.status === "failed" ? { status: "pending", ...kept, marker } : { ...current, marker });
}

// ---- Pay again --------------------------------------------------------------------------------

/**
 * What "pay again" did. "same-record": the record the last try set aside is still listed, so the
 * next try spends that one and the network lets at most one of the two land. "another-record":
 * that record is known to have gone into something that didn't pay them, so the next try takes
 * another (and says so to the account's other devices). "check-later": the record is gone and what
 * it went into couldn't be read, or a payment to them was found: nothing changes but the line's
 * words, and the next release looks again.
 */
export type PayAgain = "same-record" | "another-record" | "check-later";

/**
 * The person checked Shield's activity and found no payment: this paycheck is to be paid again on
 * the next release. A second record is never taken on that word alone. While the record its last
 * try set aside is still listed, it keeps that record. Once it's gone, the payment is looked for
 * in the account's own transfers, and only an answer that the record went into something that
 * didn't pay them frees the paycheck to take another. If Shield can't be asked, the record is kept
 * and the next release finds out.
 */
export async function payAgain(ctx: Pick<ReleaseContext, "wallet" | "network" | "runId" | "links" | "updateCompany" | "lookup" | "queue">, workerId: string): Promise<PayAgain> {
  const { runId } = ctx;
  const clock = ctx.queue?.clock ?? systemClock;
  const books = await ctx.updateCompany((c) => c);
  const paycheck = books.payroll.runs.find((r) => r.id === runId)?.paychecks.find((p) => p.workerId === workerId);
  const was = paycheck?.settlement;
  const tried = was?.attempt;
  const to = ctx.links.get(workerId);
  let record: "listed" | "elsewhere" | "unknown" = "listed";
  if (paycheck && tried && !(await recordStillListed(ctx.wallet, tried).catch(() => true))) {
    const ids = isOnChainId(was.reference) ? [was.reference] : [];
    const answer = to
      ? await paymentFinder(ctx, books, claimedTransfers(books.payroll.runs))({ workerId, to, minor: centsToMinor(paycheck.net), attempt: tried, ids, ...(was.since !== undefined ? { since: was.since } : {}) }).catch(() => "unknown" as const)
      : "unknown";
    record = answer === "none" ? "elsewhere" : "unknown";
  }
  let outcome: PayAgain = "same-record";
  await ctx.updateCompany((c) => {
    const now = c.payroll.runs.find((r) => r.id === runId)?.paychecks.find((p) => p.workerId === workerId)?.settlement;
    if (!now || now.status === "settled") return c;
    // A tag that changed since Shield was asked is one nothing was checked for: it is kept.
    const checked = now.attempt === tried ? record : "listed";
    if (checked === "unknown") {
      outcome = "check-later";
      const again = clockTime(clock.now() + DEFAULT_LIMITS.notSeenAfterMs);
      const { status: _status, failure: _failure, ...kept } = now;
      const failure = `${NOT_CONFIRMED}: check again at ${again}. The record this payment set aside is no longer listed, and what it went into couldn't be read yet, so nothing was sent again.`;
      return { ...c, payroll: settleTo(c.payroll, runId, workerId, { status: "pending", ...kept, failure }) };
    }
    outcome = checked === "elsewhere" ? "another-record" : "same-record";
    return { ...c, payroll: settleTo(c.payroll, runId, workerId, payAgainTarget(now, checked === "listed")) };
  });
  return outcome;
}
