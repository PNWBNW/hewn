"use client";

// "Send weekly timecard" / "Update weekly timecard" (Joshua, 2026-10-19: send
// it after any clock-out; a shift sent is confirmed and the employer's to
// change): the button and, once tapped, the sealed send to the employer,
// loaded only then (nobody who never sends downloads that code).

import { useState } from "react";
import dynamic from "next/dynamic";
import { Send } from "lucide-react";
import { Button } from "@pnw/ui/button";
import { useWork } from "@/books/BooksProvider";
import { formatMinutes, sendProblem, sendableMinutes, weekMinutes, calendarOf, longestMinutesOf } from "@/books/hours";
import { sentWeek } from "@/books/work";
import { employerLabel, when } from "./shared";

const SendTimesheetPanel = dynamic(() => import("@/chain/work/SendTimesheet"), {
  ssr: false,
  loading: () => <p className="text-sm text-muted-foreground">Loading…</p>,
});

export function SendWeek({ agreementId, weekStart, now }: { agreementId: string; weekStart: string; now: Date }) {
  const { work } = useWork();
  const [open, setOpen] = useState(false);
  const agreement = work.agreements.find((a) => a.agreementId === agreementId);
  if (!agreement || agreement.status !== "active") return null;
  const minutes = sendableMinutes(work, agreementId, weekStart, now); // closed shifts: what the timecard carries
  const counted = weekMinutes(work.punches, agreementId, weekStart, now, calendarOf(agreement).timeZone, longestMinutesOf(agreement));
  const sent = sentWeek(work, agreementId, weekStart);
  // A long shift not yet confirmed holds the timecard back.
  const problem = minutes > 0 ? sendProblem(work, agreementId, weekStart, now) : null;
  return (
    <div className="flex flex-col gap-2">
      {open ? (
        <SendTimesheetPanel agreementId={agreementId} weekStart={weekStart} onClose={() => setOpen(false)} />
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <Button className="min-h-11 sm:min-h-9" disabled={minutes === 0 || problem !== null} onClick={() => setOpen(true)}>
            <Send aria-hidden />
            {sent ? "Update weekly timecard" : `Send weekly timecard to ${employerLabel(agreement)}`}
          </Button>
          {problem ? (
            <span className="text-xs text-warning" role="status">
              {problem}
            </span>
          ) : sent ? (
            <span className="text-xs text-muted-foreground">
              Sent {when(sent.sentAt)} · {formatMinutes(sent.totalMinutes)}
              {sent.receivedAt ? ` · Received ${when(sent.receivedAt)}` : " · Not picked up yet"}
            </span>
          ) : minutes === 0 && counted > 0 ? (
            <span className="text-xs text-muted-foreground">A shift goes on the timecard once you&apos;ve clocked out.</span>
          ) : (
            minutes === 0 && <span className="text-xs text-muted-foreground">Nothing to send yet this week.</span>
          )}
        </div>
      )}
    </div>
  );
}
