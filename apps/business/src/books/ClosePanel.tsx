"use client";

// ---------------------------------------------------------------------------
// Close the books (docs/CLOSE_PERIOD.md): the range, the checklist, the
// closes so far with their anchors, reopening and locking. The Shield check
// and the anchor are the chain side's (chain/CloseShield.tsx), passed in by
// the page, so these books import nothing of the chain.
// ---------------------------------------------------------------------------

import { type ReactNode, useState } from "react";
import { CircleCheck, Circle, FileCheck, Lock } from "lucide-react";
import Link from "next/link";
import { Button } from "@pnw/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@pnw/ui/card";
import { Field, FormError, errorMessage, inputClass } from "./AuthCard";
import { useOpenBooks } from "./BooksProvider";
import {
  type CloseRecord,
  closeChecks,
  closeRange,
  lockCloses,
  nextStart,
  periodProofFor,
  proofFileName,
  recordAnchor,
  reopenCloses,
  settlementsIn,
  standingCloses,
  suggestedEnd,
} from "./close";
import { todayIso } from "./display";
import { periodProofToJson } from "@pnw/ledger";
import { saveFile } from "./save_file";
import { nextDay } from "@pnw/ledger";

/** What the chain side gets to close: whether every other line passes, and the steps to call. */
export type CloseActionProps = {
  start: string;
  end: string;
  /** Every line of the checklist but the Shield check passes. */
  ready: boolean;
  /** Closes the books through `end`, once the Shield check says Matches; returns the root to anchor. */
  close: () => Promise<{ end: string; root: string }>;
  /** Notes the anchor's transaction once it lands. */
  anchored: (end: string, txId: string) => Promise<void>;
};

export type AnchorActionProps = {
  record: Pick<CloseRecord, "end" | "root">;
  anchored: (end: string, txId: string) => Promise<void>;
};

const day = (iso: string) => new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
const range = (r: Pick<CloseRecord, "start" | "end">) => `${day(r.start)} to ${day(r.end)}`;

function randomSecret(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, "0")).join("");
}

export function ClosePanel({
  closeAction,
  anchorAction,
  txLink,
}: {
  closeAction: (p: CloseActionProps) => ReactNode;
  anchorAction: (p: AnchorActionProps) => ReactNode;
  txLink: (id: string) => ReactNode;
}) {
  const { books, payroll, sales, review, rail, closing, currentCompany, updateCompany } = useOpenBooks();
  const today = todayIso();
  const start = nextStart({ books });
  const [end, setEnd] = useState(() => (start ? suggestedEnd(start, today) : today));
  const [error, setError] = useState<string | null>(null);
  const [exported, setExported] = useState<string | null>(null);

  const exportProof = async (r: CloseRecord) => {
    setError(null);
    setExported(null);
    try {
      const c = currentCompany();
      if (!c) throw new Error("Books are not open");
      const proof = periodProofFor(c, r, new Date().toISOString());
      const saved = await saveFile(periodProofToJson(proof), proofFileName(c.books.settings.businessName, r));
      if (saved !== "cancelled") setExported(`${range(r)}: the proof file is ${saved === "shared" ? "shared" : "downloaded"}.`);
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const checks = start ? closeChecks({ books, payroll, sales, review: review ?? undefined }, start, end, today) : [];
  const ready = checks.length > 0 && checks.every((c) => c.ok);
  const entries = start ? books.entries.filter((e) => e.date >= start && e.date <= end).length : 0;
  const paid = start ? settlementsIn({ books, payroll, rail: rail ?? undefined }, start, end).length : 0;

  const close = async () => {
    const c = currentCompany();
    if (!c || !start) throw new Error("Books are not open");
    let record: CloseRecord | null = null;
    await updateCompany((latest) => {
      const r = closeRange(latest, end, { today, now: new Date().toISOString(), shieldMatches: true, newSecret: randomSecret() });
      record = r.record;
      return r.company;
    });
    const done = record as CloseRecord | null;
    if (!done) throw new Error("The close didn't save");
    return { end: done.end, root: done.root };
  };
  const anchored = async (closedEnd: string, txId: string) => {
    await updateCompany((c) => recordAnchor(c, closedEnd, txId, new Date().toISOString()));
  };

  const records = [...(closing?.records ?? [])].reverse();
  const standing = standingCloses(closing ?? undefined);
  const lastStanding = standing.at(-1);
  const closedThrough = books.marks.closedThrough;
  const lockedThrough = books.marks.lockedThrough;

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Close a period</CardTitle>
          <p className="text-sm text-muted-foreground">
            {closedThrough ? `The books are closed through ${day(closedThrough)}.` : "Nothing is closed yet."} Closing locks a range against new entries and anchors one
            fingerprint of it in public: no amounts, names or accounts.
          </p>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {!start ? (
            <p className="text-sm text-muted-foreground">There&apos;s nothing in the books to close yet.</p>
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="From" hint="The day after the last close, or the books' first entry">
                  <input className={inputClass} value={day(start)} readOnly aria-readonly />
                </Field>
                <Field label="Through" hint="Any day before today">
                  <input type="date" className={inputClass} value={end} min={start} max={today} onChange={(e) => setEnd(e.target.value)} />
                </Field>
              </div>
              <ul className="flex flex-col gap-2" aria-label="Before closing">
                {checks.map((c) => (
                  <li key={c.id} className="flex items-start gap-2 text-sm">
                    {c.ok ? <CircleCheck aria-hidden className="mt-0.5 size-4 shrink-0 text-money-positive" /> : <Circle aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />}
                    <span>
                      {c.label}
                      {!c.ok && c.detail && (
                        <span className="block text-xs text-muted-foreground">
                          {c.detail}
                          {c.href && (
                            <>
                              {" · "}
                              <Link href={c.href} className="underline underline-offset-2">
                                Go there
                              </Link>
                            </>
                          )}
                        </span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="text-xs text-muted-foreground">
                {entries} {entries === 1 ? "entry" : "entries"} and {paid} {paid === 1 ? "paycheck" : "paychecks"} paid through Shield in the range. What&apos;s
                published: one 32-byte fingerprint, and the block it lands in.
              </p>
              {rail ? (
                closeAction({ start, end, ready, close, anchored })
              ) : (
                <p className="text-sm text-muted-foreground">Link your Shield account in Settings to close and anchor.</p>
              )}
            </>
          )}
          <FormError message={error} />
        </CardContent>
      </Card>

      {records.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Closes</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <ul className="flex flex-col divide-y">
              {records.map((r) => (
                <li key={`${r.end}:${r.closedAt}`} className="flex flex-col gap-1 py-2 text-sm">
                  <span className="font-medium">{range(r)}</span>
                  <span className="text-xs text-muted-foreground">
                    Closed {day(r.closedAt)} · {r.entries} {r.entries === 1 ? "entry" : "entries"}
                    {r.reopenedAt ? ` · reopened ${day(r.reopenedAt)}` : ""}
                    {lockedThrough && r.end <= lockedThrough ? " · locked" : ""}
                  </span>
                  {r.anchor ? (
                    <span className="text-xs">Anchored: {txLink(r.anchor.txId)}</span>
                  ) : r.reopenedAt ? null : (
                    <span className="flex flex-col gap-1 text-xs">
                      <span className="text-muted-foreground">Not anchored yet.</span>
                      {anchorAction({ record: r, anchored })}
                    </span>
                  )}
                  {!r.reopenedAt && (
                    <Button variant="outline" className="min-h-11 self-start sm:min-h-9" onClick={() => void exportProof(r)}>
                      <FileCheck aria-hidden className="size-4" /> Export proof
                    </Button>
                  )}
                </li>
              ))}
            </ul>
            <p className="text-xs text-muted-foreground">
              A proof file lets your accountant or an auditor check that a closed range is complete and unchanged: it recomputes the fingerprint
              anchored in public from every entry. It holds every entry in the range, wages and the addresses paid included, so give it only to
              them. Anyone can check one at{" "}
              <Link href="/verify" className="underline underline-offset-2">
                Check a proof
              </Link>
              , on their own device.
            </p>
            {exported && <p className="text-xs text-money-positive">{exported}</p>}
            {lastStanding && closedThrough && (
              <ReopenOrLock
                closedThrough={closedThrough}
                lockedThrough={lockedThrough}
                onReopen={async (date) => {
                  setError(null);
                  try {
                    await updateCompany((c) => reopenCloses(c, date, new Date().toISOString()));
                  } catch (e) {
                    setError(errorMessage(e));
                  }
                }}
                onLock={async () => {
                  setError(null);
                  try {
                    await updateCompany((c) => lockCloses(c, closedThrough, new Date().toISOString()));
                  } catch (e) {
                    setError(errorMessage(e));
                  }
                }}
              />
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function ReopenOrLock({
  closedThrough,
  lockedThrough,
  onReopen,
  onLock,
}: {
  closedThrough: string;
  lockedThrough: string | undefined;
  onReopen: (date: string) => Promise<void>;
  onLock: () => Promise<void>;
}) {
  const [date, setDate] = useState(closedThrough);
  const locked = !!lockedThrough && lockedThrough >= closedThrough;
  if (locked) return <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><Lock aria-hidden className="size-3" /> Locked through {day(lockedThrough!)}: for good.</p>;
  return (
    <details className="text-sm">
      <summary className="cursor-pointer text-muted-foreground">Reopen or lock</summary>
      <div className="mt-2 flex flex-col gap-3">
        <div className="flex flex-col gap-2">
          <p className="text-xs text-muted-foreground">
            Reopening lets you fix a closed range: it opens the chosen day and everything after it. The fingerprint already anchored stays; closing again
            anchors a new one.
          </p>
          <div className="flex flex-wrap items-end gap-2">
            <input type="date" className={`${inputClass} max-w-48`} value={date} min={lockedThrough ? nextDay(lockedThrough) : undefined} max={closedThrough} onChange={(e) => setDate(e.target.value)} aria-label="Reopen from" />
            <Button
              variant="outline"
              className="min-h-11 sm:min-h-9"
              onClick={() => {
                if (window.confirm(`Reopen the books from ${day(date)}? Everything from that day on can be changed again.`)) void onReopen(date);
              }}
            >
              Reopen from this day
            </Button>
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <p className="text-xs text-muted-foreground">
            Locking is for good, after taxes are filed: nothing through {day(closedThrough)} can be reopened or reversed again.
          </p>
          <Button
            variant="outline"
            className="min-h-11 self-start sm:min-h-9"
            onClick={() => {
              if (window.confirm(`Lock the books through ${day(closedThrough)} for good? This can't be undone.`)) void onLock();
            }}
          >
            <Lock aria-hidden className="size-4" /> Lock through {day(closedThrough)}
          </Button>
        </div>
      </div>
    </details>
  );
}
