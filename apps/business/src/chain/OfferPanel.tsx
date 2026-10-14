"use client";

// ---------------------------------------------------------------------------
// Send an employment offer to a typed team member, from their row in Team.
// Loaded through a dynamic import, so nobody without the rail downloads it.
//
//   1. Find them on the rail by registered name or account (public registry).
//   2. Dates, industry and the terms; pay type, rate and frequency come from
//      the team member's record, so the offer says what the books say.
//   3. Send: the terms go to their mailbox first, sealed to the two of you,
//      then one transaction in Shield; the link is saved as "Offer sent".
//
// No address, key or document is ever logged from here.
// ---------------------------------------------------------------------------

import { useMemo, useState } from "react";
import { formatCents } from "@pnw/ledger";
import { MailboxClient } from "@pnw/mailbox";
import { PAY_FREQUENCIES } from "@pnw/payroll";
import { INDUSTRY_SUFFIXES } from "@pnw/records/registry/name_registry";
import { Button } from "@pnw/ui/button";
import { AleoWalletProviderWrapper } from "@pnw/wallet/wallet-provider";
import { Field, FormError, errorMessage, inputClass } from "@/books/AuthCard";
import { useOpenBooks } from "@/books/BooksProvider";
import { todayIso } from "@/books/display";
import { type Rail, addLink, shortAddress } from "@/books/rail";
import { BRAND } from "@/brand";
import type { Company } from "@/books/company";
import { ShieldStatus } from "./ShieldStatus";
import { type OfferStage, type ResolvedWorker, fetchLatestHeight, isMailboxOff, resolveWorker, sendOffer } from "./offer";
import { useShield } from "./shield";

export type OfferPanelProps = { workerId: string; onClose: () => void };

export default function OfferPanel(props: OfferPanelProps) {
  return (
    <AleoWalletProviderWrapper>
      <div className="flex flex-col gap-4 rounded-md border bg-muted/40 p-4">
        <OfferFlow {...props} />
      </div>
    </AleoWalletProviderWrapper>
  );
}

const STAGE_COPY: Record<OfferStage, string> = {
  sealing: "Sealing the terms…",
  mailbox: "Putting the terms in their mailbox…",
  approving: "Approve the offer in Shield…",
  sent: "Sent. Waiting for the network…",
  accepted: "Accepted. Saving…",
};

/** `days` from today, as YYYY-MM-DD. */
function daysFromToday(days: number): string {
  const [y, m, d] = todayIso().split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

function railOf(c: Company): Rail {
  if (!c.rail) throw new Error("Link Shield in Settings first");
  return c.rail;
}

function OfferFlow({ workerId, onClose }: OfferPanelProps) {
  const { books, payroll, rail, updateCompany } = useOpenBooks();
  const { state, connect, error: shieldError, wallet } = useShield();
  const client = useMemo(() => new MailboxClient(), []);
  const worker = payroll.workers.find((w) => w.id === workerId);
  const [who, setWho] = useState("");
  const [found, setFound] = useState<ResolvedWorker | null>(null);
  const [finding, setFinding] = useState(false);
  const [startDate, setStartDate] = useState(todayIso());
  const [reviewDate, setReviewDate] = useState(daysFromToday(90));
  const [endDate, setEndDate] = useState("");
  const [industryCode, setIndustryCode] = useState(1);
  const [termsText, setTermsText] = useState("");
  const [stage, setStage] = useState<OfferStage | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [mailboxOff, setMailboxOff] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const address = state.kind === "connected" ? state.address : null;
  const mismatch = address !== null && rail !== null && address !== rail.address;

  if (!rail) return <FormError message="Link Shield in Settings first" />;
  if (!rail.businessNameHash) return <FormError message="Register a business name on the rail first" />;
  if (!worker) return <FormError message="Team member not found" />;

  const pay =
    worker.payType === "hourly"
      ? `${formatCents(worker.rate)}/hr`
      : `${formatCents(worker.rate)}/yr salary`;
  const freq = PAY_FREQUENCIES.find((f) => f.id === worker.frequency)?.label.toLowerCase();
  const nameOf = (r: ResolvedWorker) => (r.name ? `${r.name}.${BRAND.nameSuffix}` : shortAddress(r.address));

  async function find() {
    setError(null);
    setFound(null);
    setFinding(true);
    try {
      setFound(await resolveWorker(who, BRAND.nameSuffix));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setFinding(false);
    }
  }

  async function send(current: string) {
    if (!found || !worker || !rail?.businessNameHash) return;
    setError(null);
    setStage("sealing");
    try {
      const currentHeight = await fetchLatestHeight();
      const sent = await sendOffer({
        employerAddress: current,
        employerNameHash: rail.businessNameHash,
        businessName: rail.businessName ?? books.settings.businessName,
        worker,
        workerAddress: found.address,
        workerNameHash: found.nameHash,
        industryCode,
        termsText,
        startDate,
        reviewDate,
        endDate,
        currentHeight,
        client,
        wallet: {
          executeTransaction: async (opts) => {
            const r = await wallet.executeTransaction(opts);
            if (!r?.transactionId) throw new Error("Shield didn't take the offer");
            return r;
          },
          transactionStatus: (id) => wallet.transactionStatus(id),
        },
        onProgress: setStage,
      });
      await updateCompany((c) => ({ ...c, rail: addLink(railOf(c), sent.link) }));
      setSentTo(nameOf(found));
    } catch (e) {
      if (isMailboxOff(e)) setMailboxOff(true);
      setError(errorMessage(e));
    } finally {
      setStage(null);
    }
  }

  if (sentTo) {
    return (
      <>
        <p className="text-sm">
          Offer sent to <span className="font-medium">{sentTo}</span>. They&apos;ll see it in their app; once they accept, Settings → Import team
          links them.
        </p>
        <Button variant="outline" className="min-h-11 self-start sm:min-h-9" onClick={onClose}>
          Done
        </Button>
      </>
    );
  }

  const canSend = !!found && !!termsText.trim() && !stage && !mailboxOff;

  return (
    <>
      <div>
        <h3 className="text-sm font-semibold">Send an offer to {worker.name}</h3>
        <p className="text-xs text-muted-foreground">
          {pay} · paid {freq}, from their team record. The terms go to their mailbox, sealed; only a fingerprint of them goes on the rail.
        </p>
        {worker.frequency === "semimonthly" && (
          <p className="text-xs text-muted-foreground">The agreement records twice a month as every two weeks; the terms say twice a month.</p>
        )}
      </div>

      {!address ? (
        <ShieldStatus state={state} connect={connect} onClose={onClose} />
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
        <form
          className="grid gap-4 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (canSend) void send(address);
          }}
        >
          <Field label="Their name or account" hint={`Their registered name, like ana.${BRAND.nameSuffix}, or their account starting aleo1.`}>
            <div className="flex gap-2">
              <input
                className={inputClass}
                value={who}
                onChange={(e) => {
                  setWho(e.target.value);
                  setFound(null);
                }}
                autoComplete="off"
                spellCheck={false}
                required
              />
              <Button type="button" variant="outline" className="min-h-11 whitespace-nowrap sm:min-h-10" disabled={finding || !who.trim()} onClick={() => void find()}>
                {finding ? "Finding…" : "Find"}
              </Button>
            </div>
          </Field>
          <div className="flex items-end text-sm">
            {found ? (
              <span>
                <span className="font-medium">{nameOf(found)}</span>
                <span className="block font-mono text-xs text-muted-foreground">{shortAddress(found.address)}</span>
              </span>
            ) : (
              <span className="text-xs text-muted-foreground">Find them first; the offer goes to the account their name points at.</span>
            )}
          </div>
          <Field label="Starts">
            <input type="date" className={inputClass} value={startDate} onChange={(e) => setStartDate(e.target.value)} required />
          </Field>
          <Field label="Review on" hint="90 days in by default.">
            <input type="date" className={inputClass} value={reviewDate} onChange={(e) => setReviewDate(e.target.value)} required />
          </Field>
          <Field label="Ends" hint="Optional. Leave blank for open-ended.">
            <input type="date" className={inputClass} value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          </Field>
          <Field label="Industry">
            <select className={inputClass} value={industryCode} onChange={(e) => setIndustryCode(Number(e.target.value))}>
              {Object.entries(INDUSTRY_SUFFIXES).map(([code, { label }]) => (
                <option key={code} value={code}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Terms" hint="What you're offering, in your words: hours, duties, notice. They read exactly this.">
            <textarea className={`${inputClass} min-h-28`} value={termsText} onChange={(e) => setTermsText(e.target.value)} required />
          </Field>
          <div className="flex flex-col gap-3 sm:col-span-2">
            {stage && <p className="text-xs text-muted-foreground">{STAGE_COPY[stage]}</p>}
            {!stage && (
              <p className="text-xs text-muted-foreground">
                Shield asks you to approve one transaction; the employer pays its network fee. Nothing is paid to anyone.
              </p>
            )}
            <FormError message={error ?? shieldError} />
            <div className="flex gap-3">
              <Button type="button" variant="outline" className="h-11 flex-1 sm:flex-none" onClick={onClose} disabled={!!stage}>
                {stage ? "Keep open" : "Cancel"}
              </Button>
              <Button type="submit" className="h-11 flex-1 sm:flex-none" disabled={!canSend}>
                {stage ? "Sending…" : "Send offer"}
              </Button>
            </div>
          </div>
        </form>
      )}
    </>
  );
}
