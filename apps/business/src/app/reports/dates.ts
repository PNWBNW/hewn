// Report date ranges: presets, comparison periods and column labels.
// Pure string math on YYYY-MM-DD in UTC, so a report never shifts with the time zone.

import { type DateRange, type IsoDate, periodEnd } from "@pnw/ledger";

export type Preset = "this_month" | "last_month" | "this_quarter" | "year_to_date" | "last_year" | "custom";

export const PRESETS: { id: Preset; label: string }[] = [
  { id: "this_month", label: "This month" },
  { id: "last_month", label: "Last month" },
  { id: "this_quarter", label: "This quarter" },
  { id: "year_to_date", label: "Year to date" },
  { id: "last_year", label: "Last year" },
  { id: "custom", label: "Custom range" },
];

export type Comparison = "none" | "previous_period" | "previous_year";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const parts = (d: IsoDate) => d.split("-").map(Number) as [number, number, number];
const iso = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10);
const monthStart = (y: number, m: number) => iso(y, m, 1);
const isMonthEnd = (d: IsoDate) => periodEnd(d.slice(0, 7)) === d;

/** Moves a date by whole months; a month end stays a month end, and day 31 clamps to a shorter month. */
export function addMonths(date: IsoDate, months: number): IsoDate {
  const [y, m, d] = parts(date);
  const first = monthStart(y, m + months);
  const last = periodEnd(first.slice(0, 7));
  return isMonthEnd(date) || d > Number(last.slice(8)) ? last : `${first.slice(0, 8)}${String(d).padStart(2, "0")}`;
}

export function addDays(date: IsoDate, days: number): IsoDate {
  const [y, m, d] = parts(date);
  return iso(y, m, d + days);
}

/** Start month of the fiscal year (1–12) decides where quarters and years begin. */
export function presetRange(preset: Exclude<Preset, "custom">, today: IsoDate, fiscalStartMonth: number): DateRange {
  const [y, m] = parts(today);
  const thisMonth = monthStart(y, m);
  // Months since the fiscal year began, 0–11.
  const intoYear = (m - fiscalStartMonth + 12) % 12;
  const yearStart = addMonths(thisMonth, -intoYear);
  switch (preset) {
    case "this_month":
      return { from: thisMonth, to: periodEnd(thisMonth.slice(0, 7)) };
    case "last_month": {
      const from = addMonths(thisMonth, -1);
      return { from, to: periodEnd(from.slice(0, 7)) };
    }
    case "this_quarter": {
      const from = addMonths(yearStart, intoYear - (intoYear % 3));
      return { from, to: addDays(addMonths(from, 3), -1) };
    }
    case "year_to_date":
      return { from: yearStart, to: today };
    case "last_year": {
      const from = addMonths(yearStart, -12);
      return { from, to: addDays(yearStart, -1) };
    }
  }
}

/** Whole calendar months covered by the range, or null if it starts or ends mid-month. */
function wholeMonths(range: DateRange): number | null {
  if (!range.from.endsWith("-01") || !isMonthEnd(range.to)) return null;
  const [fy, fm] = parts(range.from);
  const [ty, tm] = parts(range.to);
  return (ty - fy) * 12 + (tm - fm) + 1;
}

/** The period just before: same number of months when the range is whole months, else same number of days. */
export function previousPeriod(range: DateRange): DateRange {
  const months = wholeMonths(range);
  if (months !== null) return { from: addMonths(range.from, -months), to: addMonths(range.to, -months) };
  const [fy, fm, fd] = parts(range.from);
  const [ty, tm, td] = parts(range.to);
  const days = Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000);
  const to = addDays(range.from, -1);
  return { from: addDays(to, -days), to };
}

export function previousYear(range: DateRange): DateRange {
  return { from: addMonths(range.from, -12), to: addMonths(range.to, -12) };
}

export function compareRange(range: DateRange, comparison: Comparison): DateRange | undefined {
  if (comparison === "previous_period") return previousPeriod(range);
  if (comparison === "previous_year") return previousYear(range);
  return undefined;
}

/** Comparison date for the balance sheet: end of the month before, or the same day a year earlier. */
export function compareDate(asOf: IsoDate, comparison: Comparison): IsoDate | undefined {
  if (comparison === "previous_period") return addDays(asOf.slice(0, 8) + "01", -1);
  if (comparison === "previous_year") return addMonths(asOf, -12);
  return undefined;
}

/** "Oct 13, 2026" */
export function formatDate(date: IsoDate): string {
  const [y, m, d] = parts(date);
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}

/** Short column heading: "Oct 2026", "Jan – Mar 2026", "Jul 2025 – Jun 2026", or the exact days. */
export function rangeLabel(range: DateRange): string {
  const [fy, fm] = parts(range.from);
  const [ty, tm] = parts(range.to);
  const months = wholeMonths(range);
  if (months === 1) return `${MONTHS[fm - 1]} ${fy}`;
  if (months !== null) {
    return fy === ty ? `${MONTHS[fm - 1]} – ${MONTHS[tm - 1]} ${ty}` : `${MONTHS[fm - 1]} ${fy} – ${MONTHS[tm - 1]} ${ty}`;
  }
  return `${formatDate(range.from)} – ${formatDate(range.to)}`;
}
