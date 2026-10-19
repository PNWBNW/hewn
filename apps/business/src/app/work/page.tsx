"use client";

// Home, for a person who works for a business: one big clock button, today
// and this week, who they work for, send the week, and the latest paystub.
// Punches are written to the vault here and nowhere else leaves the device.

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, Clock } from "lucide-react";
import { Button } from "@pnw/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@pnw/ui/card";
import { cn } from "@pnw/ui/utils";
import { FormError, errorMessage, inputClass } from "@/books/AuthCard";
import { useWork } from "@/books/BooksProvider";
import { calendarOf, formatMinutes, localDate, longestMinutesOf, minutesOn, weekMinutes, weekStartOf } from "@/books/hours";
import { paystubFromCanonical } from "@/books/paystub_document";
import { activeAgreements, openPunch, punch } from "@/books/work";
import { PageHeader } from "@/shell/SectionView";
import { SendWeek } from "./SendWeek";
import { STATUS_LABEL, clock, dollars, employerLabel, payLine, useNow } from "./shared";

export default function WorkHomePage() {
  const { work, updateWork } = useWork();
  const now = useNow(30_000);
  const active = activeAgreements(work);
  const [chosen, setChosen] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const agreementId = active.some((a) => a.agreementId === chosen) ? chosen : (active[0]?.agreementId ?? "");
  // Days and weeks on the agreement's calendar (the work week in its terms; Monday and this device's zone without one).
  const agreement = active.find((a) => a.agreementId === agreementId);
  const calendar = calendarOf(agreement);
  const longest = longestMinutesOf(agreement);
  const today = localDate(now, calendar.timeZone);
  const weekStart = weekStartOf(today, calendar);
  const open = agreementId ? openPunch(work, agreementId) : undefined;
  // Clocked in past the longest shift: most likely a forgotten clock-out.
  const openFor = open ? Math.floor((now.getTime() - Date.parse(open.at)) / 60_000) : 0;
  const overlong = !!open && openFor > longest;
  const latest = [...work.paystubs].sort((a, b) => (a.receivedAt < b.receivedAt ? 1 : -1))[0];

  async function clockInOut() {
    setBusy(true);
    setError(null);
    try {
      await updateWork((w) => punch(w, agreementId).work);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={`Hi, ${work.displayName.split(" ")[0] || work.displayName}`} summary="Clock in, clock out, send your week, keep every paystub." />

      <Card>
        <CardContent className="flex flex-col items-center gap-4 pt-6">
          {active.length > 1 && (
            <label className="w-full text-sm">
              <span className="text-xs text-muted-foreground">Working for</span>
              <select className={cn(inputClass, "mt-1")} value={agreementId} onChange={(e) => setChosen(e.target.value)} disabled={!!open}>
                {active.map((a) => (
                  <option key={a.agreementId} value={a.agreementId}>
                    {employerLabel(a)}
                  </option>
                ))}
              </select>
            </label>
          )}
          <Button
            variant={open ? "destructive" : "default"}
            className="h-28 w-full max-w-xs rounded-full text-xl font-semibold shadow-md"
            disabled={busy || active.length === 0}
            onClick={() => void clockInOut()}
            aria-label={open ? "Clock out" : "Clock in"}
          >
            <Clock aria-hidden className="size-6" />
            {busy ? "Saving…" : open ? "Clock out" : "Clock in"}
          </Button>
          {active.length === 0 ? (
            <p className="text-center text-sm text-muted-foreground">
              Accept an offer first, then clock in.{" "}
              <Link href="/work/offers" className="underline underline-offset-4">
                Offers
              </Link>
            </p>
          ) : open && overlong ? (
            <p className="text-center text-sm text-warning" role="status">
              On the clock since {clock(open.at, calendar.timeZone)}: {formatMinutes(openFor)}, longer than your longest shift ({formatMinutes(longest).replace(/ 00m$/, "")}).
              Forgot to clock out? Set the time you left under{" "}
              <Link href="/work/hours" className="underline underline-offset-4">
                Hours
              </Link>
              ; until then the hours stop counting there.
            </p>
          ) : open ? (
            <p className="text-sm text-muted-foreground">On the clock since {clock(open.at, calendar.timeZone)}</p>
          ) : (
            <p className="text-sm text-muted-foreground">Off the clock</p>
          )}
          <FormError message={error} />
          <dl className="grid w-full grid-cols-2 gap-3 text-center">
            <div className="rounded-md border p-3">
              <dt className="text-xs text-muted-foreground">Today</dt>
              <dd className="text-lg font-semibold tabular-nums">{formatMinutes(agreementId ? minutesOn(work.punches, agreementId, today, now, calendar.timeZone, longest) : 0)}</dd>
            </div>
            <div className="rounded-md border p-3">
              <dt className="text-xs text-muted-foreground">This week</dt>
              <dd className="text-lg font-semibold tabular-nums">{formatMinutes(agreementId ? weekMinutes(work.punches, agreementId, weekStart, now, calendar.timeZone, longest) : 0)}</dd>
            </div>
          </dl>
          {agreementId && <SendWeek agreementId={agreementId} weekStart={weekStart} now={now} />}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{work.agreements.length === 1 ? "Your employer" : "Your employers"}</CardTitle>
        </CardHeader>
        <CardContent>
          {work.agreements.length === 0 ? (
            <p className="text-sm text-muted-foreground">No agreements yet. When a business sends you an offer, it shows up under Offers.</p>
          ) : (
            <ul className="divide-y">
              {work.agreements.map((a) => (
                <li key={a.agreementId} className="flex items-baseline justify-between gap-3 py-2 text-sm">
                  <div className="min-w-0">
                    <div className="truncate font-medium">{employerLabel(a)}</div>
                    {a.terms && <div className="text-xs text-muted-foreground">{payLine(a.terms)}</div>}
                  </div>
                  <span className={cn("shrink-0 text-xs", a.status === "pending" ? "text-primary" : "text-muted-foreground")}>{STATUS_LABEL[a.status]}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Latest paystub</CardTitle>
        </CardHeader>
        <CardContent>
          {latest ? (
            <LatestPaystub document={latest.document} businessName={latest.businessName} />
          ) : (
            <p className="text-sm text-muted-foreground">
              Paystubs arrive here after each payday.{" "}
              <Link href="/work/paystubs" className="underline underline-offset-4">
                Check now
              </Link>
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function LatestPaystub({ document, businessName }: { document: unknown; businessName: string }) {
  let net = "";
  let payDate = "";
  try {
    const doc = paystubFromCanonical(document);
    net = dollars(doc.net);
    payDate = doc.payDate;
  } catch {
    return <p className="text-sm text-muted-foreground">The latest paystub couldn&apos;t be read.</p>;
  }
  return (
    <Link href="/work/paystubs" className="flex items-center justify-between gap-3 text-sm hover:text-primary">
      <span>
        <span className="block font-medium">{businessName}</span>
        <span className="block text-xs text-muted-foreground">Paid {payDate}</span>
      </span>
      <span className="flex items-center gap-2 font-semibold tabular-nums">
        {net}
        <ArrowRight aria-hidden className="size-4 text-muted-foreground" />
      </span>
    </Link>
  );
}
