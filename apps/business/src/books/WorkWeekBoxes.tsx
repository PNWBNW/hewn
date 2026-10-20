"use client";

// The work week's boxes in an offer form (books/work_week.ts): the day it
// starts on, when overtime starts, the longest shift. The zone is this
// device's, shown rather than typed.

import { Field, inputClass } from "./AuthCard";
import { WEEKDAYS, type Weekday, type WorkWeekDraft, timeZoneLabel, weekdayLabel } from "./work_week";

export function WorkWeekBoxes({ draft, onChange }: { draft: WorkWeekDraft; onChange: (d: WorkWeekDraft) => void }) {
  return (
    <>
      <Field label="Work week starts on" hint={`Days and weeks are drawn in ${timeZoneLabel(draft.timeZone)} (${draft.timeZone}), this device's zone.`}>
        <select className={inputClass} value={draft.startsOn} onChange={(e) => onChange({ ...draft, startsOn: e.target.value as Weekday })}>
          {WEEKDAYS.map((d) => (
            <option key={d} value={d}>
              {weekdayLabel(d)}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Overtime after (hours a week)" hint="0 for none.">
        <input className={inputClass} inputMode="decimal" placeholder="40" value={draft.overtimeText} onChange={(e) => onChange({ ...draft, overtimeText: e.target.value })} />
      </Field>
      <Field label="Overtime pays (× the hourly rate)" hint="1.5 is time and a half; 2 is double time.">
        <input className={inputClass} inputMode="decimal" placeholder="1.5" value={draft.rateText} onChange={(e) => onChange({ ...draft, rateText: e.target.value })} />
      </Field>
      <Field label="Daily overtime after (hours a day)" hint="Some businesses and states count overtime by the day, like after 8 or 10. 0 for none.">
        <input className={inputClass} inputMode="decimal" placeholder="0" value={draft.dailyText} onChange={(e) => onChange({ ...draft, dailyText: e.target.value })} />
      </Field>
      <Field label="Longest shift (hours)" hint="A shift longer than this is reviewed before it's paid.">
        <input className={inputClass} inputMode="decimal" placeholder="12" value={draft.longestText} onChange={(e) => onChange({ ...draft, longestText: e.target.value })} />
      </Field>
    </>
  );
}
