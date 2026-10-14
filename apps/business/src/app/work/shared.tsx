"use client";

// Small pieces the person's pages share: names, labels, a ticking clock and
// the one line shown when no account is linked yet.

import Link from "next/link";
import { useEffect, useState } from "react";
import { shortAddress } from "@/books/rail";
import type { AgreementStatus, Terms, WorkAgreement } from "@/books/work";
import { BRAND } from "@/brand";

export const STATUS_LABEL: Record<AgreementStatus, string> = { pending: "Waiting for you", active: "Active", paused: "Paused", terminated: "Ended" };

/** `brothers.hewn`, or the short account when the employer has no registered name. */
export const registeredLabel = (a: Pick<WorkAgreement, "employerName" | "employerAddress">): string =>
  a.employerName ? `${a.employerName}.${BRAND.nameSuffix}` : shortAddress(a.employerAddress);

/** The business as it named itself in the terms, else its registered name, else the short account. */
export const employerLabel = (a: Pick<WorkAgreement, "employerName" | "employerAddress" | "terms">): string =>
  a.terms?.businessName || registeredLabel(a);

const FREQUENCY: Record<Terms["frequency"], string> = { weekly: "weekly", biweekly: "every two weeks", semimonthly: "twice a month", monthly: "monthly" };

export const dollars = (cents: string | bigint): string => `$${(Number(cents) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** "$30.00 per hour, paid weekly". */
export const payLine = (t: Terms): string => `${dollars(t.rate)} ${t.payType === "hourly" ? "per hour" : "per year"}, paid ${FREQUENCY[t.frequency]}`;

/** The current time, refreshed every `everyMs` (a minute by default), so open shifts tick. */
export function useNow(everyMs = 60_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), everyMs);
    return () => clearInterval(t);
  }, [everyMs]);
  return now;
}

export const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
export const clock = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
export const dayLabel = (date: string) => new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });

/** Shown on the pages that need Shield when none is linked yet. */
export function RailNeeded() {
  return (
    <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
      Connect Shield in{" "}
      <Link href="/settings" className="underline underline-offset-4">
        Settings
      </Link>{" "}
      first.
    </p>
  );
}
