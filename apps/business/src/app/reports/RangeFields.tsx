"use client";

// A date-range picker for screens outside Reports (projects, taxes): the
// same presets, plus "All dates" where a running total makes sense.

import { useMemo, useState } from "react";
import { type DateRange, assertDate } from "@pnw/ledger";
import { Field, inputClass } from "@/books/AuthCard";
import { todayIso } from "@/books/display";
import { type Preset, PRESETS, formatDate, presetRange } from "./dates";

export type RangeChoice = Preset | "all";

/** Wide enough for any books; still valid dates. */
const ALL_DATES: DateRange = { from: "1900-01-01", to: "9999-12-31" };

export function useRange(fiscalStart: number, initial: RangeChoice) {
  const today = todayIso();
  const [choice, setChoice] = useState<RangeChoice>(initial);
  const [custom, setCustom] = useState<DateRange>(() => presetRange("this_month", today, fiscalStart));
  const range = useMemo(
    () => (choice === "all" ? ALL_DATES : choice === "custom" ? custom : presetRange(choice, today, fiscalStart)),
    [choice, custom, today, fiscalStart],
  );
  return { choice, setChoice, custom, setCustom, range, valid: isDate(range.from) && isDate(range.to) && range.from <= range.to };
}

function isDate(d: string): boolean {
  try {
    assertDate(d);
    return true;
  } catch {
    return false;
  }
}

export function RangeFields({ state, allowAll }: { state: ReturnType<typeof useRange>; allowAll?: boolean }) {
  const { choice, setChoice, custom, setCustom, range } = state;
  return (
    <>
      <Field label="Dates">
        <select
          className={inputClass}
          value={choice}
          onChange={(e) => {
            const next = e.target.value as RangeChoice;
            if (next === "custom" && choice !== "all") setCustom(range); // start from what's on screen
            setChoice(next);
          }}
        >
          {allowAll && <option value="all">All dates</option>}
          {PRESETS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
      </Field>
      {choice === "custom" ? (
        <>
          <Field label="From">
            <input type="date" className={inputClass} value={custom.from} onChange={(e) => setCustom({ ...custom, from: e.target.value })} />
          </Field>
          <Field label="To">
            <input type="date" className={inputClass} value={custom.to} onChange={(e) => setCustom({ ...custom, to: e.target.value })} />
          </Field>
        </>
      ) : (
        <p className="self-end pb-2 text-sm text-muted-foreground sm:col-span-2">
          {choice === "all" ? "Everything in your books" : `${formatDate(range.from)} – ${formatDate(range.to)}`}
        </p>
      )}
    </>
  );
}
