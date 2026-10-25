"use client";

// ---------------------------------------------------------------------------
// The agreements between a business and a connected customer (books/service.ts),
// above their conversation: the business proposes or revises the terms of a
// job; the customer accepts, asks for changes or declines; either side marks
// an agreed job complete or cancels it. And either side can disconnect. Each
// is one message in the conversation, one Shield approval, kept in both
// vaults; nothing is written on chain yet. Nothing here logs a term or a key.
// ---------------------------------------------------------------------------

import { useState } from "react";
import { formatCents, parseCents } from "@pnw/ledger";
import { Button } from "@pnw/ui/button";
import { readFeeMode } from "@pnw/wallet/fee-mode";
import { Field, FormError, errorMessage, inputClass } from "@/books/AuthCard";
import { type Connection, itemsOf } from "@/books/connections";
import { todayIso } from "@/books/display";
import {
  MAX_SCOPE,
  MAX_TITLE,
  PRICE_KINDS,
  PRICE_LABEL,
  type PriceKind,
  SERVICE_STATUS_LABEL,
  type ServiceTerms,
  type ServiceView,
  agreementsIn,
  newServiceId,
  validateTerms,
} from "@/books/service";
import { type Side, type Thread, type ThreadBody, addToThread } from "@/books/thread";
import { CLIENT_KINDS } from "../clients";
import { useLetters } from "../letter_reader";
import { letterThread } from "../letters";
import { postToThread } from "../thread";

const ENDINGS = ["The customer signs off on the work", "The final invoice is paid", "The end date"];

const priceLine = (t: Pick<ServiceTerms, "priceKind" | "amount">) =>
  `$${formatCents(BigInt(t.amount))}${t.priceKind === "hourly" ? " an hour" : t.priceKind === "estimate" ? " (estimate)" : ""}`;

export function Agreements({
  side,
  connection,
  partiesKey,
  title,
  update,
}: {
  side: Side;
  connection: Connection;
  partiesKey: string;
  title: string;
  update: (change: (t: Thread) => Thread) => Promise<void>;
}) {
  const { letters, wallet } = useLetters();
  const [drafting, setDrafting] = useState<ServiceTerms | "new" | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const business = side === "business";
  const agreements = agreementsIn(itemsOf(connection));

  async function send(body: ThreadBody, what: string) {
    setBusy(what);
    setError(null);
    try {
      if (!letters) throw new Error("Connect Shield first");
      const { writer } = letterThread(wallet, connection.address, { letters });
      const item = await postToThread({ client: writer, partiesKey, from: side, nextOut: connection.thread?.nextOut ?? 0, body, kinds: CLIENT_KINDS, feeMode: readFeeMode() });
      await update((t) => addToThread(t, item));
      return true;
    } catch (e) {
      setError(errorMessage(e));
      return false;
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="flex flex-col gap-3 rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold">Agreements</h2>
        {business && drafting === null && (
          <Button variant="outline" size="sm" className="ml-auto min-h-11 sm:min-h-8" disabled={busy !== null || !letters} onClick={() => setDrafting("new")}>
            Propose an agreement
          </Button>
        )}
      </div>
      {agreements.length === 0 && drafting === null && (
        <p className="text-xs text-muted-foreground">
          {business
            ? `You're linked with ${title} without a contract. Propose an agreement for a job: what the work is, the price, the dates and how it ends. They accept it before it counts.`
            : `You're linked with ${title} without a contract. If they propose an agreement for a job, it shows here for you to accept, ask for changes or decline.`}
        </p>
      )}
      {drafting !== null && (
        <TermsForm
          start={drafting === "new" ? null : drafting}
          busy={busy !== null}
          onCancel={() => setDrafting(null)}
          onSend={async (terms) => {
            if (await send({ type: "agreement_offer", terms }, "offer")) setDrafting(null);
          }}
        />
      )}
      {agreements.map((a) => (
        <AgreementCard
          key={a.terms.id}
          view={a}
          business={business}
          busy={busy}
          disabled={!letters || busy !== null}
          onRevise={() => setDrafting({ ...a.terms, rev: a.terms.rev + 1 })}
          onAnswer={(answer, note) => send({ type: "agreement_answer", id: a.terms.id, rev: a.terms.rev, answer, ...(note ? { note } : {}) }, `${a.terms.id}:${answer}`)}
          onClose={(reason) => send({ type: "agreement_close", id: a.terms.id, reason }, `${a.terms.id}:${reason}`)}
        />
      ))}
      <FormError message={error} />
      <div className="border-t pt-3">
        {confirmEnd ? (
          <div className="flex flex-col gap-2">
            <p className="text-sm">
              Disconnect from {title}? {business ? "You can't send them invoices or messages" : "They can't send you invoices or messages"} until you both connect again. Bills,
              agreements and payments so far stay here.
            </p>
            <div className="flex flex-wrap gap-3">
              <Button variant="destructive" className="min-h-11 sm:min-h-9" disabled={busy !== null || !letters} onClick={() => void send({ type: "disconnect" }, "disconnect")}>
                {busy === "disconnect" ? "Disconnecting…" : "Disconnect"}
              </Button>
              <Button variant="outline" className="min-h-11 sm:min-h-9" onClick={() => setConfirmEnd(false)}>
                Keep the link
              </Button>
            </div>
          </div>
        ) : (
          <button type="button" className="min-h-11 text-xs text-muted-foreground underline underline-offset-4 sm:min-h-0" onClick={() => setConfirmEnd(true)}>
            Disconnect from {title}
          </button>
        )}
      </div>
    </section>
  );
}

function AgreementCard({
  view,
  business,
  busy,
  disabled,
  onRevise,
  onAnswer,
  onClose,
}: {
  view: ServiceView;
  business: boolean;
  busy: string | null;
  disabled: boolean;
  onRevise: () => void;
  onAnswer: (answer: "accept" | "changes" | "decline", note?: string) => Promise<boolean>;
  onClose: (reason: "complete" | "cancelled") => Promise<boolean>;
}) {
  const { terms, status } = view;
  const [asking, setAsking] = useState(false);
  const [note, setNote] = useState("");
  const id = terms.id;
  return (
    <div className="flex flex-col gap-2 rounded-md border p-3 text-sm">
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="font-medium">{terms.title}</span>
        <span className="rounded-full bg-muted px-2 text-xs">{SERVICE_STATUS_LABEL[status]}</span>
        {terms.rev > 1 && <span className="text-xs text-muted-foreground">revision {terms.rev}</span>}
      </div>
      <p className="whitespace-pre-wrap break-words text-muted-foreground">{terms.scope}</p>
      <p>
        {priceLine(terms)} · from {terms.startDate}
        {terms.endDate ? ` to ${terms.endDate}` : ""} · ends when: {terms.closesWhen.toLowerCase()}
      </p>
      {view.note && (
        <p className="rounded bg-muted px-2 py-1 text-xs">
          {view.note.mine ? "You" : business ? "They" : "The business"}: {view.note.text}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {business && (status === "offered" || status === "changes" || status === "declined") && (
          <Button variant="outline" size="sm" className="min-h-11 sm:min-h-8" disabled={disabled} onClick={onRevise}>
            Revise
          </Button>
        )}
        {!business && status === "offered" && !asking && (
          <>
            <Button size="sm" className="min-h-11 sm:min-h-8" disabled={disabled} onClick={() => void onAnswer("accept")}>
              {busy === `${id}:accept` ? "Accepting…" : "Accept"}
            </Button>
            <Button variant="outline" size="sm" className="min-h-11 sm:min-h-8" disabled={disabled} onClick={() => setAsking(true)}>
              Ask for changes
            </Button>
            <Button variant="ghost" size="sm" className="min-h-11 sm:min-h-8" disabled={disabled} onClick={() => void onAnswer("decline")}>
              {busy === `${id}:decline` ? "Declining…" : "Decline"}
            </Button>
          </>
        )}
        {status === "active" && (
          <>
            <Button variant="outline" size="sm" className="min-h-11 sm:min-h-8" disabled={disabled} onClick={() => void onClose("complete")}>
              {busy === `${id}:complete` ? "Saving…" : "Mark complete"}
            </Button>
            <Button variant="ghost" size="sm" className="min-h-11 sm:min-h-8" disabled={disabled} onClick={() => void onClose("cancelled")}>
              {busy === `${id}:cancelled` ? "Saving…" : "Cancel the job"}
            </Button>
          </>
        )}
      </div>
      {asking && (
        <div className="flex flex-col gap-2">
          <textarea className={`${inputClass} min-h-20`} value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} placeholder="What would you like changed?" />
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              className="min-h-11 sm:min-h-8"
              disabled={disabled || !note.trim()}
              onClick={async () => {
                if (await onAnswer("changes", note.trim())) setAsking(false);
              }}
            >
              {busy === `${id}:changes` ? "Sending…" : "Send"}
            </Button>
            <Button variant="ghost" size="sm" className="min-h-11 sm:min-h-8" onClick={() => setAsking(false)}>
              Back
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function TermsForm({ start, busy, onCancel, onSend }: { start: ServiceTerms | null; busy: boolean; onCancel: () => void; onSend: (t: ServiceTerms) => Promise<void> }) {
  const [title, setTitle] = useState(start?.title ?? "");
  const [scope, setScope] = useState(start?.scope ?? "");
  const [priceKind, setPriceKind] = useState<PriceKind>(start?.priceKind ?? "fixed");
  const [amount, setAmount] = useState(start ? formatCents(BigInt(start.amount)) : "");
  const [startDate, setStartDate] = useState(start?.startDate ?? todayIso());
  const [endDate, setEndDate] = useState(start?.endDate ?? "");
  const [closesWhen, setClosesWhen] = useState(start?.closesWhen ?? ENDINGS[0]!);
  const [error, setError] = useState<string | null>(null);

  function terms(): ServiceTerms {
    let cents: bigint;
    try {
      cents = parseCents(amount);
    } catch {
      throw new Error("Enter the amount in dollars, like 1,250.00");
    }
    return validateTerms({
      id: start?.id ?? newServiceId(),
      rev: start?.rev ?? 1,
      title: title.trim(),
      scope,
      priceKind,
      amount: cents.toString(),
      startDate,
      ...(endDate ? { endDate } : {}),
      closesWhen,
    });
  }

  return (
    <form
      className="flex flex-col gap-3 rounded-md border border-dashed p-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setError(null);
        try {
          await onSend(terms());
        } catch (err) {
          setError(errorMessage(err));
        }
      }}
    >
      <p className="text-sm font-medium">{start ? `Revise “${start.title}”` : "Propose an agreement"}</p>
      <Field label="Job">
        <input className={inputClass} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={MAX_TITLE} placeholder="Kitchen sink repair" required />
      </Field>
      <Field label="What the work is">
        <textarea className={`${inputClass} min-h-24`} value={scope} onChange={(e) => setScope(e.target.value)} maxLength={MAX_SCOPE} required />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Priced">
          <select className={inputClass} value={priceKind} onChange={(e) => setPriceKind(e.target.value as PriceKind)}>
            {PRICE_KINDS.map((k) => (
              <option key={k} value={k}>
                {PRICE_LABEL[k]}
              </option>
            ))}
          </select>
        </Field>
        <Field label={priceKind === "hourly" ? "Rate ($ an hour)" : "Amount ($)"}>
          <input className={inputClass} value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" required />
        </Field>
        <Field label="Starts">
          <input className={inputClass} type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} required />
        </Field>
        <Field label="Ends (optional)">
          <input className={inputClass} type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        </Field>
      </div>
      <Field label="The job ends when">
        <select className={inputClass} value={ENDINGS.includes(closesWhen) ? closesWhen : "other"} onChange={(e) => setClosesWhen(e.target.value === "other" ? "" : e.target.value)}>
          {ENDINGS.map((x) => (
            <option key={x} value={x}>
              {x}
            </option>
          ))}
          <option value="other">Something else…</option>
        </select>
      </Field>
      {!ENDINGS.includes(closesWhen) && (
        <input className={inputClass} value={closesWhen} onChange={(e) => setClosesWhen(e.target.value)} maxLength={300} placeholder="Say how the job ends" required />
      )}
      <FormError message={error} />
      <div className="flex flex-wrap gap-3">
        <Button type="submit" className="min-h-11 sm:min-h-9" disabled={busy}>
          {busy ? "Sending…" : start ? "Send the revision" : "Send the proposal"}
        </Button>
        <Button type="button" variant="outline" className="min-h-11 sm:min-h-9" onClick={onCancel}>
          Cancel
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">Sealed to the two of you. It counts once they accept it; both of you keep a copy.</p>
    </form>
  );
}
