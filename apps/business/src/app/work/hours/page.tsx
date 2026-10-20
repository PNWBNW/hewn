"use client";

// Hours: the week's punches by day, each one editable or removable with a
// confirm until it has been sent (then it is confirmed and the employer's to
// change), the weekly total, and the weekly timecard to the employer. Earlier
// weeks are a tap away. A shift longer than the work week's longest shift is marked: an
// open one stops counting there; a closed one is confirmed ("It's right")
// or its clock-out fixed before the week can be sent. Everything here is the
// vault; nothing leaves the device until the person taps Send.
//
// Changing hours takes both sides (books/hours_change.ts): before a shift is
// sent the person can "Ask for a revision" (the employer accepts or declines);
// the employer can question a sent shift, and the person agrees or keeps it
// as sent. An edit made here before sending shows to the employer, with what
// the shift was. Answers arrive with the person's messages, read when the
// page opens and on "Check now".

import { useCallback, useState } from "react";
import dynamic from "next/dynamic";
import { ChevronLeft, ChevronRight, Lock, Pencil, RefreshCw, Trash2 } from "lucide-react";
import { Button } from "@pnw/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@pnw/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@pnw/ui/dialog";
import { cn } from "@pnw/ui/utils";
import { Field, FormError, errorMessage, inputClass } from "@/books/AuthCard";
import { useWork } from "@/books/BooksProvider";
import { addDays, calendarOf, formatMinutes, localDate, longestMinutesOf, overtimeSplit, weekDays, weekMinutes, weekShifts, weekStartOf } from "@/books/hours";
import { type HoursChange, type Stretch, changeFor, hoursChanges } from "@/books/hours_change";
import { type Punch, confirmShift, removePunch, updatePunch, workThread } from "@/books/work";
import { payRulesOf } from "@/books/work_week";
import { PageHeader } from "@/shell/SectionView";
import { SendWeek } from "../SendWeek";
import { clock, dayLabel, employerLabel, useNow } from "../shared";

const loading = () => <p className="text-sm text-muted-foreground">Loading…</p>;
const MessagesCheck = dynamic(() => import("@/chain/work/MessagesCheck"), { ssr: false });
const WorkHoursChange = dynamic(() => import("@/chain/work/HoursChange"), { ssr: false, loading });

type Changing = { key: string; mode: { kind: "ask"; agreementId: string; shift: Stretch; timeZone: string } | { kind: "answer"; changeId: string; answer: "accepted" | "declined"; proposed?: Stretch } };

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
  const agreement = agreements.find((a) => a.agreementId === agreementId);
  // Days and weeks on the agreement's calendar (the work week in its terms; Sunday to Saturday in this device's zone without one).
  const calendar = calendarOf(agreement);
  const tz = calendar.timeZone;
  const longest = longestMinutesOf(agreement);
  const longestLabel = formatMinutes(longest).replace(/ 00m$/, "");
  const today = localDate(now, tz);
  const thisWeek = weekStartOf(today, calendar);
  const [chosenWeek, setWeekStart] = useState(thisWeek);
  const weekStart = weekStartOf(chosenWeek, calendar); // the chosen week, realigned should the agreement (and its calendar) change
  const [editing, setEditing] = useState<Punch | null>(null);
  const [removing, setRemoving] = useState<Punch | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [changing, setChanging] = useState<Changing | null>(null);
  const [run, setRun] = useState<number | null>(agreements.length > 0 ? 0 : null);
  const [checked, setChecked] = useState<string | null>(null);
  const finished = useCallback((message: string | null) => {
    setRun(null);
    setChecked(message ?? "Up to date.");
  }, []);
  // Changes to hours with this employer, both ways (books/hours_change.ts).
  const changes = agreement ? hoursChanges(workThread(work, agreement.partiesKey)) : [];

  const shifts = agreementId ? weekShifts(work, agreementId, weekStart, now) : [];
  const byDay = new Map<string, typeof shifts>();
  for (const s of shifts) byDay.set(s.date, [...(byDay.get(s.date) ?? []), s]);
  const punchById = new Map(work.punches.map((p) => [p.id, p]));
  const outPunchFor = (id: string | undefined) => (id ? punchById.get(id) : undefined);
  const total = agreementId ? weekMinutes(work.punches, agreementId, weekStart, now, tz, longest) : 0;
  const weekLabel = `${dayLabel(weekStart)} – ${dayLabel(addDays(weekStart, 6))}`;
  // Overtime under the agreement's work week, over this week's shifts (the same split the employer makes).
  const workWeek = agreement?.terms?.version === 2 ? agreement.terms.workWeek : undefined;
  // Without a work week in the terms: the baseline, time and a half after 40 a week (books/work_week.ts payRulesOf).
  const rules = payRulesOf(workWeek, tz);
  const split = overtimeSplit(shifts, rules);
  const anySent = shifts.some((s) => s.sent);

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
      <PageHeader title="Hours" summary="Your punches by day. Update the weekly timecard whenever you've clocked out." />
      {agreements.length > 0 && (
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-xs text-muted-foreground" role="status" aria-live="polite">
            {run !== null ? "Checking for answers from your employer…" : checked}
          </span>
          {run === null && (
            <Button variant="outline" size="sm" className="min-h-11 sm:min-h-8" onClick={() => setRun(Date.now())}>
              <RefreshCw aria-hidden />
              Check now
            </Button>
          )}
          {run !== null && <MessagesCheck key={run} onFinished={finished} />}
        </div>
      )}

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
                        <span className={cn("font-medium", date === today && "text-primary")}>{dayLabel(date)}</span>
                        <span className="tabular-nums text-muted-foreground">{minutes > 0 ? formatMinutes(minutes) : "—"}</span>
                      </div>
                      {day.map((s) => {
                        const inPunch = punchById.get(s.inId);
                        const outPunch = s.outId ? punchById.get(s.outId) : undefined;
                        // The whole shift (a shift past midnight shows on both days; its changes show on the first).
                        const whole = inPunch && outPunch ? { in: new Date(inPunch.at).toISOString(), out: new Date(outPunch.at).toISOString() } : undefined;
                        const firstDay = !!whole && s.in === whole.in;
                        const hc = whole && firstDay ? changeFor(changes, agreementId, whole) : undefined;
                        const key = `${s.inId}:${s.in}`;
                        return (
                          <div key={key} className="mt-1 flex flex-col gap-1 pl-3 text-xs text-muted-foreground">
                            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                              <span className="tabular-nums">
                                {clock(s.in, tz)} – {s.open ? "now" : clock(s.out, tz)}
                                {s.open && s.long && ` (still clocked in, longer than ${longestLabel}: counted to there; set the clock-out time)`}
                                {s.open && !s.long && s.out !== now.toISOString() && new Date(s.out) < now && " (not clocked out; counted to midnight)"}
                              </span>
                              {s.callout && <span className="rounded-sm bg-primary/15 px-1.5 py-0.5 font-medium text-primary">Callout</span>}
                              {!s.open && s.long && (
                                <span className={cn("rounded-sm px-1.5 py-0.5", s.confirmed ? "bg-muted" : "bg-warning/15 text-warning")}>
                                  {s.confirmed ? `Longer than ${longestLabel} · confirmed` : `Longer than ${longestLabel}`}
                                </span>
                              )}
                              {!s.open && s.long && !s.confirmed && outPunchFor(s.outId) && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="min-h-11 sm:min-h-7"
                                  onClick={() => void change((w) => confirmShift(w, s.outId!))}
                                >
                                  It&apos;s right
                                </Button>
                              )}
                              {s.sent ? (
                                <span className="flex items-center gap-1" title="Sent: confirmed, and the employer's to change">
                                  <Lock aria-hidden className="size-3" />
                                  Sent
                                </span>
                              ) : (
                                <span className="flex gap-1">
                                  {inPunch && <PunchButton icon={Pencil} label={`Edit clock-in at ${clock(inPunch.at)}`} onClick={() => setEditing(inPunch)} />}
                                  {outPunch && <PunchButton icon={Pencil} label={`Edit clock-out at ${clock(outPunch.at)}`} onClick={() => setEditing(outPunch)} />}
                                  {inPunch && <PunchButton icon={Trash2} label={`Remove shift from ${clock(s.in)}`} onClick={() => setRemoving(inPunch)} />}
                                </span>
                              )}
                              {whole && firstDay && !s.sent && !(hc && !hc.answer) && changing?.key !== key && agreement && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="min-h-11 sm:min-h-7"
                                  onClick={() => setChanging({ key, mode: { kind: "ask", agreementId, shift: whole, timeZone: tz } })}
                                >
                                  Ask for a revision
                                </Button>
                              )}
                            </div>
                            {firstDay && s.was && s.change && (
                              <p>
                                {s.change === "edited"
                                  ? `Edited; your employer will see it was ${clock(s.was.in, tz)} – ${clock(s.was.out, tz)}.`
                                  : `Changed as you and your employer agreed; it was ${clock(s.was.in, tz)} – ${clock(s.was.out, tz)}.`}
                              </p>
                            )}
                            {hc && (
                              <ChangeStatus
                                change={hc}
                                employer={agreement ? employerLabel(agreement) : "Your employer"}
                                tz={tz}
                                onAnswer={(answer) =>
                                  setChanging({ key, mode: { kind: "answer", changeId: hc.id, answer, ...(hc.body.proposed ? { proposed: hc.body.proposed } : {}) } })
                                }
                                answering={changing?.key === key}
                              />
                            )}
                            {changing?.key === key && agreement && (
                              <WorkHoursChange
                                partiesKey={agreement.partiesKey}
                                employerAddress={agreement.employerAddress}
                                employer={employerLabel(agreement)}
                                mode={changing.mode}
                                onClose={() => setChanging(null)}
                              />
                            )}
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
              {split && split.overtime > 0 && (
                <div className="-mt-3 flex items-baseline justify-between text-xs text-muted-foreground">
                  <span>Regular {formatMinutes(split.regular)}</span>
                  <span className="tabular-nums">
                    Overtime {formatMinutes(split.overtime)} at {rules.overtimeRate}×
                  </span>
                </div>
              )}
              {anySent && <p className="text-xs text-muted-foreground">A shift marked Sent is on the employer&apos;s timecard: confirmed by you, and theirs to change.</p>}
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

/** Where a change to one shift stands, and the answer buttons when the employer asked. */
function ChangeStatus({ change, employer, tz, onAnswer, answering }: { change: HoursChange; employer: string; tz: string; onAnswer: (a: "accepted" | "declined") => void; answering: boolean }) {
  const p = change.body.proposed;
  const times = p ? `${clock(p.in, tz)} – ${clock(p.out, tz)}` : "";
  if (change.from === "worker") {
    if (!change.answer) return <p>You asked for a revision{times && ` to ${times}`}: waiting for {employer}.</p>;
    return change.answer.answer === "accepted" ? (
      <p className="text-money-positive">{employer} accepted your revision.</p>
    ) : (
      <p>
        {employer} kept it as it was: {change.answer.note}
      </p>
    );
  }
  if (change.answer) {
    return <p>{change.answer.answer === "accepted" ? `You agreed with ${employer}${times && `: changed to ${times}`}.` : `You kept it as sent: ${change.answer.note}`}</p>;
  }
  return (
    <div className="flex flex-col gap-2 rounded-md border border-warning/40 bg-warning/10 p-2 text-foreground">
      <p>
        {employer} asked about this shift{times && `, suggesting ${times}`}: “{change.body.note}”
      </p>
      {!answering && (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" className="min-h-11 sm:min-h-7" onClick={() => onAnswer("accepted")}>
            Agree
          </Button>
          <Button variant="outline" size="sm" className="min-h-11 sm:min-h-7" onClick={() => onAnswer("declined")}>
            Keep as sent
          </Button>
        </div>
      )}
    </div>
  );
}
