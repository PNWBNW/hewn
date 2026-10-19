"use client";

// ---------------------------------------------------------------------------
// The pay panel: settles one rail run through Shield, one private USDCx
// transfer per person, all fired at once (@pnw/rail). Opened from the pay
// runs list right after a rail run posts, and again from Continue / Retry.
//
// Every outcome is written to the vault as it happens, so closing the tab
// loses nothing: a transfer Shield has taken keeps its id on the pending
// paycheck and is watched, not re-sent, when the run is reopened; a failed
// one is retried; a settled one is never touched again.
//
// The moment a paycheck settles its paystub goes to the person through the
// mailbox (deliver.ts). That is a courtesy on top of the payment: a send that
// fails leaves the settlement exactly as it is and offers a Send button.
//
// No address, record or signature is ever logged from here.
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useRef, useState } from "react";
import { type Paycheck, type Payroll, type Settlement, markPaycheckSettlement } from "@pnw/payroll";
import {
  type PayQueueEvent,
  type RailWallet,
  type TokenRecord,
  centsToMinor,
  explorerNetwork,
  fetchTokenRecords,
  formatMinorAsDollars,
  outstanding,
  runPayQueue,
  totalBalance,
} from "@pnw/rail";
import { Button } from "@pnw/ui/button";
import { cn } from "@pnw/ui/utils";
import { AleoWalletProviderWrapper } from "@pnw/wallet/wallet-provider";
import { FormError, errorMessage } from "@/books/AuthCard";
import { useOpenBooks } from "@/books/BooksProvider";
import { Money } from "@/books/display";
import { shortAddress } from "@/books/rail";
import { ShieldStatus } from "./ShieldStatus";
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
  if (target.status === "pending" && current.status === "pending" && !target.reference) return next;
  return markPaycheckSettlement(next, runId, workerId, target);
}

// ---- Per-person progress ------------------------------------------------------------

type Stage =
  | { kind: "waiting" }
  | { kind: "approving" }
  | { kind: "sent" }
  | { kind: "settled"; transactionId: string; feeMicrocredits?: bigint }
  | { kind: "failed"; failure: string };

/** What a paycheck looks like before the queue says anything about it this session. */
function stageOf(p: Paycheck): Stage {
  const s = p.settlement;
  if (s.status === "settled") return { kind: "settled", transactionId: s.reference ?? "", ...(s.feeMicrocredits !== undefined ? { feeMicrocredits: s.feeMicrocredits } : {}) };
  if (s.status === "failed") return { kind: "failed", failure: s.failure ?? "Payment failed" };
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
    case "settled":
      return stage.transactionId ? `Settled · ${shortAddress(stage.transactionId)}` : "Settled";
    case "failed":
      return `Failed · ${stage.failure}`;
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
  const [records, setRecords] = useState<TokenRecord[] | null>(null);
  const [stages, setStages] = useState<Record<string, Stage>>({});
  const [deliveries, setDeliveries] = useState<Record<string, Delivery>>({});
  const [note, setNote] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadedFor = useRef<string | null>(null);

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
    fetchTokenRecords(toRailWallet(wallet, address)).then(setRecords, (e: unknown) => setError(errorMessage(e)));
  }, [address, mismatch, wallet]);

  if (!rail) return <FormError message="Link Shield in Settings first" />;
  if (!run) return <FormError message="Pay run not found" />;
  if (run.mode !== "rail") return <FormError message="This run was paid outside the app" />;

  const due = outstanding(run);
  const everyone = run.paychecks.filter((p) => p.net > 0n); // settled ones stay on the board
  const totalDue = due.reduce((s, p) => s + p.net, 0n);
  const balance = records ? totalBalance(records) : null;
  const short = balance !== null && balance < centsToMinor(totalDue);
  const attempted = due.some((p) => p.settlement.status === "failed" || p.settlement.reference);
  const stage = (p: Paycheck): Stage => stages[p.workerId] ?? stageOf(p);
  const links = new Map(rail.links.map((l) => [l.workerId, l.address]));
  const unlinked = due.filter((p) => !links.has(p.workerId));

  async function start(current: string) {
    if (!run) return;
    setRunning(true);
    setError(null);
    setNote(null);
    const railWallet = toRailWallet(wallet, current);
    const setStage = (workerId: string, s: Stage) => setStages((all) => ({ ...all, [workerId]: s }));
    const write = (workerId: string, target: Settlement) => updateCompany((c) => ({ ...c, payroll: settleTo(c.payroll, runId, workerId, target) }));
    const settled: Promise<string | null>[] = [];
    const onProgress = (e: PayQueueEvent) => {
      switch (e.kind) {
        case "planned":
          setNote(e.splits > 0 ? `Preparing ${e.splits === 1 ? "a record" : `${e.splits} records`} first, then paying ${e.transfers}.` : null);
          for (const p of due) setStage(p.workerId, { kind: "waiting" });
          break;
        case "splitting":
          setNote(`Preparing records… ${e.step} of ${e.of}. Approve each in Shield.`);
          break;
        case "split_done":
          if (e.step === e.of) setNote("Records ready. Approve each payment in Shield.");
          break;
        case "approving":
          setStage(e.workerId, { kind: "approving" });
          break;
        case "sent":
          setStage(e.workerId, { kind: "sent" });
          void write(e.workerId, { status: "pending", reference: e.reference }).catch((err: unknown) => setError(errorMessage(err)));
          break;
        case "broadcast":
          break;
        case "settled":
          setStage(e.workerId, { kind: "settled", transactionId: e.transactionId, ...(e.feeMicrocredits !== undefined ? { feeMicrocredits: e.feeMicrocredits } : {}) });
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
          void write(e.workerId, { status: "failed", failure: e.failure }).catch((err: unknown) => setError(errorMessage(err)));
          break;
      }
    };
    try {
      // The run as it is now, so a reopened panel resumes exactly what's outstanding.
      const latest = (await updateCompany((c) => c)).payroll.runs.find((r) => r.id === runId)!;
      await runPayQueue({ wallet: railWallet, network: explorerNetwork(), run: latest, links, onProgress });
      loadedFor.current = null; // re-read the balance
      setRecords(await fetchTokenRecords(railWallet).catch(() => records ?? []));
    } catch (e) {
      setError(errorMessage(e));
    }
    // Then each paystub settled this time, one letter (one approval) at a time; `deliver` never throws.
    for (const workerId of await Promise.all(settled)) if (workerId) await deliver(workerId);
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
              {unlinked.map((p) => names.get(p.workerId) ?? p.workerId).join(", ")} {unlinked.length === 1 ? "has" : "have"} no account on the rail yet: Settings →
              Import team.
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
                      s.kind === "settled" ? "text-money-positive" : s.kind === "failed" ? "text-money-negative" : "text-muted-foreground",
                    )}
                  >
                    {stageLabel(s)}
                    {s.kind === "failed" && !running && (
                      <Button type="button" variant="link" size="sm" className="ml-1 h-auto p-0 text-xs" onClick={() => void start(address)}>
                        Retry
                      </Button>
                    )}
                  </span>
                  {paystubNote(p)}
                </li>
              );
            })}
          </ul>
          {note && <p className="text-xs text-muted-foreground">{note}</p>}
          <p className="text-xs text-muted-foreground">
            Shield asks you to approve each payment; they all go out together and settle on their own. The employer pays the network fee on each
            one; nothing is taken from anyone&apos;s pay.
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
