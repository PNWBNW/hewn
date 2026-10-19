"use client";

// ---------------------------------------------------------------------------
// Putting a posting on the board, changing it, featuring it or closing it:
// one program call each, signed in Shield (docs/JOB_BOARD.md). Posting
// costs $1 USDCx to the Hewn foundation and featuring $5 a day, both from
// the business's public USDCx balance, plus the network fee. The business
// name and its industry code gate every call on chain. Loaded through a
// dynamic import from the Jobs page. Nothing here logs a key or an account.
// ---------------------------------------------------------------------------

import { useEffect, useState } from "react";
import { Button } from "@pnw/ui/button";
import { type FeeMode, readFeeMode } from "@pnw/wallet/fee-mode";
import { AleoWalletProviderWrapper } from "@pnw/wallet/wallet-provider";
import { Field, FormError, errorMessage, inputClass } from "@/books/AuthCard";
import { useOpenBooks } from "@/books/BooksProvider";
import {
  EMPLOYMENT_TYPES,
  EMPLOYMENT_TYPE_LABEL,
  type JobPosting,
  MAX_DESCRIPTION_CHARS,
  MAX_LOCATION_CHARS,
  MAX_TITLE_CHARS,
  PAY_TYPES,
  PAY_TYPE_LABEL,
  PLACES,
  PLACE_LABEL,
  type PostingFacts,
  putPosting,
  validateBody,
  validateFacts,
} from "@/books/jobs";
import { shortAddress } from "@/books/rail";
import { FeeChoice } from "./FeeChoice";
import { ShieldStatus } from "./ShieldStatus";
import { newHiringKey } from "./applications";
import { queryEmployerSuffix } from "./directory";
import {
  MAX_FEATURE_DAYS,
  type PostingKey,
  closeCall,
  daysAllowed,
  explorerJobsRead,
  featureCall,
  featureCostCents,
  featuredDaysLeft,
  featuredUntilAfter,
  newPostingId,
  packBody,
  postCall,
  readPosting,
  updateCall,
} from "./jobs";
import { fetchLatestHeight } from "./offer";
import { useShield } from "./shield";
import { executeAndWait } from "./work/execute";

export type JobPanelProps =
  | { mode: "new"; onClose: () => void }
  | { mode: "edit"; posting: JobPosting; onClose: () => void }
  | { mode: "feature"; posting: JobPosting; onClose: () => void }
  | { mode: "close"; posting: JobPosting; onClose: () => void };

export default function JobPanel(props: JobPanelProps) {
  return (
    <AleoWalletProviderWrapper>
      <div className="flex flex-col gap-4 rounded-md border bg-muted/40 p-4">
        <Gate {...props} />
      </div>
    </AleoWalletProviderWrapper>
  );
}

const dollars = (cents: number) => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** The fee choice, with the one thing it doesn't change (Joshua, 2026-10-19): the posting is public either way. */
function PostingFee({ value, onChange }: { value: FeeMode; onChange: (mode: FeeMode) => void }) {
  return (
    <div className="flex flex-col gap-1.5">
      <FeeChoice value={value} onChange={onChange} />
      <p className="text-xs text-muted-foreground">
        Private or public only changes which ALEO pays the network fee. The posting itself is public either way: it lives on the board under your business
        name for anyone to read.
      </p>
    </div>
  );
}

/** Shield connected to the linked account, and the business name's industry code read from the registry. */
function Gate(props: JobPanelProps) {
  const { rail } = useOpenBooks();
  const { state, connect, error: shieldError, wallet } = useShield();
  const [suffix, setSuffix] = useState<number | null | "reading">("reading");
  const address = state.kind === "connected" ? state.address : null;
  const mismatch = address !== null && rail !== null && address !== rail.address;
  const nameHash = rail?.businessNameHash;

  useEffect(() => {
    if (!nameHash) return;
    let live = true;
    void queryEmployerSuffix(nameHash).then((code) => live && setSuffix(code));
    return () => {
      live = false;
    };
  }, [nameHash]);

  if (!rail || !nameHash) return <FormError message="Register your business name in Settings first; postings go on the board under it." />;
  if (!address) {
    return (
      <>
        <ShieldStatus state={state} connect={connect} onClose={props.onClose} />
        {shieldError && <p className="text-sm text-destructive">{shieldError}</p>}
      </>
    );
  }
  if (mismatch) {
    return (
      <>
        <p className="text-sm">
          Shield is signed in to a different account ({shortAddress(address)}) than the one linked to these books ({shortAddress(rail.address)}). Switch accounts in
          Shield, then try again.
        </p>
        <Button variant="outline" className="min-h-11 self-start sm:min-h-9" onClick={props.onClose}>
          Close
        </Button>
      </>
    );
  }
  if (suffix === "reading") return <p className="text-sm text-muted-foreground">Reading your business name on the registry…</p>;
  if (suffix === null) return <FormError message="Couldn't read your business name's industry on the registry. Try again in a moment." />;

  const key = (id: string): PostingKey => ({ id, employerNameHash: nameHash, suffixCode: suffix });
  if (props.mode === "feature") return <FeatureFlow posting={props.posting} keyFor={key} wallet={wallet} onClose={props.onClose} />;
  if (props.mode === "close") return <CloseFlow posting={props.posting} keyFor={key} wallet={wallet} onClose={props.onClose} />;
  return <EditFlow posting={props.mode === "edit" ? props.posting : undefined} keyFor={key} wallet={wallet} onClose={props.onClose} />;
}

type FlowProps = { keyFor: (id: string) => PostingKey; wallet: ReturnType<typeof useShield>["wallet"]; onClose: () => void };

const cents = (dollarsText: string): number => {
  const t = dollarsText.trim().replace(/[$,]/g, "");
  if (!t) return 0;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : -1;
};
const dollarsText = (c: number) => (c === 0 ? "" : (c / 100).toFixed(2).replace(/\.00$/, ""));

function EditFlow({ posting, keyFor, wallet, onClose }: FlowProps & { posting?: JobPosting }) {
  const { updateCompany } = useOpenBooks();
  const [title, setTitle] = useState(posting?.title ?? "");
  const [location, setLocation] = useState(posting?.location ?? "");
  const [description, setDescription] = useState(posting?.description ?? "");
  const [payType, setPayType] = useState<PostingFacts["payType"]>(posting?.facts.payType ?? "hourly");
  const [payMin, setPayMin] = useState(posting ? dollarsText(posting.facts.payMinCents) : "");
  const [payMax, setPayMax] = useState(posting ? dollarsText(posting.facts.payMaxCents) : "");
  const [employmentType, setEmploymentType] = useState<PostingFacts["employmentType"]>(posting?.facts.employmentType ?? "full_time");
  const [hours, setHours] = useState(posting && posting.facts.hoursPerWeekTenths > 0 ? (posting.facts.hoursPerWeekTenths / 10).toString() : "");
  const [place, setPlace] = useState<PostingFacts["place"]>(posting?.facts.place ?? "on_site");
  const [feeMode, setFeeMode] = useState<FeeMode>(() => readFeeMode());
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const editing = posting !== undefined;

  async function send() {
    setError(null);
    try {
      const hidden = payType === "hidden";
      const min = hidden ? 0 : cents(payMin);
      const max = hidden ? 0 : cents(payMax || payMin);
      if (min < 0 || max < 0) throw new Error("Pay must be a number");
      const h = hours.trim() ? Number(hours) : 0;
      if (!Number.isFinite(h) || h < 0) throw new Error("Hours a week must be a number");
      const facts = validateFacts({ payType, payMinCents: min, payMaxCents: max, employmentType, hoursPerWeekTenths: Math.round(h * 10), place });
      // The posting's hiring key: applicants seal their application to its public half (chain/applications.ts).
      const hiring = posting?.hiring ?? (await newHiringKey());
      const body = validateBody({ title, location, description, hiringKey: hiring.publicKey });
      setProgress("Packing the posting…");
      const fields = await packBody(body);
      const id = posting?.id ?? newPostingId();
      const call = editing ? updateCall(keyFor(id), facts, fields) : postCall(keyFor(id), facts, fields);
      setProgress("Approve it in Shield…");
      const { transactionId } = await executeAndWait(wallet, { ...call, feeMode });
      const now = new Date().toISOString();
      const saved: JobPosting = editing ? { ...posting, ...body, facts, hiring, updatedAt: now } : { ...body, id, facts, hiring, postedAt: now, transactionId };
      await updateCompany((c) => ({ ...c, jobs: putPosting(c.jobs, saved) }));
      onClose();
    } catch (e) {
      setError(errorMessage(e));
      setProgress(null);
    }
  }

  const busy = progress !== null;
  return (
    <>
      <div>
        <h3 className="text-sm font-semibold">{editing ? "Change the posting" : "New posting"}</h3>
        <p className="text-xs text-muted-foreground">Everything here is public on the board. Applications come to you privately.</p>
      </div>
      <Field label="Title">
        <input className={inputClass} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={MAX_TITLE_CHARS} disabled={busy} />
      </Field>
      <Field label="Location" hint="A city, or where the work is. Leave it empty for remote work.">
        <input className={inputClass} value={location} onChange={(e) => setLocation(e.target.value)} maxLength={MAX_LOCATION_CHARS} disabled={busy} />
      </Field>
      <Field
        label="Description"
        hint={`${description.length.toLocaleString("en-US")} of ${MAX_DESCRIPTION_CHARS.toLocaleString("en-US")} characters. Duties, schedule, what you're looking for.`}
      >
        <textarea
          className={`${inputClass} h-auto min-h-40 py-2`}
          rows={8}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={MAX_DESCRIPTION_CHARS}
          disabled={busy}
        />
      </Field>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Pay">
          <select className={inputClass} value={payType} onChange={(e) => setPayType(e.target.value as PostingFacts["payType"])} disabled={busy}>
            {PAY_TYPES.map((t) => (
              <option key={t} value={t}>
                {PAY_TYPE_LABEL[t]}
              </option>
            ))}
          </select>
        </Field>
        {payType !== "hidden" && (
          <>
            <Field label={payType === "hourly" ? "From, $ an hour" : "From, $ a year"}>
              <input className={inputClass} inputMode="decimal" value={payMin} onChange={(e) => setPayMin(e.target.value)} disabled={busy} />
            </Field>
            <Field label="To (optional)">
              <input className={inputClass} inputMode="decimal" value={payMax} onChange={(e) => setPayMax(e.target.value)} disabled={busy} />
            </Field>
          </>
        )}
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Kind of work">
          <select className={inputClass} value={employmentType} onChange={(e) => setEmploymentType(e.target.value as PostingFacts["employmentType"])} disabled={busy}>
            {EMPLOYMENT_TYPES.map((t) => (
              <option key={t} value={t}>
                {EMPLOYMENT_TYPE_LABEL[t]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Hours a week (optional)">
          <input className={inputClass} inputMode="decimal" value={hours} onChange={(e) => setHours(e.target.value)} disabled={busy} />
        </Field>
        <Field label="Where">
          <select className={inputClass} value={place} onChange={(e) => setPlace(e.target.value as PostingFacts["place"])} disabled={busy}>
            {PLACES.map((t) => (
              <option key={t} value={t}>
                {PLACE_LABEL[t]}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <p className="text-xs text-muted-foreground">
        {editing
          ? "Changing a posting is free apart from the network fee. It stays where it is on the board."
          : "Posting costs $1 in USDCx, paid from your account's public balance to the Hewn foundation, plus the network fee. Shield asks once."}
      </p>
      {busy ? <p className="text-sm text-muted-foreground">{progress}</p> : <PostingFee value={feeMode} onChange={setFeeMode} />}
      <FormError message={error} />
      <div className="flex flex-wrap gap-3">
        <Button className="min-h-11 sm:min-h-9" disabled={busy || !title.trim() || !description.trim()} onClick={() => void send()}>
          {busy ? (editing ? "Changing…" : "Posting…") : editing ? "Change it" : "Post it ($1)"}
        </Button>
        <Button variant="outline" className="min-h-11 sm:min-h-9" disabled={busy} onClick={onClose}>
          Cancel
        </Button>
      </div>
    </>
  );
}

function FeatureFlow({ posting, keyFor, wallet, onClose }: FlowProps & { posting: JobPosting }) {
  const { updateCompany } = useOpenBooks();
  const [board, setBoard] = useState<{ height: number; featuredUntil: number } | null | "failed">(null);
  const [days, setDays] = useState("7");
  const [feeMode, setFeeMode] = useState<FeeMode>(() => readFeeMode());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Where the window stands now, from the chain: the cap counts what's already ahead.
  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const [height, current] = await Promise.all([fetchLatestHeight(), readPosting(explorerJobsRead(), posting.id)]);
        if (live) setBoard({ height, featuredUntil: current?.featuredUntil ?? posting.featuredUntil ?? 0 });
      } catch {
        if (live) setBoard("failed");
      }
    })();
    return () => {
      live = false;
    };
  }, [posting.id, posting.featuredUntil]);

  if (board === null) return <p className="text-sm text-muted-foreground">Reading the board…</p>;
  if (board === "failed") return <FormError message="Couldn't read the board. Try again in a moment." />;
  const allowed = Math.min(MAX_FEATURE_DAYS, daysAllowed(board.featuredUntil, board.height));
  const left = featuredDaysLeft(board.featuredUntil, board.height);
  const n = Number(days);
  const valid = Number.isInteger(n) && n >= 1 && n <= allowed;

  async function send() {
    if (!valid || board === null || board === "failed") return;
    setBusy(true);
    setError(null);
    try {
      await executeAndWait(wallet, { ...featureCall(keyFor(posting.id), n), feeMode });
      const featuredUntil = featuredUntilAfter(board.featuredUntil, board.height, n);
      await updateCompany((c) => ({ ...c, jobs: putPosting(c.jobs, { ...posting, featuredUntil }) }));
      onClose();
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }

  return (
    <>
      <div>
        <h3 className="text-sm font-semibold">Feature “{posting.title}”</h3>
        <p className="text-xs text-muted-foreground">
          A featured posting sits near the top of the board for everyone, ahead of the rest, until its days run out. $5 a day, up to {MAX_FEATURE_DAYS} days
          ahead at a time.
          {left > 0 && ` It has about ${left} ${left === 1 ? "day" : "days"} left now; more days add to that.`}
        </p>
      </div>
      {allowed === 0 ? (
        <p className="text-sm">It already has the most days it can have ahead. Come back when some have passed.</p>
      ) : (
        <Field label={`Days (1 to ${allowed})`} hint={valid ? `${dollars(featureCostCents(n))} in USDCx from your account's public balance, plus the network fee.` : undefined}>
          <input className={inputClass} inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value)} disabled={busy} />
        </Field>
      )}
      {busy ? <p className="text-sm text-muted-foreground">Approve it in Shield…</p> : allowed > 0 && <PostingFee value={feeMode} onChange={setFeeMode} />}
      <FormError message={error} />
      <div className="flex flex-wrap gap-3">
        {allowed > 0 && (
          <Button className="min-h-11 sm:min-h-9" disabled={busy || !valid} onClick={() => void send()}>
            {busy ? "Featuring…" : valid ? `Feature it (${dollars(featureCostCents(n))})` : "Feature it"}
          </Button>
        )}
        <Button variant="outline" className="min-h-11 sm:min-h-9" disabled={busy} onClick={onClose}>
          {allowed > 0 ? "Cancel" : "Close"}
        </Button>
      </div>
    </>
  );
}

function CloseFlow({ posting, keyFor, wallet, onClose }: FlowProps & { posting: JobPosting }) {
  const { updateCompany } = useOpenBooks();
  const [feeMode, setFeeMode] = useState<FeeMode>(() => readFeeMode());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    setBusy(true);
    setError(null);
    try {
      await executeAndWait(wallet, { ...closeCall(keyFor(posting.id)), feeMode });
      await updateCompany((c) => ({ ...c, jobs: putPosting(c.jobs, { ...posting, closedAt: new Date().toISOString() }) }));
      onClose();
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }

  return (
    <>
      <div>
        <h3 className="text-sm font-semibold">Close “{posting.title}”</h3>
        <p className="text-xs text-muted-foreground">
          It comes off the board for good; to hire for it again later, post it again. Closing is free apart from the network fee. Anyone who already applied
          keeps their conversation with you.
        </p>
      </div>
      {busy ? <p className="text-sm text-muted-foreground">Approve it in Shield…</p> : <PostingFee value={feeMode} onChange={setFeeMode} />}
      <FormError message={error} />
      <div className="flex flex-wrap gap-3">
        <Button variant="destructive" className="min-h-11 sm:min-h-9" disabled={busy} onClick={() => void send()}>
          {busy ? "Closing…" : "Close the posting"}
        </Button>
        <Button variant="outline" className="min-h-11 sm:min-h-9" disabled={busy} onClick={onClose}>
          Keep it open
        </Button>
      </div>
    </>
  );
}
