"use client";

// ---------------------------------------------------------------------------
// The pay panel: settles one rail run through Shield, one private USDCx
// transfer per person, one at a time, each made from what the last one left
// (@pnw/rail, through release.ts, which holds the release itself: this file
// is what it looks like). Opened from the pay runs list right after a rail
// run posts, and again from Continue / Retry.
//
// Shield has one prompt open at a time. Before the first, the panel says how
// many times Shield will ask (release.ts `promptSummary`); while a payment's
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
// record is still listed, so only one of the two tries can land, and takes
// another only once that record is known to have gone into something that
// didn't pay them (release.ts `payAgain`).
//
// Before the first payment of a run, one note goes to the business's own
// account saying what the run is about to pay (run_marker.ts), so another
// device with the same books pays nobody again: there, a line already being
// paid says so, and nothing is sent for it.
//
// The moment a paycheck settles its paystub goes to the person through the
// mailbox (deliver.ts). That is a courtesy on top of the payment: a send that
// fails leaves the settlement exactly as it is and offers a Send button.
//
// No address, record or signature is ever logged from here.
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useRef, useState } from "react";
import type { Paycheck } from "@pnw/payroll";
import {
  type PayQueueEvent,
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
import { payableLinks, shortAddress } from "@/books/rail";
import { ShieldStatus } from "./ShieldStatus";
import { decryptTransition } from "./decrypt";
import {
  FOUND_NOTE,
  LOOKING,
  type RailRecord,
  dueFromRail,
  shortOnRail,
  stagesAfterPress,
  tagRecords,
  unconfirmedLabel,
} from "./pay_outcome";
import { type ReleaseContext, payAgain as payAgainFrom, promptSummary, releaseRun } from "./release";
import { markerDesk } from "./run_marker";
import type { SentRead } from "./sent_payment";
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
  /** It may have gone through: it goes again only by spending the same record (Continue), or when the person says so (Pay again). */
  | { kind: "unconfirmed"; failure: string }
  /** Nothing is sent for it from this device this time: `why` says what it waits on (release.ts `onHeld`). */
  | { kind: "held"; why: string };

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
    case "unconfirmed":
      return unconfirmedLabel(stage.failure);
    case "held":
      return stage.why;
  }
}

// ---- Paystub delivery, per person ---------------------------------------------------------

/** Where this session's send of one paystub stands; the vault's `delivery` covers earlier sessions. */
type Delivery = { kind: "sending" } | { kind: "sent" } | { kind: "failed"; message: string };

// ---- The flow ----------------------------------------------------------------------------

function PayFlow({ runId, onClose }: PayPanelProps) {
  const { rail, payroll, username, noteSealer, updateCompany } = useOpenBooks();
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
  const unlinked = due.filter((p) => !links.has(p.workerId));

  /** What a release and "pay again" both read: Shield as the queue asks it, the explorer, and the look for a payment Shield didn't confirm. */
  const reach = (current: string): Pick<ReleaseContext, "wallet" | "network" | "runId" | "links" | "updateCompany" | "lookup"> => ({
    wallet: toRailWallet(wallet, current),
    network: explorerNetwork(),
    runId,
    links,
    updateCompany,
    lookup: {
      wallet: {
        requestRecords: (program, all) => wallet.requestRecords(program, all),
        requestTransactionHistory: (program) => wallet.requestTransactionHistory(program),
        transitionViewKeys: (id) => wallet.transitionViewKeys(id),
      },
      decrypt: decryptTransition,
      cache: reads.current,
    },
  });

  /**
   * The person checked Shield's activity and found no payment: this paycheck is paid again on the
   * next run (release.ts `payAgain`). While the record its last try set aside is still listed, it
   * keeps that record, so the network lets only one of the two tries through. It takes another
   * only once that record is known to have gone into something that didn't pay them; until that
   * can be read, the line says when to check again and nothing is sent.
   */
  async function payAgain(workerId: string) {
    setAgainFor(null);
    setError(null);
    if (!address) return;
    try {
      await payAgainFrom(reach(address), workerId);
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
    const within = reach(current);
    const setStage = (workerId: string, s: Stage) => setStages((all) => ({ ...all, [workerId]: s }));
    // What an earlier release said was waiting on another device is asked afresh.
    setStages((all) => Object.fromEntries(Object.entries(all).filter(([, s]) => s.kind !== "held")));
    // The lines this release has already spoken for before the queue plans: held, or found paid from another device.
    const spoken = new Set<string>();
    let stalled = false;
    let stalledWhy: string | null = null;
    let refused = false;
    const onEvent = (e: PayQueueEvent) => {
      switch (e.kind) {
        case "planned":
          for (const p of due) if (!spoken.has(p.workerId)) setStage(p.workerId, { kind: "waiting" });
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
          break;
        case "broadcast":
          break;
        case "settled":
          spoken.add(e.workerId);
          setStage(e.workerId, {
            kind: "settled",
            transactionId: e.transactionId,
            ...(e.feeMicrocredits !== undefined ? { feeMicrocredits: e.feeMicrocredits } : {}),
            ...(e.found ? { found: true as const } : {}),
          });
          break;
        case "failed":
          setStage(e.workerId, { kind: "failed", failure: e.failure });
          break;
        case "unconfirmed":
          setStage(e.workerId, { kind: "unconfirmed", failure: e.failure });
          break;
      }
    };
    try {
      // The release itself (release.ts): the run as the books hold it now, every outcome written as it happens, then
      // each paystub settled this time. This panel only shows it.
      // The account's notes about its pay runs are sealed by the open books, and read and sent through Shield.
      const seal = noteSealer();
      if (!seal) throw new Error("The books are locked");
      ({ stalled } = await releaseRun({
        ...within,
        markers: markerDesk({ wallet, address: current, username: username ?? "", seal }),
        deliver,
        // First, how many times Shield will ask.
        onPrompts: (prompts) => setNote(promptSummary(prompts)),
        onEvent,
        // No longer "Approve in Shield" while the account's own transfers are looked through for it.
        onLooking: (workerId) => setStage(workerId, { kind: "looking" }),
        // A payment another device is paying, or one this device won't pay as its books hold it: its line says why.
        onHeld: (workerId, why) => {
          spoken.add(workerId);
          setStage(workerId, { kind: "held", why });
        },
        onError: (e) => setError(errorMessage(e)),
        onPaid: async () => {
          setStopped(stalledWhy);
          // A line the run never reached reads from the books again before the paystubs go.
          setStages((all) => stagesAfterPress(all));
          loadedFor.current = null; // re-read the balance
          setRecords(await fetchTokenRecords(within.wallet).then(tagRecords).catch(() => records ?? []));
        },
      }));
    } catch (e) {
      refused = true;
      setError(errorMessage(e));
    }
    // A line the run never reached reads from the books again: what an earlier run left it, with its button.
    setStages((all) => stagesAfterPress(all));
    // Everything it said Shield would ask has been asked; where a run stopped stays up, and so does where an earlier
    // press stopped when this one was refused.
    if (refused) setNote(noteBefore);
    else if (!stalled) setNote(null);
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
                        : s.kind === "failed"
                          ? "text-money-negative"
                          : s.kind === "unconfirmed" || s.kind === "held"
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
            {!attempted && "First, one note to your own account so no other device pays this run again (one approval). "}
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
