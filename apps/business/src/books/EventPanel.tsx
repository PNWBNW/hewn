"use client";

// One event, in a pop-up, on either side. A personal one (books/events.ts):
// its details with Edit and Delete, or the form for a new one or a change,
// saved straight into the encrypted books and sent nowhere. With guests
// picked in the form, it becomes an event with guests (books/shared_events.ts):
// saved the same way, and sent only when the organizer sends it
// (SharedEventViews.tsx has its view, and an invitation's).

import { useEffect, useState } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { Button } from "@pnw/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@pnw/ui/dialog";
import { Field, FormError, errorMessage, inputClass } from "./AuthCard";
import { useOpenBooks } from "./BooksProvider";
import {
  type EventDetails,
  type EventDraft,
  MAX_EVENT_LINK,
  MAX_EVENT_NOTES,
  MAX_EVENT_PLACE,
  MAX_EVENT_TITLE,
  type PersonalEvent,
  deleteEvent,
  draftOf,
  emptyDraft,
  detailsFromDraft,
  eventFromDraft,
  saveEvent,
} from "./events";
import { EventDetailsList } from "./EventDetailsList";
import {
  type CalendarEvent,
  type Guest,
  type HostedEvent,
  MAX_SHARED_NOTES,
  contactRef,
  editHosted,
  emptyCalendar,
  newHosted,
  putHosted,
} from "./shared_events";
import { HostedView, InviteView } from "./SharedEventViews";

/** What the panel shows: a new event on a day, a personal one, one this account organizes (by id), or an invitation (by its key). */
export type EventPanelState =
  | { kind: "new"; date: string }
  | { kind: "view"; event: PersonalEvent }
  | { kind: "hosted"; id: string }
  | { kind: "invite"; key: string }
  | null;

/** Who this page can invite, and the circle they're invited under ("" for a business, the job's parties key for a person). */
export type Invitable = { scope: string; guests: Guest[] };

/** The panel state that opens something drawn on the calendar. */
export function panelFor(e: CalendarEvent, personal: readonly PersonalEvent[]): EventPanelState {
  if (e.kind === "hosting") return { kind: "hosted", id: e.id.slice(2) };
  if (e.kind === "invited") return { kind: "invite", key: e.id.slice(2) };
  const found = personal.find((p) => p.id === e.id);
  return found ? { kind: "view", event: found } : null;
}

export function EventPanel({ state, onClose, invitable }: { state: EventPanelState; onClose: () => void; invitable?: Invitable }) {
  const { calendar } = useOpenBooks();
  // What it shows can move on inside the pop-up (saving an event with guests opens it, ready to send).
  const [shown, setShown] = useState<EventPanelState>(state);
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    setShown(state);
    setEditing(state?.kind === "new");
  }, [state]);
  const hosted = shown?.kind === "hosted" ? calendar?.hosted.find((e) => e.id === shown.id) : undefined;
  const body = (() => {
    if (!shown) return null;
    if (editing && shown.kind !== "invite") {
      return (
        <EventForm
          state={shown}
          hosted={hosted}
          invitable={invitable}
          onSaved={(next) => {
            setEditing(false);
            if (next) setShown(next);
            else onClose();
          }}
          onCancel={() => (shown.kind === "new" ? onClose() : setEditing(false))}
        />
      );
    }
    if (shown.kind === "view") return <EventView event={shown.event} onEdit={() => setEditing(true)} onDone={onClose} />;
    if (shown.kind === "hosted") return <HostedView id={shown.id} onEdit={() => setEditing(true)} onDone={onClose} />;
    if (shown.kind === "invite") return <InviteView inviteKey={shown.key} onDone={onClose} />;
    return null;
  })();
  return (
    <Dialog open={state !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">{body}</DialogContent>
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
      <EventDetailsList details={event} />
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

function EventForm({
  state,
  hosted,
  invitable,
  onSaved,
  onCancel,
}: {
  state: NonNullable<EventPanelState>;
  hosted: HostedEvent | undefined;
  invitable: Invitable | undefined;
  onSaved: (next: EventPanelState) => void;
  onCancel: () => void;
}) {
  const { updateCompany } = useOpenBooks();
  const existing = state.kind === "view" ? state.event : undefined;
  const [draft, setDraft] = useState<EventDraft>(() => (hosted ? draftOf(hosted.details) : existing ? draftOf(existing) : emptyDraft(state.kind === "new" ? state.date : "")));
  // Who can be invited: the page's list, plus anyone already on this event who isn't on it any more (they stay until taken off).
  const choices = [...(invitable?.guests ?? []), ...(hosted?.guests ?? []).filter((g) => !(invitable?.guests ?? []).some((c) => contactRef(c.contact) === contactRef(g.contact)))];
  const [picked, setPicked] = useState<Set<string>>(() => new Set((hosted?.guests ?? []).map((g) => contactRef(g.contact))));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof EventDraft>(k: K, v: EventDraft[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const shared = picked.size > 0 || !!hosted;
  const toggle = (ref: string) =>
    setPicked((p) => {
      const next = new Set(p);
      if (next.has(ref)) next.delete(ref);
      else next.add(ref);
      return next;
    });

  async function save() {
    setError(null);
    const guests = choices.filter((g) => picked.has(contactRef(g.contact)));
    if (hosted && guests.length === 0) {
      setError("An event with guests keeps at least one. To call it off, use Cancel event.");
      return;
    }
    if (guests.length === 0) {
      const r = eventFromDraft(draft, existing);
      if ("problem" in r) {
        setError(r.problem);
        return;
      }
      setBusy(true);
      try {
        await updateCompany((c) => ({ ...c, events: saveEvent(c.events ?? [], r.event) }));
        onSaved(null);
      } catch (e) {
        setError(errorMessage(e));
        setBusy(false);
      }
      return;
    }
    const r = detailsFromDraft(draft, MAX_SHARED_NOTES);
    if ("problem" in r) {
      setError(r.problem);
      return;
    }
    setBusy(true);
    try {
      const event = hosted ? editHosted(hosted, r.details, guests) : newHosted(invitable?.scope ?? "", r.details, guests);
      // A personal event that gains guests becomes one with guests.
      await updateCompany((c) => ({ ...c, calendar: putHosted(c.calendar ?? emptyCalendar(), event), ...(existing ? { events: deleteEvent(c.events ?? [], existing.id) } : {}) }));
      onSaved({ kind: "hosted", id: event.id });
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
        <DialogTitle>{hosted || existing ? "Edit event" : "New event"}</DialogTitle>
        <DialogDescription>
          {shared
            ? "Kept in your encrypted books. Your guests get it as a sealed letter when you send it; nothing goes out until then."
            : "A personal event, kept in your encrypted books. Only you see it."}
        </DialogDescription>
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
      <Field label="Notes (optional)" hint={shared ? `Up to ${MAX_SHARED_NOTES} characters with guests: it travels in a letter.` : undefined}>
        <textarea
          className={`${inputClass} h-auto min-h-20 py-2`}
          rows={3}
          maxLength={shared ? MAX_SHARED_NOTES : MAX_EVENT_NOTES}
          value={draft.notes}
          onChange={(e) => set("notes", e.target.value)}
        />
      </Field>
      {choices.length > 0 && (
        <fieldset className="flex flex-col gap-1">
          <legend className="text-sm font-medium">Invite (optional)</legend>
          <p className="text-xs text-muted-foreground">Everyone you invite sees who else is invited.</p>
          <div className="mt-1 grid gap-x-4 sm:grid-cols-2">
            {choices.map((g) => {
              const ref = contactRef(g.contact);
              return (
                <label key={ref} className="flex min-h-11 items-center gap-2 text-sm sm:min-h-8">
                  <input type="checkbox" className="size-4 accent-[var(--hewn-green)]" checked={picked.has(ref)} onChange={() => toggle(ref)} />
                  <span className="truncate">{g.name}</span>
                </label>
              );
            })}
          </div>
        </fieldset>
      )}
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
