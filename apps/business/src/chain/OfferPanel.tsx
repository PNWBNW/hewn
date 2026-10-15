"use client";

// ---------------------------------------------------------------------------
// Send an employment offer to a typed team member, from their row in Team.
// Loaded through a dynamic import, so nobody without the rail downloads it.
//
//   0. A short checklist of what the offer needs (Shield linked, the
//      business's registered name) that fills in as each piece is done.
//   1. Find them on the registry by name or account (NameLookup; public data).
//   2. Dates, industry and a few plain fields (role, duties, hours, notice)
//      that draft the terms; pay type, rate and frequency come from the team
//      member's record, so the offer says what the books say. The draft is
//      only text and can be edited freely.
//   3. Review: the agreement exactly as they will read it.
//   4. Send: the terms go to their mailbox first, sealed to the two of you,
//      then one transaction in Shield; the link is saved as "Offer sent".
//
// No address, key or document is ever logged from here.
// ---------------------------------------------------------------------------

import Link from "next/link";
import { type ReactNode, useMemo, useState } from "react";
import { MailboxClient } from "@pnw/mailbox";
import { INDUSTRY_SUFFIXES } from "@pnw/records/registry/name_registry";
import { Button } from "@pnw/ui/button";
import { AleoWalletProviderWrapper } from "@pnw/wallet/wallet-provider";
import { Field, FormError, errorMessage, inputClass } from "@/books/AuthCard";
import { useOpenBooks } from "@/books/BooksProvider";
import { todayIso } from "@/books/display";
import { type Rail, addLink, registeredFor, shortAddress } from "@/books/rail";
import { BRAND } from "@/brand";
import type { Company } from "@/books/company";
import { RegisterFlow } from "./RegisterBusiness";
import { ShieldStatus } from "./ShieldStatus";
import { draftProblem, draftTerms, longDate, payLine } from "./agreement_draft";
import NameLookup from "./NameLookup";
import { type DirectoryEntry, entryLabel } from "./directory";
import { type OfferStage, type ResolvedWorker, fetchLatestHeight, isMailboxOff, resolveBusinessName, sendOffer } from "./offer";
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

type Step = { done: boolean; text: ReactNode; action?: ReactNode };

/** What an offer needs, ticked off as each piece is in place. */
function Checklist({ steps }: { steps: Step[] }) {
  return (
    <ol className="flex flex-col gap-3">
      {steps.map((s, i) => (
        <li key={i} className="flex items-start gap-3 text-sm">
          <span
            aria-hidden
            className={`mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border text-xs ${s.done ? "border-transparent bg-primary text-primary-foreground" : "text-muted-foreground"}`}
          >
            {s.done ? "✓" : i + 1}
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <span className={s.done ? "text-muted-foreground" : "font-medium"}>{s.text}</span>
            {s.action}
          </div>
        </li>
      ))}
    </ol>
  );
}

function OfferFlow({ workerId, onClose }: OfferPanelProps) {
  const { books, payroll, rail, updateCompany } = useOpenBooks();
  const { state, connect, error: shieldError, wallet } = useShield();
  const client = useMemo(() => new MailboxClient(), []);
  const worker = payroll.workers.find((w) => w.id === workerId);
  // Who they are on the registry, from when they were added to the team; Change looks them up again.
  const [found, setFound] = useState<ResolvedWorker | null>(() => {
    const who = registeredFor(rail, "worker", workerId);
    return who ? { address: who.address, nameHash: who.nameHash, name: who.name } : null;
  });
  const [changingWho, setChangingWho] = useState(false);
  const [jobTitle, setJobTitle] = useState("");
  const [duties, setDuties] = useState("");
  const [hoursPerWeek, setHoursPerWeek] = useState("");
  const [noticeDays, setNoticeDays] = useState("14");
  const [startDate, setStartDate] = useState(todayIso());
  const [reviewDate, setReviewDate] = useState(daysFromToday(90));
  const [endDate, setEndDate] = useState("");
  const [industryCode, setIndustryCode] = useState(1);
  // The terms follow the fields until the person edits them by hand.
  const [termsText, setTermsText] = useState("");
  const [termsEdited, setTermsEdited] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [bizName, setBizName] = useState("");
  const [bizBusy, setBizBusy] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [stage, setStage] = useState<OfferStage | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [mailboxOff, setMailboxOff] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const address = state.kind === "connected" ? state.address : null;
  const mismatch = address !== null && rail !== null && address !== rail.address;
  const businessName = rail?.businessName ?? books.settings.businessName;

  const fieldProblem = draftProblem({ hoursPerWeek, noticeDays });
  const draft = useMemo(() => {
    if (!worker || fieldProblem) return "";
    return draftTerms({
      businessName,
      workerName: worker.name,
      payType: worker.payType,
      rate: worker.rate,
      frequency: worker.frequency,
      startDate,
      reviewDate,
      endDate,
      jobTitle,
      duties,
      hoursPerWeek,
      noticeDays,
    });
  }, [worker, fieldProblem, businessName, startDate, reviewDate, endDate, jobTitle, duties, hoursPerWeek, noticeDays]);
  const terms = termsEdited ? termsText : draft;

  if (!worker) return <FormError message="Team member not found" />;

  const nameOf = (r: ResolvedWorker) => entryLabel({ ...r, name: r.name ?? "", kind: "worker" }, BRAND.nameSuffix);

  async function confirmBusinessName() {
    if (!rail) return;
    setError(null);
    setBizBusy(true);
    try {
      const own = await resolveBusinessName(bizName, BRAND.nameSuffix, rail.address);
      await updateCompany((c) => ({ ...c, rail: { ...railOf(c), businessNameHash: own.nameHash, businessName: own.name } }));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBizBusy(false);
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
        businessName,
        worker,
        workerAddress: found.address,
        workerNameHash: found.nameHash,
        industryCode,
        termsText: terms,
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

  const cancel = (
    <Button variant="outline" className="min-h-11 self-start sm:min-h-9" onClick={onClose}>
      Close
    </Button>
  );

  if (sentTo) {
    return (
      <>
        <p className="text-sm">
          Offer sent to <span className="font-medium">{sentTo}</span>. It&apos;s in their mailbox now. Once they accept, check for the reply in your
          Mailbox and they&apos;re linked.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <Link href="/mailbox" className="inline-flex min-h-11 items-center text-sm font-medium underline underline-offset-4 sm:min-h-9">
            Open Mailbox
          </Link>
          <Button variant="outline" className="min-h-11 sm:min-h-9" onClick={onClose}>
            Done
          </Button>
        </div>
      </>
    );
  }

  // 0. What the offer needs before it can be written.
  if (!rail || !rail.businessNameHash) {
    return (
      <>
        <div>
          <h3 className="text-sm font-semibold">Send an offer to {worker.name}</h3>
          <p className="text-xs text-muted-foreground">Two things first. Each is done once for the whole business.</p>
        </div>
        <Checklist
          steps={[
            {
              done: !!rail,
              text: rail ? `Shield is linked (${shortAddress(rail.address)})` : "Link your Shield account to these books",
              action: !rail && (
                <Link href="/settings" className="inline-flex min-h-11 items-center self-start text-sm font-medium underline sm:min-h-9">
                  Open Settings and tap Connect Shield
                </Link>
              ),
            },
            {
              done: false,
              text: "Register your business name",
              action: rail ? (
                registering ? (
                  <RegisterFlow onClose={() => setRegistering(false)} />
                ) : (
                  <div className="flex flex-col gap-3">
                    <Button className="min-h-11 self-start sm:min-h-9" onClick={() => setRegistering(true)}>
                      Register your business name
                    </Button>
                    <details className="text-xs text-muted-foreground">
                      <summary className="cursor-pointer">I already have one</summary>
                      <form
                        className="mt-2 flex flex-col gap-2"
                        onSubmit={(e) => {
                          e.preventDefault();
                          if (bizName.trim() && !bizBusy) void confirmBusinessName();
                        }}
                      >
                        <p>
                          Type it, like dayco.{BRAND.nameSuffix}. It counts only if this account owns it.
                        </p>
                        <div className="flex gap-2">
                          <input
                            className={inputClass}
                            aria-label="Your registered business name"
                            value={bizName}
                            onChange={(e) => setBizName(e.target.value)}
                            autoComplete="off"
                            spellCheck={false}
                          />
                          <Button type="submit" variant="outline" className="min-h-11 whitespace-nowrap sm:min-h-10" disabled={bizBusy || !bizName.trim()}>
                            {bizBusy ? "Checking…" : "Check"}
                          </Button>
                        </div>
                      </form>
                    </details>
                  </div>
                )
              ) : undefined,
            },
          ]}
        />
        <FormError message={error} />
        {cancel}
      </>
    );
  }

  const pay = payLine(worker.payType, worker.rate, worker.frequency);

  // 3. The agreement as they will read it.
  if (reviewing && found && address && !mismatch) {
    return (
      <>
        <div>
          <h3 className="text-sm font-semibold">Review the offer to {worker.name}</h3>
          <p className="text-xs text-muted-foreground">This is exactly what lands in their mailbox. Check it, then send.</p>
        </div>
        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-xs text-muted-foreground">To</dt>
            <dd className="font-medium">{nameOf(found)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Pay</dt>
            <dd>{pay}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Starts</dt>
            <dd>{longDate(startDate)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Ends</dt>
            <dd>{endDate ? longDate(endDate) : "Open-ended"}</dd>
          </div>
        </dl>
        <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-md border bg-card p-3 font-sans text-sm">{terms}</pre>
        {stage && <p className="text-xs text-muted-foreground">{STAGE_COPY[stage]}</p>}
        {!stage && (
          <p className="text-xs text-muted-foreground">
            Shield asks you to approve one transaction; the employer pays its network fee. Nothing is paid to anyone.
          </p>
        )}
        <FormError message={error ?? shieldError} />
        <div className="flex gap-3">
          <Button type="button" variant="outline" className="h-11 flex-1 sm:flex-none" onClick={() => setReviewing(false)} disabled={!!stage}>
            Back
          </Button>
          <Button type="button" className="h-11 flex-1 sm:flex-none" disabled={!!stage || mailboxOff} onClick={() => void send(address)}>
            {stage ? "Sending…" : "Send offer"}
          </Button>
        </div>
      </>
    );
  }

  const canReview = !!found && !!terms.trim() && !fieldProblem;

  return (
    <>
      <div>
        <h3 className="text-sm font-semibold">Send an offer to {worker.name}</h3>
        <p className="text-xs text-muted-foreground">
          {pay}, from their team record. The terms go to their mailbox, sealed; only a fingerprint of them goes on the rail.
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
          {cancel}
        </>
      ) : (
        <form
          className="grid gap-4 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (canReview) setReviewing(true);
          }}
        >
          <div className="sm:col-span-2">
            {found && !changingWho ? (
              <div className="flex flex-wrap items-center gap-3 rounded-md border bg-card px-3 py-2 text-sm">
                <span className="text-xs text-muted-foreground">To</span>
                <span className="font-medium">{nameOf(found)}</span>
                <span className="font-mono text-xs text-muted-foreground">{shortAddress(found.address)}</span>
                <Button type="button" variant="ghost" size="sm" className="ml-auto min-h-11 sm:min-h-8" onClick={() => setChangingWho(true)}>
                  Change
                </Button>
              </div>
            ) : (
              <NameLookup
                allow={["worker"]}
                label="Their name or account"
                hint={`Their registered name, like ana.${BRAND.nameSuffix}, or their account starting aleo1. They set a name up under Profile in their own ${BRAND.name}.`}
                onChange={(entry: DirectoryEntry | null) => {
                  setFound(entry ? { address: entry.address, nameHash: entry.nameHash, ...(entry.name ? { name: entry.name } : {}) } : null);
                  if (entry) setChangingWho(false);
                }}
              />
            )}
          </div>
          <Field label="Role" hint="Optional. Their job title.">
            <input className={inputClass} value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} autoComplete="off" />
          </Field>
          <Field label="Hours a week" hint="Optional. Leave blank to leave it out.">
            <input className={inputClass} inputMode="decimal" value={hoursPerWeek} onChange={(e) => setHoursPerWeek(e.target.value)} autoComplete="off" />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Duties" hint="Optional. A sentence or two on what the job is.">
              <textarea className={`${inputClass} min-h-20`} value={duties} onChange={(e) => setDuties(e.target.value)} />
            </Field>
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
          <Field label="Notice to end (days)" hint="Optional. How much notice either side gives.">
            <input className={inputClass} inputMode="numeric" value={noticeDays} onChange={(e) => setNoticeDays(e.target.value)} autoComplete="off" />
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
          <div className="sm:col-span-2">
            <Field
              label="Terms"
              hint={
                termsEdited
                  ? "Your own wording. They read exactly this."
                  : "Drafted from the fields above. Edit it however you like; they read exactly this."
              }
            >
              <textarea
                className={`${inputClass} min-h-40`}
                value={terms}
                onChange={(e) => {
                  setTermsText(e.target.value);
                  setTermsEdited(true);
                }}
                required
              />
            </Field>
            {termsEdited && (
              <Button type="button" variant="ghost" size="sm" className="mt-1 min-h-11 sm:min-h-8" onClick={() => setTermsEdited(false)}>
                Start over from the fields
              </Button>
            )}
          </div>
          <div className="flex flex-col gap-3 sm:col-span-2">
            <FormError message={error ?? fieldProblem ?? shieldError} />
            <div className="flex gap-3">
              <Button type="button" variant="outline" className="h-11 flex-1 sm:flex-none" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" className="h-11 flex-1 sm:flex-none" disabled={!canReview}>
                Review offer
              </Button>
            </div>
          </div>
        </form>
      )}
    </>
  );
}
