"use client";

// ---------------------------------------------------------------------------
// The pay panel: settles one rail run through Shield, one private USDCx
// transfer per person, one at a time, each made from what the last one left
// (@pnw/rail, through the release seam in release.ts). Opened from the pay
// runs list right after a rail run posts, and again from Continue / Retry.
//
// Shield has one prompt open at a time. Before the first, the panel says about
// how many times Shield will ask (release.ts `promptSummary`); while a payment's
// prompt is open, its line shows the payee's full account and the amount in
// millionths of a dollar, the two things Shield's own screen gives for it. A
// payment that doesn't settle stops the run there: the people after it wait,
// untouched, and Continue takes them up.
//
// Every outcome is written to the vault as it happens, so closing the tab
// loses nothing: a transfer Shield has taken keeps its id on the pending
// paycheck and is watched, not re-sent, when the run is reopened; a failed
// one is retried; a settled one is never touched again.
//
// A payment Shield didn't confirm is never called failed on that alone: the
// queue first looks for it in the account's own transfers (sent_payment.ts:
// Shield's history for ids, the explorer for what each was) and settles it if
// it is there. "Pay again" keeps the record the last try set aside while that
// record is still listed, so only one of the two tries can land
// (pay_outcome.ts).
//
// The moment a paycheck settles its paystub goes to the person through the
// mailbox (deliver.ts). That is a courtesy on top of the payment: a send that
// fails leaves the settlement exactly as it is and offers a Send button.
//
// Before Shield is asked for anything, on every press (Pay now, Continue,
// Retry, the run after Pay again), each person is checked against their
// agreement: the business's own agreement record must name the account the
// books pay them at, and the agreement must still be active on chain
// (payee_check.ts). Anyone who doesn't pass is held: Shield is never asked to
// pay them, their line says why, and everyone else is paid as usual.
//
// No address, record or signature is ever logged from here.
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useRef, useState } from "react";
import { type Paycheck, type Payroll, type Settlement, markPaycheckSettlement } from "@pnw/payroll";
import {
  type PayQueueEvent,
  type PaymentQuery,
  type RailWallet,
  explorerNetwork,
  fetchTokenRecords,
  formatMinorAsDollars,
  outstanding,
  totalBalance,
} from "@pnw/rail";
import { Button } from "@pnw/ui/button";
import { cn } from "@pnw/ui/utils";
import { AleoWalletProviderWrapper } from "@pnw/wallet/wallet-provider";
import { FormError, errorMessage } from "@/books/AuthCard";
import { useOpenBooks } from "@/books/BooksProvider";
import { Money } from "@/books/display";
import { afterStep, noteProgress } from "@/books/idle_lock";
import { payableLinks, payableRailLinks, shortAddress } from "@/books/rail";
import { ShieldStatus } from "./ShieldStatus";
import { decryptTransition } from "./decrypt";
import {
  FOUND_NOTE,
  LOOKING,
  type RailRecord,
  dueFromRail,
  lookQuery,
  payAgainTarget,
  recordListedForPayAgain,
  shortOnRail,
  stagesAfterPress,
  tagRecords,
  unconfirmedLabel,
} from "./pay_outcome";
import { checkPayees, holdMessage, payeesToCheck } from "./payee_check";
import { pickReleaser, promptSummary } from "./release";
import { type SentRead, findSentPayment } from "./sent_payment";
import { useShield } from "./shield";
import { usePaystubDelivery } from "./usePaystubDelivery";

export type PayPanelProps = { runId: string; onClose: () => void };

export default function PayPanel(props: PayPanelProps) {
  return (
    <AleoWalletProviderWrapper>
      <div className="flex flex-col gap-4 rounded-md border bg-muted/40 p-4">
        <PayFlow {...props} />
      </div>
    </AleoWalletProviderWrapper>
  );
}

// ---- Wallet ----------------------------------------------------------------------------

/** The slice of the adaptor the queue needs, bound to the connected account. */
function toRailWallet(wallet: ReturnType<typeof useShield>["wallet"], address: string): RailWallet {
  return {
    address,
    requestRecords: (program, all) => wallet.requestRecords(program, all),
    executeTransaction: async (opts) => {
      const r = await wallet.executeTransaction(opts);
      if (!r?.transactionId) throw new Error("Shield didn't take the payment");
      return r;
    },
    transactionStatus: (id) => wallet.transactionStatus(id),
  };
}

// ---- Vault writes -----------------------------------------------------------------

/** Moves one paycheck to `target` through whatever intermediate step the rules need. */
function settleTo(payroll: Payroll, runId: string, workerId: string, target: Settlement): Payroll {
  const current = payroll.runs.find((r) => r.id === runId)?.paychecks.find((p) => p.workerId === workerId)?.settlement;
  if (!current || current.status === "settled") return payroll; // never touch a settled paycheck
  let next = payroll;
  if (current.status === "failed") next = markPaycheckSettlement(next, runId, workerId, { status: "pending" }); // a retry
  if (target.status === "pending" && !target.reference && !target.attempt && !target.failure) return next; // nothing to note
  return markPaycheckSettlement(next, runId, workerId, target);
}

// ---- Per-person progress ------------------------------------------------------------

type Stage =
  | { kind: "waiting" }
  /** Shield's prompt for this payment is open: `to` and `minor` are the account and the amount it was given. */
  | { kind: "approving"; to: string; minor: bigint }
  | { kind: "sent" }
  /** Shield didn't confirm it, and the account's own transfers are being looked through for it. */
  | { kind: "looking" }
  /** `found`: Shield never confirmed it; the queue found it in the account's own transfers. */
  | { kind: "settled"; transactionId: string; feeMicrocredits?: bigint; found?: true }
  | { kind: "failed"; failure: string }
  /** The check of this person's agreement didn't pass this press, so Shield wasn't asked to pay them: `why` says so, naming them. */
  | { kind: "held"; why: string }
  /** It may have gone through: it goes again only by spending the same record (Continue), or when the person says so (Pay again). */
  | { kind: "unconfirmed"; failure: string };

/** What a paycheck looks like before the queue says anything about it this session. */
function stageOf(p: Paycheck): Stage {
  const s = p.settlement;
  if (s.status === "settled") return { kind: "settled", transactionId: s.reference ?? "", ...(s.feeMicrocredits !== undefined ? { feeMicrocredits: s.feeMicrocredits } : {}) };
  if (s.status === "failed") return { kind: "failed", failure: s.failure ?? "Payment failed" };
  if (s.failure) return { kind: "unconfirmed", failure: s.failure };
  return s.reference ? { kind: "sent" } : { kind: "waiting" };
}

function stageLabel(stage: Stage): string {
  switch (stage.kind) {
    case "waiting":
      return "Waiting";
    case "approving":
      return "Approve in Shield";
    case "sent":
      return "Sent";
    case "looking":
      return LOOKING;
    case "settled":
      return `${stage.transactionId ? `Settled · ${shortAddress(stage.transactionId)}` : "Settled"}${stage.found ? ` · ${FOUND_NOTE}` : ""}`;
    case "failed":
      return `Failed · ${stage.failure}`;
    case "held":
      return `Not paid · ${stage.why}`;
    case "unconfirmed":
      return unconfirmedLabel(stage.failure);
  }
}

// ---- Paystub delivery, per person ---------------------------------------------------------

/** Where this session's send of one paystub stands; the vault's `delivery` covers earlier sessions. */
type Delivery = { kind: "sending" } | { kind: "sent" } | { kind: "failed"; message: string };

// ---- The flow ----------------------------------------------------------------------------

function PayFlow({ runId, onClose }: PayPanelProps) {
  const { rail, payroll, updateCompany } = useOpenBooks();
  const { state, route, connect, error: shieldError, wallet } = useShield();
  const sendPaystub = usePaystubDelivery(wallet);
  const run = payroll.runs.find((r) => r.id === runId);
  const names = useMemo(() => new Map(payroll.workers.map((w) => [w.id, w.name])), [payroll.workers]);
  const [records, setRecords] = useState<RailRecord[] | null>(null);
  const [stages, setStages] = useState<Record<string, Stage>>({});
  const [deliveries, setDeliveries] = useState<Record<string, Delivery>>({});
  const [note, setNote] = useState<string | null>(null);
  // Why the last press of Pay now or Continue stopped part-way, in the queue's words; null when it didn't.
  const [stopped, setStopped] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [againFor, setAgainFor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const loadedFor = useRef<string | null>(null);
  // What the looks for unconfirmed payments have read from the explorer this session, by transaction id.
  const reads = useRef(new Map<string, SentRead>());

  /** Sends one settled paycheck's paystub; never throws, never touches the settlement. */
  async function deliver(workerId: string) {
    setDeliveries((all) => ({ ...all, [workerId]: { kind: "sending" } }));
    try {
      await sendPaystub(runId, workerId);
      noteProgress();
      setDeliveries((all) => ({ ...all, [workerId]: { kind: "sent" } }));
    } catch (e) {
      setDeliveries((all) => ({ ...all, [workerId]: { kind: "failed", message: errorMessage(e) } }));
    }
  }

  /** "Paystub sent", or "Paystub not sent" with a Send button, after a settled paycheck's status. */
  function paystubNote(p: Paycheck) {
    if (p.settlement.status !== "settled") return null;
    const d = deliveries[p.workerId] ?? (p.delivery ? { kind: "sent" as const } : null);
    if (d?.kind === "sending") return <span className="basis-full text-xs text-muted-foreground sm:basis-auto">Sending paystub…</span>;
    if (d?.kind === "sent") return <span className="basis-full text-xs text-muted-foreground sm:basis-auto">Paystub sent</span>;
    return (
      <span className="basis-full text-xs text-muted-foreground sm:basis-auto">
        Paystub not sent
        {d?.kind === "failed" && d.message && ` · ${d.message}`}
        {!running && (
          <Button type="button" variant="link" size="sm" className="ml-1 h-auto p-0 text-xs" onClick={() => void deliver(p.workerId)}>
            Send
          </Button>
        )}
      </span>
    );
  }

  const address = state.kind === "connected" ? state.address : null;
  const mismatch = address !== null && rail !== null && address !== rail.address;

  // Balance on the rail, read once per connected account.
  useEffect(() => {
    if (!address || mismatch || loadedFor.current === address) return;
    loadedFor.current = address;
    fetchTokenRecords(toRailWallet(wallet, address))
      .then(tagRecords)
      .then(setRecords, (e: unknown) => setError(errorMessage(e)));
  }, [address, mismatch, wallet]);

  if (!rail) return <FormError message="Link Shield in Settings first" />;
  if (!run) return <FormError message="Pay run not found" />;
  if (run.mode !== "rail") return <FormError message="This run was paid outside the app" />;

  const due = outstanding(run);
  const everyone = run.paychecks.filter((p) => p.net > 0n); // settled ones stay on the board
  const totalDue = due.reduce((s, p) => s + p.net, 0n);
  const balance = records ? totalBalance(records) : null;
  // Short only for what the next press pays from the rail: a payment Shield already took is asked about, and one
  // whose kept record is gone is looked for, so neither needs funds now (pay_outcome.ts `dueFromRail`).
  const short = shortOnRail(balance, dueFromRail(due, records ?? []), stopped);
  const attempted = due.some((p) => p.settlement.status === "failed" || p.settlement.reference || p.settlement.attempt);
  const stage = (p: Paycheck): Stage => stages[p.workerId] ?? stageOf(p);
  // Only people whose agreement both sides approved; an offer not yet accepted can't be paid.
  const links = payableLinks(rail);
  // The same links, whole: what each person's agreement is checked against before Shield is asked to pay them.
  const railLinks = payableRailLinks(rail);
  const unlinked = due.filter((p) => !links.has(p.workerId));

  /**
   * The person checked Shield's activity and found no payment: this paycheck is paid again on the
   * next run. While the record its last try set aside is still listed, it keeps that record, so the
   * network lets only one of the two tries through; once it's gone, it takes a fresh one. If Shield
   * can't be asked, the record is kept and the next run finds out.
   */
  async function payAgain(workerId: string) {
    setAgainFor(null);
    setError(null);
    try {
      const tried = run?.paychecks.find((p) => p.workerId === workerId)?.settlement.attempt;
      const listed = !!tried && !!address && (await recordListedForPayAgain(toRailWallet(wallet, address), tried));
      await updateCompany((c) => {
        const now = c.payroll.runs.find((r) => r.id === runId)?.paychecks.find((p) => p.workerId === workerId)?.settlement;
        // A tag that changed since Shield was asked is one nothing was checked for: it is kept.
        return { ...c, payroll: settleTo(c.payroll, runId, workerId, payAgainTarget(now, now?.attempt === tried ? listed : true)) };
      });
      setStages((all) => {
        const { [workerId]: _gone, ...rest } = all;
        return rest;
      });
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  async function start(current: string) {
    if (!run) return;
    setRunning(true);
    setError(null);
    // Where an earlier press stopped: still true if this one is refused before anything is asked.
    const noteBefore = note;
    setNote(null);
    const railWallet = toRailWallet(wallet, current);
    const setStage = (workerId: string, s: Stage) => setStages((all) => ({ ...all, [workerId]: s }));
    // Each step of the run counts as activity for the idle lock, so books left open while the person approves in Shield
    // don't lock mid-run: "planned" at once, and every write of the run (the record kept before each approval, then
    // the payment's outcome) once it has settled, so a step that lands after the 15 minutes keeps its result before
    // the books lock. A wait for an approval ("approving"), "broadcast" and "stalled" (the run has stopped) don't count.
    const write = (workerId: string, target: Settlement) => afterStep(updateCompany((c) => ({ ...c, payroll: settleTo(c.payroll, runId, workerId, target) })));
    const settled: Promise<string | null>[] = [];
    // Who this press holds back, once each agreement has been checked: never asked of Shield.
    let held: ReadonlySet<string> = new Set();
    let stalledWhy: string | null = null;
    let refused = false;
    const onProgress = (e: PayQueueEvent) => {
      switch (e.kind) {
        case "planned":
          noteProgress();
          for (const p of due) if (!held.has(p.workerId)) setStage(p.workerId, { kind: "waiting" });
          break;
        case "approving":
          setStage(e.workerId, { kind: "approving", to: e.to, minor: e.minor });
          break;
        case "stalled":
          stalledWhy = e.why;
          setNote(`Stalled at ${e.at} of ${e.of}: ${e.why}.`);
          break;
        case "sent":
          setStage(e.workerId, { kind: "sent" });
          void write(e.workerId, {
            status: "pending",
            reference: e.reference,
            ...(e.attempt ? { attempt: e.attempt } : {}),
            ...(e.since !== undefined ? { since: e.since } : {}),
            ...(e.endedAt ? { endedAt: e.endedAt } : {}),
          }).catch((err: unknown) => setError(errorMessage(err)));
          break;
        case "broadcast":
          break;
        case "settled":
          setStage(e.workerId, {
            kind: "settled",
            transactionId: e.transactionId,
            ...(e.feeMicrocredits !== undefined ? { feeMicrocredits: e.feeMicrocredits } : {}),
            ...(e.found ? { found: true as const } : {}),
          });
          // The paystub goes out once everyone is paid (a letter is its own Shield approval, so
          // it never races the payments); a failed send never touches the settlement.
          settled.push(
            write(e.workerId, {
              status: "settled",
              reference: e.transactionId,
              settledAt: new Date().toISOString(),
              ...(e.height !== undefined ? { height: e.height } : {}),
              ...(e.feeMicrocredits !== undefined ? { feeMicrocredits: e.feeMicrocredits } : {}),
            }).then(
              () => e.workerId,
              (err: unknown) => {
                setError(errorMessage(err));
                return null;
              },
            ),
          );
          break;
        case "failed":
          setStage(e.workerId, { kind: "failed", failure: e.failure });
          void write(e.workerId, { status: "failed", failure: e.failure, ...(e.attempt ? { attempt: e.attempt } : {}), ...(e.since !== undefined ? { since: e.since } : {}) }).catch(
            (err: unknown) => setError(errorMessage(err)),
          );
          break;
        case "unconfirmed":
          setStage(e.workerId, { kind: "unconfirmed", failure: e.failure });
          void write(e.workerId, {
            status: "pending",
            failure: e.failure,
            ...(e.reference ? { reference: e.reference } : {}),
            ...(e.attempt ? { attempt: e.attempt } : {}),
            ...(e.since !== undefined ? { since: e.since } : {}),
            ...(e.endedAt ? { endedAt: e.endedAt } : {}),
          }).catch((err: unknown) => setError(errorMessage(err)));
          break;
      }
    };
    // The record each transfer will spend is kept just before Shield is asked for it, with the chain's height when
    // the run began: a later run, after a pause or a reload, checks the record instead of paying twice, and a later
    // look reads back no further than that height.
    const beforeSend = async (workerId: string, attempt: string, since?: number) => {
      await write(workerId, { status: "pending", attempt, ...(since !== undefined ? { since } : {}) });
    };
    try {
      // The run as it is now, so a reopened panel resumes exactly what's outstanding.
      const books = await updateCompany((c) => c);
      const latest = books.payroll.runs.find((r) => r.id === runId)!;
      const network = explorerNetwork();
      // Before a payment is called unconfirmed, it is looked for in this account's own transfers, with what the
      // books say about every other payment (lookQuery): transfers they already hold as someone's settled paycheck
      // are never found a second time, and while another open paycheck is to the same person for the same amount,
      // one known only by payee and amount is found for neither. It is told this account, so a public transfer that
      // names another sender isn't taken for this account's payment.
      // Each person's account on the rail, payable right now or not: for telling whose a transfer could be, more is safer.
      const accounts = new Map((books.rail?.links ?? []).map((l) => [l.workerId, l.address]));
      const findPayment = (q: PaymentQuery) => {
        setStage(q.workerId, { kind: "looking" }); // no longer "Approve in Shield" while it is looked for
        return findSentPayment({
          ...lookQuery(books.payroll.runs, accounts, runId, q),
          account: current,
          deps: {
            wallet: {
              requestRecords: (program, all) => wallet.requestRecords(program, all),
              requestTransactionHistory: (program) => wallet.requestTransactionHistory(program),
              transitionViewKeys: (id) => wallet.transitionViewKeys(id),
            },
            network,
            decrypt: decryptTransition,
            cache: reads.current,
          },
        });
      };
      // How the run is paid: the one-at-a-time queue, the only way there is today. First, about how many times Shield will ask.
      const releaser = await pickReleaser();
      // Each person Shield may be asked to pay is checked against their agreement first; whoever doesn't pass is held,
      // with why on their line, and the run pays everyone else. What an earlier press held is checked again.
      setStages((all) => Object.fromEntries(Object.entries(all).filter(([, s]) => s.kind !== "held")));
      const holds = await checkPayees({
        payees: payeesToCheck(latest, railLinks),
        account: current,
        requestRecords: (program, all) => wallet.requestRecords(program, all),
        network,
      });
      held = new Set(holds.keys());
      for (const [workerId, reason] of holds) setStage(workerId, { kind: "held", why: holdMessage(names.get(workerId) ?? "This person", reason) });
      setNote(promptSummary(releaser.prompts(latest, links, held)));
      await releaser.release({ wallet: railWallet, network, run: latest, links, held, onProgress, beforeSend, findPayment });
      setStopped(stalledWhy);
      loadedFor.current = null; // re-read the balance
      setRecords(await fetchTokenRecords(railWallet).then(tagRecords).catch(() => records ?? []));
    } catch (e) {
      refused = true;
      setError(errorMessage(e));
    }
    // A line the run never reached reads from the books again: what an earlier run left it, with its button.
    setStages((all) => stagesAfterPress(all));
    // Then each paystub settled this time, one letter (one approval) at a time; `deliver` never throws.
    for (const workerId of await Promise.all(settled)) if (workerId) await deliver(workerId);
    // Everything it said Shield would ask has been asked; where a run stopped stays up.
    if (refused) setNote(noteBefore);
    else if (!stalledWhy) setNote(null);
    setRunning(false);
  }

  return (
    <>
      <div>
        <h3 className="text-sm font-semibold">Pay on the rail</h3>
        <p className="text-xs text-muted-foreground">
          {run.payDate} · {due.length === 0 ? "everyone is paid" : `${due.length} of ${run.paychecks.length} still to pay`}
        </p>
      </div>

      {due.length === 0 ? (
        <>
          <ul className="divide-y rounded-md border bg-card text-sm">
            {everyone.map((p) => (
              <li key={p.workerId} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
                <span className="min-w-0 flex-1 truncate font-medium">{names.get(p.workerId) ?? p.workerId}</span>
                <Money cents={p.net} />
                <span className="basis-full text-xs text-money-positive sm:basis-auto">{stageLabel(stage(p))}</span>
                {paystubNote(p)}
              </li>
            ))}
          </ul>
          <Button variant="outline" className="min-h-11 self-start sm:min-h-9" onClick={onClose}>
            Done
          </Button>
        </>
      ) : !address ? (
        <ShieldStatus state={state} route={route} connect={connect} onClose={onClose} />
      ) : mismatch ? (
        <>
          <p className="text-sm">
            Shield is signed in to a different account ({shortAddress(address)}) than the one linked to these books ({shortAddress(rail.address)}).
            Switch accounts in Shield, then try again.
          </p>
          <Button variant="outline" className="min-h-11 self-start sm:min-h-9" onClick={onClose}>
            Close
          </Button>
        </>
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <dt className="text-xs text-muted-foreground">On the rail</dt>
              <dd className={cn("tabular-nums", short && "text-money-negative")}>{balance === null ? "Reading…" : `$${formatMinorAsDollars(balance)}`}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">This run, net</dt>
              <dd className="font-semibold">
                <Money cents={totalDue} />
              </dd>
            </div>
          </dl>
          {short && <p className="text-xs text-money-negative">Not enough on the rail for this run. Add funds to the account, then try again.</p>}
          {unlinked.length > 0 && (
            <p className="text-xs text-money-negative">
              {unlinked.map((p) => names.get(p.workerId) ?? p.workerId).join(", ")} can&apos;t be paid on the rail yet: they need an accepted offer (Settings →
              Import team, or Jobs → Offers).
            </p>
          )}

          <ul className="divide-y rounded-md border bg-card text-sm">
            {everyone.map((p) => {
              const s = stage(p);
              return (
                <li key={p.workerId} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
                  <span className="min-w-0 flex-1 truncate font-medium">{names.get(p.workerId) ?? p.workerId}</span>
                  <Money cents={p.net} />
                  <span
                    className={cn(
                      "basis-full text-xs sm:basis-auto",
                      s.kind === "settled"
                        ? "text-money-positive"
                        : s.kind === "failed" || s.kind === "held"
                          ? "text-money-negative"
                          : s.kind === "unconfirmed"
                            ? "text-amber-700 dark:text-amber-400"
                            : "text-muted-foreground",
                    )}
                  >
                    {stageLabel(s)}
                    {s.kind === "approving" && (
                      <>
                        {" · to "}
                        <span className="break-all">{s.to}</span>
                        {` · ${s.minor.toString()} millionths of a dollar (how Shield's Advanced details show them)`}
                      </>
                    )}
                    {s.kind === "failed" && !running && (
                      <Button type="button" variant="link" size="sm" className="ml-1 h-auto p-0 text-xs" onClick={() => void start(address)}>
                        Retry
                      </Button>
                    )}
                    {s.kind === "unconfirmed" && !running && againFor !== p.workerId && (
                      <Button type="button" variant="link" size="sm" className="ml-1 h-auto p-0 text-xs" onClick={() => setAgainFor(p.workerId)}>
                        Pay again anyway
                      </Button>
                    )}
                  </span>
                  {againFor === p.workerId && (
                    <span className="flex basis-full flex-wrap items-center gap-2 text-xs">
                      Only if Shield&apos;s activity shows no payment to {names.get(p.workerId) ?? "them"} for <Money cents={p.net} />.
                      <Button type="button" variant="destructive" size="sm" className="min-h-11 sm:min-h-7" onClick={() => void payAgain(p.workerId)}>
                        Pay again
                      </Button>
                      <Button type="button" variant="outline" size="sm" className="min-h-11 sm:min-h-7" onClick={() => setAgainFor(null)}>
                        Keep it
                      </Button>
                    </span>
                  )}
                  {paystubNote(p)}
                </li>
              );
            })}
          </ul>
          {note && <p className="text-xs text-muted-foreground">{note}</p>}
          <p className="text-xs text-muted-foreground">
            Shield asks you to approve each payment, one at a time: each is paid from what the last one left, so the next prompt comes up once the
            one before has settled. The employer pays the network fee on each one; nothing is taken from anyone&apos;s pay.
          </p>
          <div className="flex flex-wrap gap-3">
            <Button className="min-h-11 sm:min-h-9" disabled={running || short || balance === null || unlinked.length > 0} onClick={() => void start(address)}>
              {running ? "Paying…" : attempted ? "Continue" : "Pay now"}
            </Button>
            <Button variant="outline" className="min-h-11 sm:min-h-9" disabled={running} onClick={onClose}>
              {running ? "Keep open" : "Close"}
            </Button>
          </div>
        </>
      )}
      <FormError message={error ?? shieldError} />
    </>
  );
}
