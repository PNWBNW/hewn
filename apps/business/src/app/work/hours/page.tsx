"use client";

// Hours: the week's punches by day, each one editable or removable with a
// confirm, the weekly total, and Send to the employer. Earlier weeks are a
// tap away. Everything here is the vault; nothing leaves the device until
// the person taps Send.

import { useState } from "react";
import { ChevronLeft, ChevronRight, Pencil, Trash2 } from "lucide-react";
import { Button } from "@pnw/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@pnw/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@pnw/ui/dialog";
import { cn } from "@pnw/ui/utils";
import { Field, FormError, errorMessage, inputClass } from "@/books/AuthCard";
import { useWork } from "@/books/BooksProvider";
import { addDays, formatMinutes, localDate, shiftsOf, weekDays, weekMinutes, weekStartOf } from "@/books/hours";
import { type Punch, removePunch, updatePunch } from "@/books/work";
import { PageHeader } from "@/shell/SectionView";
import { SendWeek } from "../SendWeek";
import { clock, dayLabel, employerLabel, useNow } from "../shared";

/** A local datetime-local value ("2026-10-14T09:30") from an ISO instant, and back. */
const toLocalInput = (iso: string) => {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const fromLocalInput = (v: string) => new Date(v).toISOString();

export default function HoursPage() {
  const { work, updateWork } = useWork();
  const now = useNow(30_000);
  const agreements = work.agreements.filter((a) => a.status !== "pending");
  const [chosen, setChosen] = useState("");
  const agreementId = agreements.some((a) => a.agreementId === chosen) ? chosen : (agreements[0]?.agreementId ?? "");
  const thisWeek = weekStartOf(localDate(now));
  const [weekStart, setWeekStart] = useState(thisWeek);
  const [editing, setEditing] = useState<Punch | null>(null);
  const [removing, setRemoving] = useState<Punch | null>(null);
  const [error, setError] = useState<string | null>(null);

  const shifts = agreementId ? shiftsOf(work.punches, agreementId, now) : [];
  const byDay = new Map<string, typeof shifts>();
  for (const s of shifts) byDay.set(s.date, [...(byDay.get(s.date) ?? []), s]);
  const punchById = new Map(work.punches.map((p) => [p.id, p]));
  const total = agreementId ? weekMinutes(work.punches, agreementId, weekStart, now) : 0;
  const weekLabel = `${dayLabel(weekStart)} – ${dayLabel(addDays(weekStart, 6))}`;

  async function change(op: (w: typeof work) => typeof work) {
    setError(null);
    try {
      await updateWork(op);
      return true;
    } catch (e) {
      setError(errorMessage(e));
      return false;
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Hours" summary="Your punches by day. Send the week when it's done." />

      {agreements.length === 0 ? (
        <p className="text-sm text-muted-foreground">Accept an offer first; your hours for that employer will show here.</p>
      ) : (
        <>
          {agreements.length > 1 && (
            <label className="text-sm">
              <span className="text-xs text-muted-foreground">Employer</span>
              <select className={cn(inputClass, "mt-1 sm:w-72")} value={agreementId} onChange={(e) => setChosen(e.target.value)}>
                {agreements.map((a) => (
                  <option key={a.agreementId} value={a.agreementId}>
                    {employerLabel(a)}
                  </option>
                ))}
              </select>
            </label>
          )}

          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2">
              <Button variant="ghost" size="sm" className="min-h-11 sm:min-h-8" aria-label="Earlier week" onClick={() => setWeekStart(addDays(weekStart, -7))}>
                <ChevronLeft aria-hidden className="size-4" />
              </Button>
              <CardTitle className="text-center text-sm font-medium">
                {weekLabel}
                {weekStart === thisWeek && <span className="block text-xs font-normal text-muted-foreground">This week</span>}
              </CardTitle>
              <Button
                variant="ghost"
                size="sm"
                className="min-h-11 sm:min-h-8"
                aria-label="Later week"
                disabled={weekStart === thisWeek}
                onClick={() => setWeekStart(addDays(weekStart, 7))}
              >
                <ChevronRight aria-hidden className="size-4" />
              </Button>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <ul className="divide-y">
                {weekDays(weekStart).map((date) => {
                  const day = byDay.get(date) ?? [];
                  const minutes = day.reduce((t, s) => t + s.minutes, 0);
                  return (
                    <li key={date} className="py-2">
                      <div className="flex items-baseline justify-between text-sm">
                        <span className={cn("font-medium", date === localDate(now) && "text-primary")}>{dayLabel(date)}</span>
                        <span className="tabular-nums text-muted-foreground">{minutes > 0 ? formatMinutes(minutes) : "—"}</span>
                      </div>
                      {day.map((s) => {
                        const inPunch = punchById.get(s.inId);
                        const outPunch = s.outId ? punchById.get(s.outId) : undefined;
                        return (
                          <div key={`${s.inId}:${s.in}`} className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 pl-3 text-xs text-muted-foreground">
                            <span className="tabular-nums">
                              {clock(s.in)} – {s.open ? "now" : clock(s.out)}
                              {s.open && s.out !== now.toISOString() && new Date(s.out) < now && " (not clocked out; counted to midnight)"}
                            </span>
                            <span className="flex gap-1">
                              {inPunch && <PunchButton icon={Pencil} label={`Edit clock-in at ${clock(inPunch.at)}`} onClick={() => setEditing(inPunch)} />}
                              {outPunch && <PunchButton icon={Pencil} label={`Edit clock-out at ${clock(outPunch.at)}`} onClick={() => setEditing(outPunch)} />}
                              {inPunch && <PunchButton icon={Trash2} label={`Remove shift from ${clock(s.in)}`} onClick={() => setRemoving(inPunch)} />}
                            </span>
                          </div>
                        );
                      })}
                    </li>
                  );
                })}
              </ul>
              <div className="flex items-baseline justify-between border-t pt-3 text-sm">
                <span className="font-medium">Week total</span>
                <span className="font-semibold tabular-nums">{formatMinutes(total)}</span>
              </div>
              <FormError message={error} />
              <SendWeek agreementId={agreementId} weekStart={weekStart} now={now} />
            </CardContent>
          </Card>
        </>
      )}

      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          {editing && (
            <form
              className="flex flex-col gap-4"
              onSubmit={async (e) => {
                e.preventDefault();
                const at = (new FormData(e.currentTarget).get("at") as string) || "";
                if (await change((w) => updatePunch(w, editing.id, { at: fromLocalInput(at) }))) setEditing(null);
              }}
            >
              <DialogHeader>
                <DialogTitle>{editing.kind === "in" ? "Clock-in time" : "Clock-out time"}</DialogTitle>
                <DialogDescription>Shifts can&apos;t overlap, and a clock-out comes after its clock-in.</DialogDescription>
              </DialogHeader>
              <Field label="Time">
                <input className={inputClass} type="datetime-local" name="at" defaultValue={toLocalInput(editing.at)} required />
              </Field>
              <DialogFooter className="gap-2">
                <Button type="button" variant="outline" className="min-h-11 sm:min-h-9" onClick={() => setEditing(null)}>
                  Cancel
                </Button>
                <Button type="submit" className="min-h-11 sm:min-h-9">
                  Save
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={removing !== null} onOpenChange={(o) => !o && setRemoving(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove this shift?</DialogTitle>
            <DialogDescription>{removing && `The clock-in at ${clock(removing.at)} and its clock-out come off your hours. This can't be undone.`}</DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-4 gap-2">
            <Button variant="outline" className="min-h-11 sm:min-h-9" onClick={() => setRemoving(null)}>
              Keep it
            </Button>
            <Button
              variant="destructive"
              className="min-h-11 sm:min-h-9"
              onClick={async () => {
                if (removing && (await change((w) => removePunch(w, removing.id)))) setRemoving(null);
              }}
            >
              Remove
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function PunchButton({ icon: Icon, label, onClick }: { icon: typeof Pencil; label: string; onClick: () => void }) {
  return (
    <button type="button" className="grid size-8 place-items-center rounded-md hover:bg-accent" aria-label={label} onClick={onClick}>
      <Icon aria-hidden className="size-3.5" />
    </button>
  );
}
