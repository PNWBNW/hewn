// ---------------------------------------------------------------------------
// Closing a period (docs/CLOSE_PERIOD.md, decided by Joshua 2026-11-02).
//
// A close runs from the day after the last close (or the books' first entry)
// through any date before today. Every line of the checklist must pass: no
// closing past a warning. Closing marks the books closed through that date
// (@pnw/ledger) and keeps a record with the period root (period_root.ts in
// the ledger), which the chain side then anchors through payroll_audit_log;
// the anchor's transaction id is added to the record once it lands. If the
// anchor fails, the books stay closed and it is offered again.
//
// Reopening is allowed until a range is locked: the ledger's mark moves back,
// and every close it undoes is kept with `reopenedAt` (its anchor stays on
// chain, as it should). The next close chains to the last close still
// standing. The salts behind every root come from one random secret kept in
// these books (and their backups); a proof can't be rebuilt without it.
//
// Pure: no React, no storage, no network. The Shield check is the chain
// side's; it isn't a line here.
// ---------------------------------------------------------------------------

import {
  type IsoDate,
  type PeriodProof,
  type ProofClose,
  buildPeriodProof,
  closeThrough,
  entriesInRange,
  lockThrough,
  nextDay,
  periodEnd,
  periodOf,
  periodRoot,
  previousPeriod,
  reopenFrom,
} from "@pnw/ledger";
import type { Company } from "./company";
import { payableLinks } from "./rail";

export type CloseRecord = {
  start: IsoDate;
  end: IsoDate;
  /** The period root, 64 hex. */
  root: string;
  /** The root it chains to; absent on the first close. */
  prevRoot?: string;
  entries: number;
  settlements: number;
  closedAt: string;
  /** Once the root is on chain: `payroll_audit_log::anchor_event`'s transaction. */
  anchor?: { txId: string; at: string };
  /** Set when a reopen undid this close. The record stays, as its anchor does. */
  reopenedAt?: string;
};

export type Closing = {
  version: 1;
  /** The anchor secret, 32 bytes as hex: the salts behind every root. */
  secret: string;
  records: CloseRecord[];
};

export class CloseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CloseError";
  }
}

const HEX64 = /^[0-9a-f]{64}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TX = /^at1[02-9ac-hj-np-z]{58}$/;

const isTime = (v: unknown): v is string => typeof v === "string" && !Number.isNaN(Date.parse(v));

export function validateClosing(raw: unknown): Closing {
  const r = raw as Record<string, unknown> | null;
  if (!r || r.version !== 1 || typeof r.secret !== "string" || !HEX64.test(r.secret) || !Array.isArray(r.records)) {
    throw new CloseError("The closing records are damaged");
  }
  const records = r.records.map((x): CloseRecord => {
    const c = x as Record<string, unknown> | null;
    if (
      !c ||
      typeof c.start !== "string" ||
      !DATE.test(c.start) ||
      typeof c.end !== "string" ||
      !DATE.test(c.end) ||
      c.start > c.end ||
      typeof c.root !== "string" ||
      !HEX64.test(c.root) ||
      (c.prevRoot !== undefined && (typeof c.prevRoot !== "string" || !HEX64.test(c.prevRoot))) ||
      !Number.isInteger(c.entries) ||
      !Number.isInteger(c.settlements) ||
      !isTime(c.closedAt) ||
      (c.reopenedAt !== undefined && !isTime(c.reopenedAt))
    ) {
      throw new CloseError("A closing record is damaged");
    }
    const out: CloseRecord = { start: c.start, end: c.end, root: c.root, entries: c.entries as number, settlements: c.settlements as number, closedAt: c.closedAt as string };
    if (c.prevRoot) out.prevRoot = c.prevRoot as string;
    if (c.anchor !== undefined) {
      const a = c.anchor as Record<string, unknown> | null;
      if (!a || typeof a.txId !== "string" || !TX.test(a.txId) || !isTime(a.at)) throw new CloseError("A closing record's anchor is damaged");
      out.anchor = { txId: a.txId, at: a.at };
    }
    if (c.reopenedAt) out.reopenedAt = c.reopenedAt as string;
    return out;
  });
  return { version: 1, secret: r.secret, records };
}

/** The closes still standing (not undone by a reopen), oldest first. */
export const standingCloses = (closing: Closing | undefined): CloseRecord[] => (closing?.records ?? []).filter((r) => !r.reopenedAt);

/** The first day the next close covers: the day after the last close, or the books' first entry; null with nothing to close. */
export function nextStart(company: Pick<Company, "books">): IsoDate | null {
  const through = company.books.marks.closedThrough;
  if (through) return nextDay(through);
  const first = company.books.entries.reduce<string | null>((min, e) => (min === null || e.date < min ? e.date : min), null);
  return first;
}

/** The end the app suggests: the last day of the last full month, or yesterday when that's before the start. */
export function suggestedEnd(start: IsoDate, today: IsoDate): IsoDate {
  const lastMonthEnd = periodEnd(previousPeriod(periodOf(today)));
  if (lastMonthEnd >= start) return lastMonthEnd;
  const yesterday = new Date(Date.parse(`${today}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  return yesterday >= start ? yesterday : start;
}

export type CheckLine = {
  id: "date" | "review" | "payroll" | "drafts";
  ok: boolean;
  label: string;
  /** What's left, when it doesn't pass. */
  detail?: string;
  /** Where to fix it. */
  href?: string;
};

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The checklist for closing `start` through `end` (docs/CLOSE_PERIOD.md). Every line must pass. */
export function closeChecks(company: Pick<Company, "books" | "review" | "payroll" | "sales">, start: IsoDate, end: IsoDate, today: IsoDate): CheckLine[] {
  const waiting = (company.review?.items ?? []).filter((i) => i.status === "new" && i.date <= end).length;
  let settling = 0;
  for (const run of company.payroll.runs) {
    if (run.payDate > end) continue;
    for (const p of run.paychecks) if (p.settlement.status !== "settled") settling++;
  }
  const drafts = company.sales.invoices.filter((i) => i.state === "draft" && i.date <= end).length;
  const dateOk = DATE.test(end) && end >= start && end < today;
  return [
    {
      id: "date",
      ok: dateOk,
      label: "The range ends before today",
      ...(dateOk ? {} : { detail: end >= today ? "Today can't be closed yet: entries can still land in it." : "Pick an end on or after the range's first day." }),
    },
    {
      id: "review",
      ok: waiting === 0,
      label: "Nothing waiting in For review",
      ...(waiting ? { detail: `${plural(waiting, "movement", "movements")} dated in the range to review`, href: "/transactions?tab=review" } : {}),
    },
    {
      id: "payroll",
      ok: settling === 0,
      label: "No paycheck still settling",
      ...(settling ? { detail: `${plural(settling, "paycheck", "paychecks")} not settled yet`, href: "/payroll" } : {}),
    },
    {
      id: "drafts",
      ok: drafts === 0,
      label: "No draft invoices dated in the range",
      ...(drafts ? { detail: `${plural(drafts, "draft invoice", "draft invoices")}: send or delete them`, href: "/sales" } : {}),
    },
  ];
}

/** The range's settlements: rail paychecks whose transfer confirmed in it, tied to their entries. */
export function settlementsIn(company: Pick<Company, "books" | "payroll" | "rail">, start: IsoDate, end: IsoDate) {
  const hashOf = new Map(company.books.entries.map((e) => [e.id, e.hash]));
  const who = payableLinks(company.rail);
  const out: { entryHash: string; txId: string; recipient: string }[] = [];
  for (const run of company.payroll.runs) {
    if (run.mode !== "rail") continue;
    run.paychecks.forEach((p, i) => {
      const s = p.settlement;
      const on = s.settledAt?.slice(0, 10);
      const hash = hashOf.get(run.entryIds[i] ?? "");
      if (s.status !== "settled" || !s.reference || !on || on < start || on > end || !hash) return;
      out.push({ entryHash: hash, txId: s.reference, recipient: who.get(p.workerId) ?? p.workerId });
    });
  }
  return out;
}

const fromHex = (hex: string): Uint8Array => Uint8Array.from(hex.match(/../g)!.map((b) => parseInt(b, 16)));

/**
 * Closes the books through `end`. `newSecret` is 32 random hex bytes, used only for the first
 * close; `shieldMatches` is the chain side's check. Throws unless every line passes.
 */
export function closeRange(
  company: Company,
  end: IsoDate,
  options: { today: IsoDate; now: string; shieldMatches: boolean; newSecret: string },
): { company: Company; record: CloseRecord } {
  const start = nextStart(company);
  if (!start) throw new CloseError("There's nothing in the books to close yet");
  const failing = closeChecks(company, start, end, options.today).filter((c) => !c.ok);
  if (failing.length) throw new CloseError(failing[0]!.detail ?? failing[0]!.label);
  if (!options.shieldMatches) throw new CloseError("The Shield check has to say Matches before closing");
  const closing: Closing = company.closing ?? { version: 1, secret: options.newSecret, records: [] };
  if (!HEX64.test(closing.secret)) throw new CloseError("The anchor secret is damaged");
  const prev = standingCloses(closing).at(-1);
  const entries = entriesInRange(company.books, start, end);
  const settlements = settlementsIn(company, start, end);
  const r = periodRoot({ anchorSecret: fromHex(closing.secret), start, end, entries, settlements, ...(prev ? { prevRoot: prev.root } : {}) });
  const record: CloseRecord = {
    start,
    end,
    root: r.root,
    ...(prev ? { prevRoot: prev.root } : {}),
    entries: r.n,
    settlements: r.m,
    closedAt: options.now,
  };
  // Closed again after a reopen with nothing changed: the same root, already anchored once. The
  // chain refuses a hash twice, so the earlier anchor stands for this close too.
  const earlier = closing.records.find((x) => x.root === r.root && x.anchor);
  if (earlier?.anchor) record.anchor = earlier.anchor;
  const books = closeThrough(company.books, end, { now: () => options.now });
  return { company: { ...company, books, closing: { ...closing, records: [...closing.records, record] } }, record };
}

/**
 * The period proof of a standing close (docs/AUDIT_DESIGN.md §4, "a whole period"): every entry and
 * payment in its range with the salts that recompute its root, and every close of the range,
 * newest first. Refuses when the books no longer give the root that was closed.
 */
export function periodProofFor(company: Company, record: Pick<CloseRecord, "start" | "end" | "root" | "prevRoot" | "reopenedAt">, madeAt: string): PeriodProof {
  const closing = company.closing;
  if (!closing || !HEX64.test(closing.secret)) throw new CloseError("These books have no closes to prove");
  if (record.reopenedAt) throw new CloseError("That close was reopened: export the close that stands now");
  const closes: ProofClose[] = closing.records
    .filter((r) => r.start <= record.end && r.end >= record.start)
    .map((r) => ({
      start: r.start,
      end: r.end,
      root: r.root,
      closedAt: r.closedAt,
      ...(r.anchor ? { anchorTx: r.anchor.txId } : {}),
      ...(r.reopenedAt ? { reopenedAt: r.reopenedAt } : {}),
    }))
    .reverse();
  return buildPeriodProof(
    {
      anchorSecret: fromHex(closing.secret),
      start: record.start,
      end: record.end,
      entries: entriesInRange(company.books, record.start, record.end),
      settlements: settlementsIn(company, record.start, record.end),
      ...(record.prevRoot ? { prevRoot: record.prevRoot } : {}),
      business: company.books.settings.businessName,
      madeAt,
      accounts: company.books.accounts,
      closes,
    },
    record.root,
  );
}

/** The proof file's name: the business and the range. */
export function proofFileName(businessName: string, record: Pick<CloseRecord, "start" | "end">): string {
  const name = businessName.replace(/[^\w-]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase() || "books";
  return `${name}-period-proof-${record.start}-to-${record.end}.json`;
}

/** Notes the anchor of the standing close that ends on `end`. */
export function recordAnchor(company: Company, end: IsoDate, txId: string, at: string): Company {
  const closing = company.closing;
  const i = closing?.records.findIndex((r) => r.end === end && !r.reopenedAt) ?? -1;
  if (!closing || i < 0) throw new CloseError("That close isn't in the books");
  if (!TX.test(txId)) throw new CloseError("That isn't a transaction id");
  const records = closing.records.map((r, j) => (j === i ? { ...r, anchor: { txId, at } } : r));
  return { ...company, closing: { ...closing, records } };
}

/** Reopens from `date`: the ledger's mark moves back, and every close it undoes is kept as reopened. */
export function reopenCloses(company: Company, date: IsoDate, now: string): Company {
  const books = reopenFrom(company.books, date, { now: () => now });
  const records = (company.closing?.records ?? []).map((r) => (!r.reopenedAt && r.end >= date ? { ...r, reopenedAt: now } : r));
  return { ...company, books, ...(company.closing ? { closing: { ...company.closing, records } } : {}) };
}

/** Locks for good through `end`: no reopening, and nothing in it can be reversed. */
export function lockCloses(company: Company, end: IsoDate, now: string): Company {
  return { ...company, books: lockThrough(company.books, end, { now: () => now }) };
}

/** From the 5th, a reminder to close last month while it isn't closed and has entries (Joshua, 2026-11-02). */
export function closeReminder(company: Pick<Company, "books">, today: IsoDate): { through: IsoDate } | null {
  if (Number(today.slice(8, 10)) < 5) return null;
  const through = periodEnd(previousPeriod(periodOf(today)));
  const closed = company.books.marks.closedThrough;
  if (closed && closed >= through) return null;
  const start = nextStart(company);
  if (!start || start > through) return null;
  return { through };
}
