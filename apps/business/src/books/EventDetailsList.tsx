"use client";

// What, when and where of an event, the same on every view: a personal event
// (EventPanel.tsx), one with guests and an invitation (SharedEventViews.tsx).

import { CalendarDays, Clock, ExternalLink, MapPin } from "lucide-react";
import type { EventDetails } from "./events";
import { overnight, timeLabel } from "./schedule";

const longDay = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });

/** "Wednesday, October 22, 2026 · 9:00 AM – 10:00 AM", or the days an all-day event covers. */
export function eventWhen(e: EventDetails): string {
  if (e.allDay) return e.endDate && e.endDate !== e.date ? `${longDay(e.date)} – ${longDay(e.endDate)}` : `${longDay(e.date)} · all day`;
  return `${longDay(e.date)} · ${timeLabel(e.start!)} – ${timeLabel(e.end!)}${overnight({ start: e.start!, end: e.end! }) ? " (next day)" : ""}`;
}

/** What, when and where: the same list for a personal event, one with guests, and an invitation. */
export function EventDetailsList({ details }: { details: EventDetails }) {
  return (
    <dl className="mt-2 flex flex-col gap-3 text-sm">
      <div className="flex gap-2">
        <dt className="sr-only">When</dt>
        {details.allDay ? <CalendarDays aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" /> : <Clock aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />}
        <dd>{eventWhen(details)}</dd>
      </div>
      {details.place && (
        <div className="flex gap-2">
          <dt className="sr-only">Where</dt>
          <MapPin aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <dd className="whitespace-pre-wrap break-words">{details.place}</dd>
        </div>
      )}
      {details.link && (
        <div className="flex gap-2">
          <dt className="sr-only">Meeting link</dt>
          <ExternalLink aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <dd className="min-w-0">
            <a href={details.link} target="_blank" rel="noopener noreferrer" className="break-all font-medium text-primary underline underline-offset-4">
              {new URL(details.link).hostname}
            </a>
          </dd>
        </div>
      )}
      {details.notes && (
        <div>
          <dt className="text-xs text-muted-foreground">Notes</dt>
          <dd className="mt-1 whitespace-pre-wrap break-words">{details.notes}</dd>
        </div>
      )}
    </dl>
  );
}
