"use client";

// One personal event (books/events.ts), in a pop-up: its details with Edit
// and Delete, or the form for a new one or a change. Saved straight into the
// encrypted books; nothing is sent anywhere. Both sides use it.

import { useEffect, useState } from "react";
import { CalendarDays, Clock, ExternalLink, MapPin, Pencil, Trash2 } from "lucide-react";
import { Button } from "@pnw/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@pnw/ui/dialog";
import { Field, FormError, errorMessage, inputClass } from "./AuthCard";
import { useOpenBooks } from "./BooksProvider";
import {
  type EventDraft,
  MAX_EVENT_LINK,
  MAX_EVENT_NOTES,
  MAX_EVENT_PLACE,
  MAX_EVENT_TITLE,
  type PersonalEvent,
  deleteEvent,
  draftOf,
  emptyDraft,
  eventFromDraft,
  saveEvent,
} from "./events";
import { overnight, timeLabel } from "./schedule";

/** What the panel shows: a new event on a day, or one that exists. */
export type EventPanelState = { kind: "new"; date: string } | { kind: "view"; event: PersonalEvent } | null;

const longDay = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });

/** "Wednesday, October 22, 2026 · 9:00 AM – 10:00 AM", or the days an all-day event covers. */
export function eventWhen(e: PersonalEvent): string {
  if (e.allDay) return e.endDate && e.endDate !== e.date ? `${longDay(e.date)} – ${longDay(e.endDate)}` : `${longDay(e.date)} · all day`;
  return `${longDay(e.date)} · ${timeLabel(e.start!)} – ${timeLabel(e.end!)}${overnight({ start: e.start!, end: e.end! }) ? " (next day)" : ""}`;
}

export function EventPanel({ state, onClose }: { state: EventPanelState; onClose: () => void }) {
  const [editing, setEditing] = useState(false);
  useEffect(() => setEditing(state?.kind === "new"), [state]);
  return (
    <Dialog open={state !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        {state && (editing ? <EventForm state={state} onDone={onClose} onCancel={() => (state.kind === "new" ? onClose() : setEditing(false))} /> : state.kind === "view" && <EventView event={state.event} onEdit={() => setEditing(true)} onDone={onClose} />)}
      </DialogContent>
    </Dialog>
  );
}

function EventView({ event, onEdit, onDone }: { event: PersonalEvent; onEdit: () => void; onDone: () => void }) {
  const { updateCompany } = useOpenBooks();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    setError(null);
    try {
      await updateCompany((c) => ({ ...c, events: deleteEvent(c.events ?? [], event.id) }));
      onDone();
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  return (
    <>
      <DialogHeader className="pr-10 text-left">
        <DialogTitle>{event.title}</DialogTitle>
        <DialogDescription>Personal event: only you see it.</DialogDescription>
      </DialogHeader>
      <dl className="mt-2 flex flex-col gap-3 text-sm">
        <div className="flex gap-2">
          <dt className="sr-only">When</dt>
          {event.allDay ? <CalendarDays aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" /> : <Clock aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />}
          <dd>{eventWhen(event)}</dd>
        </div>
        {event.place && (
          <div className="flex gap-2">
            <dt className="sr-only">Where</dt>
            <MapPin aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <dd className="whitespace-pre-wrap break-words">{event.place}</dd>
          </div>
        )}
        {event.link && (
          <div className="flex gap-2">
            <dt className="sr-only">Meeting link</dt>
            <ExternalLink aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <dd className="min-w-0">
              <a href={event.link} target="_blank" rel="noopener noreferrer" className="break-all font-medium text-primary underline underline-offset-4">
                {new URL(event.link).hostname}
              </a>
            </dd>
          </div>
        )}
        {event.notes && (
          <div>
            <dt className="text-xs text-muted-foreground">Notes</dt>
            <dd className="mt-1 whitespace-pre-wrap break-words">{event.notes}</dd>
          </div>
        )}
      </dl>
      <FormError message={error} />
      <DialogFooter className="mt-4 gap-2">
        {confirming ? (
          <>
            <Button variant="outline" className="min-h-11 sm:min-h-9" onClick={() => setConfirming(false)}>
              Keep it
            </Button>
            <Button variant="destructive" className="min-h-11 sm:min-h-9" onClick={() => void remove()}>
              Delete the event
            </Button>
          </>
        ) : (
          <>
            <Button variant="outline" className="min-h-11 sm:min-h-9" onClick={() => setConfirming(true)}>
              <Trash2 aria-hidden />
              Delete
            </Button>
            <Button className="min-h-11 sm:min-h-9" onClick={onEdit}>
              <Pencil aria-hidden />
              Edit
            </Button>
          </>
        )}
      </DialogFooter>
    </>
  );
}

function EventForm({ state, onDone, onCancel }: { state: NonNullable<EventPanelState>; onDone: () => void; onCancel: () => void }) {
  const { updateCompany } = useOpenBooks();
  const existing = state.kind === "view" ? state.event : undefined;
  const [draft, setDraft] = useState<EventDraft>(() => (existing ? draftOf(existing) : emptyDraft(state.kind === "new" ? state.date : "")));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof EventDraft>(k: K, v: EventDraft[K]) => setDraft((d) => ({ ...d, [k]: v }));

  async function save() {
    setError(null);
    const r = eventFromDraft(draft, existing);
    if ("problem" in r) {
      setError(r.problem);
      return;
    }
    setBusy(true);
    try {
      await updateCompany((c) => ({ ...c, events: saveEvent(c.events ?? [], r.event) }));
      onDone();
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <DialogHeader className="pr-10 text-left">
        <DialogTitle>{existing ? "Edit event" : "New event"}</DialogTitle>
        <DialogDescription>A personal event, kept in your encrypted books. Only you see it.</DialogDescription>
      </DialogHeader>
      <Field label="Title">
        <input className={inputClass} value={draft.title} maxLength={MAX_EVENT_TITLE} onChange={(e) => set("title", e.target.value)} placeholder="Site meeting" autoFocus required />
      </Field>
      <label className="flex min-h-11 items-center gap-2 text-sm sm:min-h-8">
        <input type="checkbox" className="size-4 accent-[var(--hewn-green)]" checked={draft.allDay} onChange={(e) => set("allDay", e.target.checked)} />
        All day
      </label>
      {draft.allDay ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="First day">
            <input
              className={inputClass}
              type="date"
              value={draft.date}
              onChange={(e) => setDraft((d) => ({ ...d, date: e.target.value, endDate: d.endDate < e.target.value ? e.target.value : d.endDate }))}
              required
            />
          </Field>
          <Field label="Last day">
            <input className={inputClass} type="date" value={draft.endDate} min={draft.date} onChange={(e) => set("endDate", e.target.value)} required />
          </Field>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Day">
            <input className={inputClass} type="date" value={draft.date} onChange={(e) => set("date", e.target.value)} required />
          </Field>
          <Field label="Starts">
            <input className={inputClass} type="time" value={draft.start} onChange={(e) => set("start", e.target.value)} required />
          </Field>
          <Field label="Ends" hint={draft.end && draft.start && draft.end <= draft.start ? "The next day" : undefined}>
            <input className={inputClass} type="time" value={draft.end} onChange={(e) => set("end", e.target.value)} required />
          </Field>
        </div>
      )}
      <Field label="Where (optional)">
        <input className={inputClass} value={draft.place} maxLength={MAX_EVENT_PLACE} onChange={(e) => set("place", e.target.value)} placeholder="1420 Elm St, or the office" />
      </Field>
      <Field label="Meeting link (optional)" hint="An https:// address, like a Zoom, Meet or Teams link.">
        <input className={inputClass} type="url" inputMode="url" value={draft.link} maxLength={MAX_EVENT_LINK} onChange={(e) => set("link", e.target.value)} placeholder="https://" />
      </Field>
      <Field label="Notes (optional)">
        <textarea className={`${inputClass} h-auto min-h-20 py-2`} rows={3} maxLength={MAX_EVENT_NOTES} value={draft.notes} onChange={(e) => set("notes", e.target.value)} />
      </Field>
      <FormError message={error} />
      <DialogFooter className="gap-2">
        <Button type="button" variant="outline" className="min-h-11 sm:min-h-9" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" className="min-h-11 sm:min-h-9" disabled={busy || !draft.title.trim()}>
          {busy ? "Saving…" : "Save"}
        </Button>
      </DialogFooter>
    </form>
  );
}
