"use client";

// ---------------------------------------------------------------------------
// Paying a business without a bill (docs/CUSTOMERS.md, decision 24): one the
// customer is connected with, or any business found by its registered name,
// so the money goes to the account the registry says the name is, not to an
// address typed by hand. The customer chooses the amount and says what it's
// for; the transfer is a private USDCx payment through the pay queue
// (pay_shield.ts), never sent twice. A connected business is then told, in
// the conversation the two share (one more approval), and records it in its
// books; any other sees it arrive in its Shield account. Every payment stays
// here as the customer's receipt. Nothing here logs an account, an amount or
// a record.
// ---------------------------------------------------------------------------

import { useRef, useState } from "react";
import { formatCents, parseCents } from "@pnw/ledger";
import type { Settlement } from "@pnw/payroll";
import { Button } from "@pnw/ui/button";
import { readFeeMode } from "@pnw/wallet/fee-mode";
import { AleoWalletProviderWrapper } from "@pnw/wallet/wallet-provider";
import { Field, FormError, errorMessage, inputClass } from "@/books/AuthCard";
import { useCustomer } from "@/books/BooksProvider";
import { connectedIn, connectionState, updateConnectionThread } from "@/books/connections";
import { type DirectPayment, MAX_DIRECT_NOTE, directNeverWent, directPaymentsIn, dropDirectPayment, markDirectTold, setDirectPayment, startDirectPayment } from "@/books/customer";
import { shortAddress } from "@/books/rail";
import { addToThread, emptyThread } from "@/books/thread";
import { BRAND } from "@/brand";
import { CLIENT_KINDS, connectionKey } from "../clients";
import { ShieldNeeded } from "../clients/ShieldNeeded";
import type { DirectoryEntry } from "../directory";
import { useLetters } from "../letter_reader";
import { letterThread } from "../letters";
import NameLookup from "../NameLookup";
import { postToThread } from "../thread";
import { useShield } from "../shield";
import { payOne, railWalletOf } from "./pay_shield";

export default function PayBusiness({ preset }: { preset?: string }) {
  return (
    <AleoWalletProviderWrapper>
      <Pay preset={preset} />
    </AleoWalletProviderWrapper>
  );
}

const BY_NAME = "name";
const dollars = (cents: string) => `$${formatCents(BigInt(cents))}`;
const newId = () => Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, "0")).join("");
const queueKey = (id: string) => `direct:${id}`;

type Payee = { address: string; name: string };

function Pay({ preset }: { preset?: string }) {
  const { rail, customer, updateCustomer, currentCompany } = useCustomer();
  const letters = useLetters();
  const shield = useShield();
  const connected = connectedIn(customer.businesses);
  const [open, setOpen] = useState(!!preset);
  const [choice, setChoice] = useState<string>(() => (preset && connected.some((c) => c.address === preset) ? preset : (connected[0]?.address ?? BY_NAME)));
  const [found, setFound] = useState<DirectoryEntry | null>(null);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [confirming, setConfirming] = useState<{ payee: Payee; cents: bigint } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const running = useRef(false);
  if (!rail) return null;
  const sent = directPaymentsIn(customer);
  const isConnected = (address: string) => connectionState(currentCompany()?.customer?.businesses?.[address]) === "connected";

  const payee = (): Payee | null => {
    if (choice !== BY_NAME) {
      const c = connected.find((x) => x.address === choice);
      return c ? { address: c.address, name: c.name } : null;
    }
    return found?.name ? { address: found.address, name: found.name } : null;
  };

  function review() {
    setError(null);
    try {
      const to = payee();
      if (!to) throw new Error(choice === BY_NAME ? "Find the business by its registered name first" : "Choose a business");
      const cents = parseCents(amount);
      if (cents <= 0n) throw new Error("Enter an amount to pay");
      if ([...note].length > MAX_DIRECT_NOTE) throw new Error(`What it's for is at most ${MAX_DIRECT_NOTE} characters`);
      setConfirming({ payee: to, cents });
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  /** Sends the payment `id`, or checks on it if it's on its way; once it settles, tells a connected business. */
  async function run(id: string) {
    if (running.current || !letters.address) return;
    running.current = true;
    setBusy(id);
    setError(null);
    try {
      // From what the vault holds, so a payment already on its way is watched, not sent again.
      const latest = (await updateCustomer((c) => (c.direct?.[id]?.settlement.status === "failed" ? setDirectPayment(c, id, { status: "pending" }) : c))).direct?.[id];
      if (!latest) throw new Error("That payment isn't here any more");
      const write = (s: Settlement) => updateCustomer((c) => setDirectPayment(c, id, s));
      const r = await payOne({ wallet: railWalletOf(shield.wallet, letters.address), key: queueKey(id), to: latest.address, cents: BigInt(latest.cents), settlement: latest.settlement, write });
      if (r.transactionId && isConnected(latest.address)) await tell(latest, r.transactionId);
      else if (r.failure) setError(r.failure);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      running.current = false;
      setBusy(null);
    }
  }

  async function pay() {
    if (!confirming) return;
    const id = newId();
    setError(null);
    try {
      const trimmed = note.trim();
      await updateCustomer((c) =>
        startDirectPayment(c, { id, address: confirming.payee.address, name: confirming.payee.name, cents: confirming.cents.toString(), createdAt: new Date().toISOString(), ...(trimmed ? { note: trimmed } : {}) }),
      );
    } catch (e) {
      setError(errorMessage(e));
      return;
    }
    setConfirming(null);
    setOpen(false);
    setFound(null);
    setAmount("");
    setNote("");
    await run(id);
  }

  /** Tells a connected business it was paid, how much and what for: one message, one approval. */
  async function tell(p: DirectPayment, transactionId: string) {
    setBusy(`tell:${p.id}`);
    setError(null);
    try {
      if (!letters.letters) throw new Error("Connect Shield first");
      const conn = currentCompany()?.customer?.businesses?.[p.address];
      if (!conn || connectionState(conn) !== "connected") throw new Error("You're not connected with that business any more");
      const { writer } = letterThread(letters.wallet, p.address, { letters: letters.letters });
      const item = await postToThread({
        client: writer,
        partiesKey: await connectionKey(conn),
        from: "worker",
        nextOut: conn.thread?.nextOut ?? 0,
        body: { type: "payment", amount: p.cents, transactionId, ...(p.note ? { note: p.note } : {}) },
        kinds: CLIENT_KINDS,
        feeMode: readFeeMode(),
      });
      const at = new Date().toISOString();
      await updateCustomer((c) => markDirectTold({ ...c, businesses: updateConnectionThread(c.businesses ?? {}, p.address, (t) => addToThread(t, item), emptyThread) }, p.id, at));
    } catch (e) {
      setError(`Paid, but ${p.name} wasn't told yet: ${errorMessage(e)}`);
    } finally {
      setBusy(null);
    }
  }

  async function update(change: Parameters<typeof updateCustomer>[0]) {
    setError(null);
    try {
      await updateCustomer(change);
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  let form;
  if (!letters.letters) {
    form = <ShieldNeeded {...letters} linked={rail.address} what="pay a business" />;
  } else if (confirming) {
    const { payee: to, cents } = confirming;
    const told = isConnected(to.address);
    form = (
      <div className="flex flex-col gap-3 rounded-md border border-dashed p-3">
        <p className="text-sm">
          Pay <span className="font-medium">{dollars(cents.toString())}</span> in USDCx from Shield to{" "}
          <span className="font-medium">
            {to.name}.{BRAND.nameSuffix}
          </span>
          ?
        </p>
        <p className="font-mono text-xs text-muted-foreground" title="The registry's account for this name">
          The registry says {to.name}.{BRAND.nameSuffix} is {shortAddress(to.address)}.
        </p>
        {note.trim() && <p className="text-sm text-muted-foreground">For: {note.trim()}</p>}
        <p className="text-xs text-muted-foreground">
          A private transfer: nobody but the two of you sees the amount or who paid whom. It can&apos;t be taken back, so make sure this is the name the
          business gave you. You need {dollars(cents.toString())} in USDCx in Shield, plus the network fee{readFeeMode() === "private" ? " (paid privately)" : ""}.{" "}
          {told
            ? "Then one more approval tells them it's from you and what it's for."
            : "You're not connected with them, so what it's for stays with you; they see the payment arrive in their Shield account."}
        </p>
        <div className="flex flex-wrap gap-3">
          <Button className="min-h-11 sm:min-h-9" disabled={busy !== null} onClick={() => void pay()}>
            Pay {dollars(cents.toString())}
          </Button>
          <Button variant="outline" className="min-h-11 sm:min-h-9" disabled={busy !== null} onClick={() => setConfirming(null)}>
            Back
          </Button>
        </div>
      </div>
    );
  } else if (!open) {
    form = (
      <Button variant="outline" className="min-h-11 self-start sm:min-h-9" disabled={busy !== null} onClick={() => setOpen(true)}>
        Pay a business
      </Button>
    );
  } else {
    form = (
      <div className="flex flex-col gap-3">
        {connected.length > 0 && (
          <Field label="To">
            <select
              className={inputClass}
              value={choice}
              onChange={(e) => {
                setChoice(e.target.value);
                setFound(null);
              }}
            >
              {connected.map((c) => (
                <option key={c.address} value={c.address}>
                  {c.name}.{BRAND.nameSuffix}
                </option>
              ))}
              <option value={BY_NAME}>Another business, by its name…</option>
            </select>
          </Field>
        )}
        {choice === BY_NAME && (
          <>
            <NameLookup allow={["business"]} label="Their registered name" hint={`Like cedar_co.${BRAND.nameSuffix}. Ask the business for it.`} onChange={setFound} disabled={busy !== null} />
            {found && !found.name && <p className="text-sm text-muted-foreground">That business&apos;s name can&apos;t be read from the registry right now. Try again later.</p>}
          </>
        )}
        <Field label="Amount">
          <input className={inputClass} inputMode="decimal" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} autoComplete="off" />
        </Field>
        <Field label="What it's for" hint="Optional. A connected business sees it with the payment.">
          <input className={inputClass} value={note} maxLength={MAX_DIRECT_NOTE} onChange={(e) => setNote(e.target.value)} autoComplete="off" />
        </Field>
        <div className="flex flex-wrap gap-3">
          <Button className="min-h-11 sm:min-h-9" disabled={busy !== null} onClick={review}>
            Review payment
          </Button>
          <Button
            variant="ghost"
            className="min-h-11 sm:min-h-9"
            onClick={() => {
              setOpen(false);
              setFound(null);
            }}
          >
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  return (
    <section className="flex flex-col gap-3 rounded-lg border bg-card p-4">
      <h2 className="text-sm font-semibold">Pay without a bill</h2>
      <p className="text-xs text-muted-foreground">Pay a business by its registered name, so the money goes to the account that name belongs to.</p>
      {form}
      {sent.length > 0 && (
        <ul className="divide-y rounded-md border">
          {sent.map((p) => (
            <Sent
              key={p.id}
              p={p}
              busy={busy}
              ready={!!letters.letters}
              connected={isConnected(p.address)}
              onRun={() => void run(p.id)}
              onTell={() => p.settlement.reference && void tell(p, p.settlement.reference)}
              onGaveUp={() => void update((c) => setDirectPayment(c, p.id, { status: "failed", failure: "Marked to pay again after checking Shield" }))}
              onDrop={() => void update((c) => dropDirectPayment(c, p.id))}
            />
          ))}
        </ul>
      )}
      <FormError message={error} />
    </section>
  );
}

function Sent({
  p,
  busy,
  ready,
  connected,
  onRun,
  onTell,
  onGaveUp,
  onDrop,
}: {
  p: DirectPayment;
  busy: string | null;
  ready: boolean;
  connected: boolean;
  onRun: () => void;
  onTell: () => void;
  onGaveUp: () => void;
  onDrop: () => void;
}) {
  const s = p.settlement;
  const disabled = !ready || busy !== null;
  const small = "min-h-11 sm:min-h-8";
  let line: string;
  let actions = null;
  if (s.status === "settled") {
    line = `Paid${s.settledAt ? ` on ${new Date(s.settledAt).toLocaleDateString()}` : ""}${p.toldAt ? `; ${p.name} was told` : ""}`;
    if (!p.toldAt && connected)
      actions = (
        <Button variant="outline" size="sm" className={small} disabled={disabled || !s.reference} onClick={onTell}>
          {busy === `tell:${p.id}` ? "Sending…" : `Tell ${p.name}`}
        </Button>
      );
  } else if (s.status === "failed") {
    line = `Didn't go through: ${s.failure ?? "Shield turned it down"}`;
    actions = (
      <>
        <Button size="sm" className={small} disabled={disabled} onClick={onRun}>
          {busy === p.id ? "Paying…" : "Try again"}
        </Button>
        <Button variant="ghost" size="sm" className={small} disabled={busy !== null} onClick={onDrop}>
          Remove
        </Button>
      </>
    );
  } else if (directNeverWent(p)) {
    line = "Not sent yet";
    actions = (
      <>
        <Button size="sm" className={small} disabled={disabled} onClick={onRun}>
          {busy === p.id ? "Paying… approve it in Shield" : "Send it"}
        </Button>
        <Button variant="ghost" size="sm" className={small} disabled={busy !== null} onClick={onDrop}>
          Remove
        </Button>
      </>
    );
  } else {
    line = s.failure ?? "On its way";
    actions = (
      <>
        <Button size="sm" className={small} disabled={disabled} onClick={onRun}>
          {busy === p.id ? "Checking…" : "Check on it"}
        </Button>
        {s.failure && (
          <Button variant="ghost" size="sm" className={small} disabled={busy !== null} onClick={onGaveUp}>
            I checked Shield: it didn&apos;t go
          </Button>
        )}
      </>
    );
  }
  return (
    <li className="flex flex-col gap-2 px-3 py-2 sm:flex-row sm:items-center">
      <span className="min-w-0 flex-1 text-sm">
        <span className="block">
          {p.name}.{BRAND.nameSuffix} · {dollars(p.cents)}
          {p.note ? <span className="text-muted-foreground"> · {p.note}</span> : null}
        </span>
        <span className={s.status === "settled" ? "block text-xs text-money-positive" : "block text-xs text-muted-foreground"}>{line}</span>
        {s.reference && <span className="block break-all font-mono text-xs text-muted-foreground">{s.reference}</span>}
      </span>
      {actions && <span className="flex flex-wrap gap-2">{actions}</span>}
    </li>
  );
}
