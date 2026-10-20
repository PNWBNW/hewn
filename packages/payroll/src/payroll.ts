// ---------------------------------------------------------------------------
// Payroll, fiat mode: the team, paychecks, and posting pay runs into the books.
//
// Everything here is private: names, pay rates and W-4 elections live only
// inside the encrypted vault, next to the books. Amounts are bigint cents.
// The federal tax math is the existing TypeScript engine (IRS annualization
// method); this module converts to and from cents at that boundary and adds
// the employer's matching Social Security and Medicare.
//
// Each worker's paycheck posts as ONE balanced journal entry:
//
//   Dr Wages                    gross
//   Dr Employer payroll taxes   employer SS + Medicare
//      Cr Payroll Liabilities   withheld (federal + employee SS/Medicare) + employer SS/Medicare
//      Cr Bank                  net pay
//
// A paycheck tagged with a project (or class, location) carries the tag on
// its wage and employer-tax lines: that's the labour cost of the job.
//
// Each entry commits to that paycheck's paystub document (`source.doc`, see
// paystub.ts). The entry is the same whichever way the net pay moves: a run
// paid outside the app (mode "external": the bank does the money, settled
// the moment it posts, with an optional payment reference) and a run paid
// on the rail (mode "rail": posted pending, settled per paycheck as each
// transfer confirms) differ only in which bank-type account the net pay is
// credited from. That's the Phase 2 parity criterion, tested in
// parity.test.ts.
// ---------------------------------------------------------------------------

import {
  type Account,
  type Books,
  type Cents,
  type Clock,
  type Entry,
  type IsoDate,
  type Tags,
  addAccount,
  accountMap,
  assertDate,
  baseOf,
  cleanTags,
  postEntry,
  systemAccount,
} from "@pnw/ledger";
import {
  type FilingStatus,
  type PayPeriod,
  computePayrollTax,
  getTaxTableInfo,
} from "@pnw/tax-engine/tax-engine";
import { PayrollError } from "./errors";
import { paystubDocument, paystubHash } from "./paystub";

export { PayrollError };

// ---- Types -----------------------------------------------------------------

export type PayFrequency = Extract<PayPeriod, "weekly" | "biweekly" | "semimonthly" | "monthly">;

export const PAY_FREQUENCIES: { id: PayFrequency; label: string; perYear: number }[] = [
  { id: "weekly", label: "Weekly", perYear: 52 },
  { id: "biweekly", label: "Every two weeks", perYear: 26 },
  { id: "semimonthly", label: "Twice a month", perYear: 24 },
  { id: "monthly", label: "Monthly", perYear: 12 },
];

export const FILING_STATUSES: { id: FilingStatus; label: string }[] = [
  { id: "single", label: "Single or married filing separately" },
  { id: "married_filing_jointly", label: "Married filing jointly" },
  { id: "head_of_household", label: "Head of household" },
  { id: "married_filing_separately", label: "Married filing separately" },
];

/** The W-4 (2020+) elections the withholding math needs. */
export type W4 = {
  filingStatus: FilingStatus;
  /** Step 3: total dependent credit for the year. */
  dependentCredit: Cents;
  /** Step 4a: other income for the year. */
  otherIncome: Cents;
  /** Step 4b: deductions beyond the standard deduction, for the year. */
  extraDeductions: Cents;
  /** Step 4c: extra withholding per paycheck. */
  extraWithholding: Cents;
};

export type Worker = {
  id: string;
  name: string;
  active: boolean;
  payType: "hourly" | "salary";
  /** Hourly: per hour. Salary: per year. */
  rate: Cents;
  frequency: PayFrequency;
  w4: W4;
};

export type WorkerInput = Omit<Worker, "id" | "active">;

/** How a run's net pay moves: outside the app (the bank), or on the rail. */
export type SettlementMode = "external" | "rail";

/**
 * Where one paycheck's payment stands. External runs are settled as they
 * post; rail paychecks start pending and are marked as each transfer
 * confirms (`reference` = the transfer's id, `height` = the block it landed
 * in) or fails, and a failed one can go back to pending for a retry.
 */
export type Settlement = {
  status: "pending" | "settled" | "failed";
  /**
   * A bank batch number, a transfer id: whatever identifies the payment. On a
   * pending rail paycheck it is the id the wallet gave the transfer once it
   * was sent, so a reload resumes by watching it rather than paying twice.
   */
  reference?: string;
  height?: number;
  settledAt?: string;
  failure?: string;
  /** Rail only: the network fee the employer actually paid, in microcredits (1,000,000 per credit). */
  feeMicrocredits?: bigint;
};

export type Paycheck = {
  workerId: string;
  /** Hourly: the regular hours paid at the rate. */
  hours?: number;
  /** Hourly: hours paid at the overtime rate, when there were any (Joshua, 2026-10-19). */
  overtimeHours?: number;
  /** The overtime multiplier those hours were paid at, like 1.5; present with `overtimeHours`. */
  overtimeRate?: number;
  gross: Cents;
  federalIncomeTax: Cents;
  socialSecurity: Cents;
  medicare: Cents;
  additionalMedicare: Cents;
  employerSocialSecurity: Cents;
  employerMedicare: Cents;
  net: Cents;
  /** Project, class or location this paycheck's labour is charged to. */
  tags?: Tags;
  /**
   * Hex BLAKE3 of the paystub document (paystub.ts), the same value as the
   * journal entry's `source.doc`. Absent only on runs posted before paystub
   * documents existed.
   */
  paystubHash?: string;
  settlement: Settlement;
  /** Where the paystub was last sent to the person, once it has been. */
  delivery?: PaycheckDelivery;
};

/**
 * The outbox record for one paystub: which slot of the person's mailbox it
 * went to (`seq`, with the slot's `lookup` id) and when. Only the last send
 * is kept; a resend takes a new slot and replaces it. What was sent is
 * rebuilt from the vault, so nothing else needs keeping.
 */
export type PaycheckDelivery = {
  seq: number;
  lookup: string;
  sentAt: string;
  /** When the person's app picked it up, from their receipt. Absent until one arrives. */
  receivedAt?: string;
};

/** A paycheck as computed for review, before a run commits to it and pays it. */
export type PaycheckDraft = Omit<Paycheck, "paystubHash" | "settlement" | "delivery">;

export type PayRun = {
  id: string;
  payDate: IsoDate;
  periodStart: IsoDate;
  periodEnd: IsoDate;
  bankAccountId: string;
  mode: SettlementMode;
  paychecks: Paycheck[];
  /** One journal entry per paycheck, in the same order. */
  entryIds: string[];
};

export type PayrollAccounts = { wagesId: string; employerTaxesId: string; liabilitiesId: string };

export type Payroll = {
  version: 1;
  workers: Worker[];
  runs: PayRun[];
  nextWorker: number;
};

export const emptyPayroll = (): Payroll => ({ version: 1, workers: [], runs: [], nextWorker: 1 });

/** Timestamps come from the caller so posting stays deterministic in tests. */
const stamp = (clock?: Clock) => (clock?.now ?? (() => new Date().toISOString()))();

// ---- Cents ⇄ dollars at the tax-engine boundary ------------------------------

const toDollars = (c: Cents) => Number(c) / 100;
const toCents = (d: number) => BigInt(Math.round(d * 100));
/** Rate × cents, rounded half-up to the cent, without floating point. */
function pct(cents: Cents, basisPoints: bigint): Cents {
  return (cents * basisPoints + 5000n) / 10000n;
}

const TABLE = getTaxTableInfo();
const SS_BP = BigInt(Math.round(TABLE.ssRate * 10000)); // 620
const MEDICARE_BP = BigInt(Math.round(TABLE.medicareRate * 10000)); // 145
const SS_WAGE_BASE = toCents(TABLE.ssWageBase);
/** Most Social Security either side can owe in a year: 6.2% of the wage base ($11,439.00 for 2026). */
const SS_ANNUAL_MAX = pct(SS_WAGE_BASE, SS_BP);

export function perYear(frequency: PayFrequency): number {
  return PAY_FREQUENCIES.find((f) => f.id === frequency)!.perYear;
}

// ---- Team ------------------------------------------------------------------

function validateWorker(w: WorkerInput): void {
  if (!w.name.trim()) throw new PayrollError("Every team member needs a name");
  if (typeof w.rate !== "bigint" || w.rate <= 0n) throw new PayrollError("Pay rate must be more than zero");
  if (!PAY_FREQUENCIES.some((f) => f.id === w.frequency)) throw new PayrollError("Choose how often they're paid");
  for (const [k, v] of Object.entries(w.w4)) {
    if (k !== "filingStatus" && (typeof v !== "bigint" || v < 0n)) throw new PayrollError("W-4 amounts can't be negative");
  }
}

export function addWorker(payroll: Payroll, input: WorkerInput): { payroll: Payroll; worker: Worker } {
  validateWorker(input);
  const worker: Worker = { ...input, name: input.name.trim(), id: `wkr-${payroll.nextWorker}`, active: true };
  return { payroll: { ...payroll, workers: [...payroll.workers, worker], nextWorker: payroll.nextWorker + 1 }, worker };
}

export function updateWorker(payroll: Payroll, id: string, changes: Partial<WorkerInput & { active: boolean }>): Payroll {
  const current = payroll.workers.find((w) => w.id === id);
  if (!current) throw new PayrollError("Team member not found");
  const next = { ...current, ...changes };
  validateWorker(next);
  return { ...payroll, workers: payroll.workers.map((w) => (w.id === id ? next : w)) };
}

/** True when any posted run has a paycheck for this team member. */
export const hasBeenPaid = (payroll: Payroll, id: string): boolean => payroll.runs.some((r) => r.paychecks.some((p) => p.workerId === id));

/**
 * Takes a team member out of the books entirely: only someone never paid (a
 * paycheck keeps the person it paid, so a paid one is deactivated instead).
 */
export function removeWorker(payroll: Payroll, id: string): Payroll {
  if (!payroll.workers.some((w) => w.id === id)) throw new PayrollError("Team member not found");
  if (hasBeenPaid(payroll, id)) throw new PayrollError("They've been paid, so they stay in the books; deactivate them instead");
  return { ...payroll, workers: payroll.workers.filter((w) => w.id !== id) };
}

// ---- Paychecks -------------------------------------------------------------

/** Gross, SS and total withholding already paid to a worker this calendar year, before a given check. */
export type YearToDate = { gross: Cents; socialSecurity: Cents; employerSocialSecurity: Cents; withheld: Cents };

/**
 * What a worker has been paid this calendar year up to and including
 * `payDate`, counting only the runs posted before `beforeRun` (every run so
 * far when `beforeRun` is omitted: the next run to post). Two runs on the
 * same day are therefore cumulative in the order they were posted, and
 * rebuilding a paystub later sees exactly what posting saw.
 */
export function yearToDate(payroll: Payroll, workerId: string, payDate: IsoDate, beforeRun?: string): YearToDate {
  const year = payDate.slice(0, 4);
  const stop = beforeRun === undefined ? payroll.runs.length : payroll.runs.findIndex((r) => r.id === beforeRun);
  if (stop < 0) throw new PayrollError("Pay run not found");
  let gross = 0n;
  let socialSecurity = 0n;
  let employerSocialSecurity = 0n;
  let withheldSoFar = 0n;
  for (const run of payroll.runs.slice(0, stop)) {
    if (run.payDate.slice(0, 4) !== year || run.payDate > payDate) continue;
    for (const p of run.paychecks) {
      if (p.workerId !== workerId) continue;
      gross += p.gross;
      socialSecurity += p.socialSecurity;
      employerSocialSecurity += p.employerSocialSecurity;
      withheldSoFar += withheld(p);
    }
  }
  return { gross, socialSecurity, employerSocialSecurity, withheld: withheldSoFar };
}

/** Hours paid at an overtime rate: how many, and the multiplier of the hourly rate (1 to 3, to the hundredth). */
export type Overtime = { hours: number; rate: number };

/** Checks an overtime part; none, or none worth paying, comes back undefined. */
export function cleanOvertime(worker: Pick<Worker, "name">, overtime: Overtime | undefined): Overtime | undefined {
  if (overtime === undefined) return undefined;
  if (!Number.isFinite(overtime.hours) || overtime.hours < 0) throw new PayrollError(`Overtime hours for ${worker.name} must be zero or more`);
  if (!Number.isFinite(overtime.rate) || overtime.rate < 1 || overtime.rate > 3 || Math.round(overtime.rate * 100) !== overtime.rate * 100) {
    throw new PayrollError(`The overtime rate for ${worker.name} must be from 1 to 3 times, like 1.5`);
  }
  return Math.round(overtime.hours * 100) === 0 ? undefined : overtime;
}

/**
 * Gross for one period: hours × rate (plus overtime hours × rate × the
 * overtime multiplier), or annual salary ÷ periods per year. Salaried pay
 * has no overtime part.
 */
export function grossFor(worker: Worker, hours?: number, overtime?: Overtime): Cents {
  if (worker.payType === "salary") return (worker.rate + BigInt(perYear(worker.frequency)) / 2n) / BigInt(perYear(worker.frequency));
  if (hours === undefined || !Number.isFinite(hours) || hours < 0) throw new PayrollError(`Enter hours for ${worker.name}`);
  const ot = cleanOvertime(worker, overtime);
  // Hours to the hundredth, the multiplier to the hundredth, rate in cents: integer math, rounded half-up once.
  const centiHours = BigInt(Math.round(hours * 100));
  const otCentiHours = ot ? BigInt(Math.round(ot.hours * 100)) : 0n;
  const otRate = ot ? BigInt(Math.round(ot.rate * 100)) : 0n;
  return (worker.rate * centiHours * 100n + worker.rate * otCentiHours * otRate + 5_000n) / 10_000n;
}

export function computePaycheck(worker: Worker, gross: Cents, ytd: Partial<YearToDate> & { gross: Cents }, hours?: number, overtime?: Overtime): PaycheckDraft {
  if (gross < 0n) throw new PayrollError("Gross pay can't be negative");
  const t = computePayrollTax({
    gross: toDollars(gross),
    filingStatus: worker.w4.filingStatus,
    payPeriod: worker.frequency,
    ytdGross: toDollars(ytd.gross),
    ytdSsTax: toDollars(ytd.socialSecurity ?? 0n),
    dependentCredit: toDollars(worker.w4.dependentCredit),
    otherIncome: toDollars(worker.w4.otherIncome),
    extraDeductions: toDollars(worker.w4.extraDeductions),
    extraWithholding: toDollars(worker.w4.extraWithholding),
  });
  const federalIncomeTax = toCents(t.federalIncomeTax);
  // Per-paycheck rounding can drift a cent over the year; never let either side pass the annual maximum.
  const capSs = (amount: Cents, paidSoFar: Cents) => {
    const room = SS_ANNUAL_MAX - paidSoFar;
    return amount < room ? amount : room > 0n ? room : 0n;
  };
  const socialSecurity = capSs(toCents(t.socialSecurityTax), ytd.socialSecurity ?? 0n);
  const medicare = toCents(t.medicareTax);
  const additionalMedicare = toCents(t.additionalMedicareTax);
  // Employer matches SS (same wage base) and regular Medicare; it does not match Additional Medicare.
  const ssRoom = SS_WAGE_BASE - ytd.gross > 0n ? SS_WAGE_BASE - ytd.gross : 0n;
  const ssWages = gross < ssRoom ? gross : ssRoom;
  const paycheck: PaycheckDraft = {
    workerId: worker.id,
    ...(worker.payType === "hourly" && hours !== undefined ? { hours } : {}),
    ...(worker.payType === "hourly" && cleanOvertime(worker, overtime) ? { overtimeHours: overtime!.hours, overtimeRate: overtime!.rate } : {}),
    gross,
    federalIncomeTax,
    socialSecurity,
    medicare,
    additionalMedicare,
    employerSocialSecurity: capSs(pct(ssWages, SS_BP), ytd.employerSocialSecurity ?? 0n),
    employerMedicare: pct(gross, MEDICARE_BP),
    net: gross - federalIncomeTax - socialSecurity - medicare - additionalMedicare,
  };
  if (paycheck.net < 0n) throw new PayrollError(`Withholding for ${worker.name} is more than their gross pay; check the W-4 extra withholding`);
  return paycheck;
}

export const withheld = (p: PaycheckDraft) => p.federalIncomeTax + p.socialSecurity + p.medicare + p.additionalMedicare;
export const employerTaxes = (p: PaycheckDraft) => p.employerSocialSecurity + p.employerMedicare;

// ---- Accounts --------------------------------------------------------------

/** Finds the payroll expense accounts by name, creating any that are missing. */
export function ensurePayrollAccounts(books: Books): { books: Books; accounts: PayrollAccounts } {
  let next = books;
  const find = (name: string) =>
    next.accounts.find((a) => a.active && a.name.toLowerCase() === name.toLowerCase() && baseOf(a) === "expense");
  const ensure = (name: string) => {
    const found = find(name);
    if (found) return found.id;
    const r = addAccount(next, { name, type: "expense" });
    next = r.books;
    return r.account.id;
  };
  const wagesId = ensure("Wages");
  const employerTaxesId = ensure("Employer Payroll Taxes");
  return { books: next, accounts: { wagesId, employerTaxesId, liabilitiesId: systemAccount(next, "payroll_liabilities").id } };
}

/** The bank-type account that holds the linked account's money (its stablecoin, private and public). */
export const RAIL_ACCOUNT_NAME = "Shield account";
/** What the same account was called before; books that have it keep using it. */
export const LEGACY_RAIL_ACCOUNT_NAMES = ["Rail balance"] as const;

const isRailName = (name: string) => [RAIL_ACCOUNT_NAME, ...LEGACY_RAIL_ACCOUNT_NAMES].some((n) => n.toLowerCase() === name.trim().toLowerCase());

/** The active bank-type account the rail posts to, under its current or a former name; undefined when there is none. */
export function findRailAccount(books: Books): Account | undefined {
  const bank = books.accounts.filter((a) => a.active && a.type === "bank" && isRailName(a.name));
  return bank.find((a) => a.name.trim().toLowerCase() === RAIL_ACCOUNT_NAME.toLowerCase()) ?? bank[0];
}

/** The bank-type account a rail run's net pay is credited from, found by name or created. */
export function ensureRailAccount(books: Books): { books: Books; accountId: string } {
  const found = findRailAccount(books);
  if (found) return { books, accountId: found.id };
  const r = addAccount(books, { name: RAIL_ACCOUNT_NAME, type: "bank" });
  return { books: r.books, accountId: r.account.id };
}

// ---- Pay runs --------------------------------------------------------------

export type PayRunInput = {
  payDate: IsoDate;
  periodStart: IsoDate;
  periodEnd: IsoDate;
  /** The bank-type account net pay comes from: a bank account, or the rail balance. */
  bankAccountId: string;
  /** Default "external": the money moves outside the app and the run is settled as it posts. */
  mode?: SettlementMode;
  /** External runs only: a free-text payment reference (the bank's batch number, say) for every paycheck. */
  reference?: string;
  /**
   * Who's paid in this run. Hourly workers need hours; salaried ones don't.
   * Optional tags (a project, say) go on that paycheck's wage and employer-tax
   * lines, so the labour shows up in the project's profit.
   */
  lines: { workerId: string; hours?: number; overtime?: Overtime; tags?: Tags }[];
};

/** Computes every paycheck without touching the books, for the review screen. */
export function previewPayRun(payroll: Payroll, input: PayRunInput): PaycheckDraft[] {
  assertDate(input.payDate);
  if (input.lines.length === 0) throw new PayrollError("Choose at least one person to pay");
  const seen = new Set<string>();
  return input.lines.map((line) => {
    const worker = payroll.workers.find((w) => w.id === line.workerId);
    if (!worker) throw new PayrollError("Team member not found");
    if (!worker.active) throw new PayrollError(`${worker.name} is inactive`);
    if (seen.has(worker.id)) throw new PayrollError(`${worker.name} is listed twice`);
    seen.add(worker.id);
    const paycheck = computePaycheck(worker, grossFor(worker, line.hours, line.overtime), yearToDate(payroll, worker.id, input.payDate), line.hours, line.overtime);
    const tags = cleanTags(line.tags);
    return tags ? { ...paycheck, tags } : paycheck;
  });
}

export const SETTLEMENT_MODES: SettlementMode[] = ["external", "rail"];

export type DoublePayCheck = {
  /** Same person, same pay date, same gross as a paycheck that is paid or on its way: don't post. */
  blocked: { workerId: string; runId: string }[];
  /** Same person, same pay date, a different amount (or a failed payment): ask first. */
  sameDay: { workerId: string; runId: string }[];
};

/**
 * Looks for a run that already pays someone on this run's pay date, before
 * anything posts. The two tiers come from the old on-chain guard: an exact
 * repeat (worker, date, gross) with a settled or pending paycheck is blocked;
 * any other same-day paycheck is a question for the user. A deliberate second
 * payment passes by differing in amount.
 */
export function checkDoublePay(payroll: Payroll, input: Pick<PayRunInput, "payDate" | "lines">): DoublePayCheck {
  const result: DoublePayCheck = { blocked: [], sameDay: [] };
  for (const line of input.lines) {
    const worker = payroll.workers.find((w) => w.id === line.workerId);
    if (!worker) continue;
    let gross: Cents | null = null;
    try {
      gross = grossFor(worker, line.hours, line.overtime);
    } catch {
      gross = null; // hours missing: previewPayRun will say so; nothing to compare yet
    }
    for (const run of payroll.runs) {
      if (run.payDate !== input.payDate) continue;
      for (const p of run.paychecks) {
        if (p.workerId !== worker.id) continue;
        const exact = gross !== null && p.gross === gross && p.settlement.status !== "failed";
        (exact ? result.blocked : result.sameDay).push({ workerId: worker.id, runId: run.id });
      }
    }
  }
  return result;
}

export function postPayRun(
  books: Books,
  payroll: Payroll,
  input: PayRunInput,
  clock?: Clock,
): { books: Books; payroll: Payroll; run: PayRun; entries: Entry[] } {
  assertDate(input.periodStart);
  assertDate(input.periodEnd);
  if (input.periodStart > input.periodEnd) throw new PayrollError("The pay period ends before it starts");
  const bank = accountMap(books).get(input.bankAccountId);
  if (!bank || bank.type !== "bank") throw new PayrollError("Choose the bank account paychecks come from");
  const mode = input.mode ?? "external";
  if (!SETTLEMENT_MODES.includes(mode)) throw new PayrollError("Choose how this run is paid");
  if (input.reference !== undefined && typeof input.reference !== "string") throw new PayrollError("The payment reference must be text");
  const reference = input.reference?.trim() || undefined;
  if (reference && mode === "rail") throw new PayrollError("A payment reference is only for runs paid outside the app");
  const computed = previewPayRun(payroll, input);

  let { books: next, accounts } = ensurePayrollAccounts(books);
  const runId = `run-${payroll.runs.length + 1}`;
  // External runs are paid the moment they post; rail paychecks wait for their transfer.
  const settlement: Settlement =
    mode === "external" ? { status: "settled", settledAt: stamp(clock), ...(reference ? { reference } : {}) } : { status: "pending" };
  const draft = { id: runId, payDate: input.payDate, periodStart: input.periodStart, periodEnd: input.periodEnd, paychecks: computed };
  const paychecks: Paycheck[] = computed.map((p) => {
    const worker = payroll.workers.find((w) => w.id === p.workerId)!;
    const doc = paystubDocument(draft, p, worker, books.settings, yearToDate(payroll, worker.id, input.payDate));
    return { ...p, paystubHash: paystubHash(doc), settlement: { ...settlement } };
  });

  const entries: Entry[] = [];
  // Pure function: if any paycheck breaks a ledger rule (closed period, inactive account...),
  // postEntry throws and the caller's books and payroll are left exactly as they were.
  for (const p of paychecks) {
    if (p.gross === 0n) continue; // nothing to post for a zero paycheck
    const employee = { kind: "employee" as const, id: p.workerId };
    const tags = p.tags ? { tags: p.tags } : {};
    const lines = [
      { accountId: accounts.wagesId, debit: p.gross, name: employee, ...tags },
      ...(employerTaxes(p) > 0n ? [{ accountId: accounts.employerTaxesId, debit: employerTaxes(p), name: employee, ...tags }] : []),
      ...(withheld(p) + employerTaxes(p) > 0n
        ? [{ accountId: accounts.liabilitiesId, credit: withheld(p) + employerTaxes(p), name: employee }]
        : []),
      ...(p.net > 0n ? [{ accountId: input.bankAccountId, credit: p.net, name: employee }] : []),
    ];
    const r = postEntry(
      next,
      {
        date: input.payDate,
        memo: `Payroll, ${input.periodStart} to ${input.periodEnd}`,
        source: { kind: "payroll", ref: runId, doc: p.paystubHash! },
        lines,
      },
      clock,
    );
    next = r.books;
    entries.push(r.entry);
  }
  const run: PayRun = {
    id: runId,
    payDate: input.payDate,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    bankAccountId: input.bankAccountId,
    mode,
    paychecks,
    entryIds: entries.map((e) => e.id),
  };
  return { books: next, payroll: { ...payroll, runs: [...payroll.runs, run] }, run, entries };
}

// ---- Settlement ------------------------------------------------------------

const SETTLEMENT_STATUSES: Settlement["status"][] = ["pending", "settled", "failed"];

/**
 * Records where one paycheck's payment stands, for the pay queue. Allowed
 * moves: pending → settled, pending → failed, failed → pending (a retry), and
 * pending → pending with a reference (the transfer was sent; here's its id).
 * A settled paycheck never changes. Pure: returns new payroll.
 */
export function markPaycheckSettlement(payroll: Payroll, runId: string, workerId: string, settlement: Settlement): Payroll {
  const run = payroll.runs.find((r) => r.id === runId);
  if (!run) throw new PayrollError("Pay run not found");
  const paycheck = run.paychecks.find((p) => p.workerId === workerId);
  if (!paycheck) throw new PayrollError("That person isn't in this pay run");
  if (!SETTLEMENT_STATUSES.includes(settlement.status)) throw new PayrollError("Unknown payment status");
  if (settlement.reference !== undefined && typeof settlement.reference !== "string") throw new PayrollError("The payment reference must be text");
  if (settlement.height !== undefined && (!Number.isInteger(settlement.height) || settlement.height < 0)) {
    throw new PayrollError("The payment height must be a whole number");
  }
  if (settlement.feeMicrocredits !== undefined && (typeof settlement.feeMicrocredits !== "bigint" || settlement.feeMicrocredits < 0n)) {
    throw new PayrollError("The network fee can't be negative");
  }
  const from = paycheck.settlement.status;
  const to = settlement.status;
  // pending → pending only to note the payment's id once it's been sent.
  const allowed =
    (from === "pending" && to !== "pending") || (from === "failed" && to === "pending") || (from === "pending" && to === "pending" && !!settlement.reference);
  if (!allowed) throw new PayrollError(`A ${from} paycheck can't become ${to}`);
  const paychecks = run.paychecks.map((p) => (p.workerId === workerId ? { ...p, settlement: { ...settlement } } : p));
  return { ...payroll, runs: payroll.runs.map((r) => (r.id === runId ? { ...r, paychecks } : r)) };
}

// ---- Delivery ------------------------------------------------------------------

const LOOKUP = /^[0-9a-f]{64}$/;

/**
 * Records that one paycheck's paystub went to the person: which mailbox slot
 * and when. Only a settled paycheck's paystub is sent (its payment id is part
 * of what goes), and a resend simply replaces the record with the new slot.
 * Pure: returns new payroll.
 */
export function markPaycheckDelivery(payroll: Payroll, runId: string, workerId: string, delivery: PaycheckDelivery): Payroll {
  const run = payroll.runs.find((r) => r.id === runId);
  if (!run) throw new PayrollError("Pay run not found");
  const paycheck = run.paychecks.find((p) => p.workerId === workerId);
  if (!paycheck) throw new PayrollError("That person isn't in this pay run");
  if (paycheck.settlement.status !== "settled") throw new PayrollError("A paystub is sent once the pay has settled");
  if (!delivery || typeof delivery !== "object") throw new PayrollError("The delivery must say which slot it went to and when");
  if (!Number.isInteger(delivery.seq) || delivery.seq < 0 || delivery.seq > 0xffff_ffff) throw new PayrollError("The delivery slot must be a whole number");
  if (typeof delivery.lookup !== "string" || !LOOKUP.test(delivery.lookup)) throw new PayrollError("The delivery lookup must be 64 hex characters");
  if (typeof delivery.sentAt !== "string" || Number.isNaN(Date.parse(delivery.sentAt))) throw new PayrollError("The delivery needs the time it was sent");
  if (paycheck.delivery && delivery.seq < paycheck.delivery.seq) throw new PayrollError("A paystub can't be re-sent to an earlier slot");
  const clean: PaycheckDelivery = { seq: delivery.seq, lookup: delivery.lookup, sentAt: delivery.sentAt };
  const paychecks = run.paychecks.map((p) => (p.workerId === workerId ? { ...p, delivery: clean } : p));
  return { ...payroll, runs: payroll.runs.map((r) => (r.id === runId ? { ...r, paychecks } : r)) };
}

/** Records when the person's app picked up the paystub in slot `seq` (their receipt). A re-send to a later slot waits for its own. */
export function markPaystubReceived(payroll: Payroll, runId: string, workerId: string, seq: number, receivedAt: string): Payroll {
  if (typeof receivedAt !== "string" || Number.isNaN(Date.parse(receivedAt))) throw new PayrollError("A receipt needs the time it was received");
  const run = payroll.runs.find((r) => r.id === runId);
  const paycheck = run?.paychecks.find((p) => p.workerId === workerId);
  if (!run || !paycheck?.delivery || paycheck.delivery.seq !== seq || paycheck.delivery.receivedAt) return payroll;
  const delivery: PaycheckDelivery = { ...paycheck.delivery, receivedAt };
  const paychecks = run.paychecks.map((p) => (p.workerId === workerId ? { ...p, delivery } : p));
  return { ...payroll, runs: payroll.runs.map((r) => (r.id === runId ? { ...r, paychecks } : r)) };
}

// ---- Withholding owed --------------------------------------------------------

export type QuarterLiability = {
  quarter: string; // "2026-Q4"
  federalIncomeTax: Cents;
  employeeFica: Cents;
  employerFica: Cents;
  total: Cents;
};

/** Taxes accrued per calendar quarter (the Form 941 buckets), from posted runs. */
export function liabilitiesByQuarter(payroll: Payroll): QuarterLiability[] {
  const byQ = new Map<string, QuarterLiability>();
  for (const run of payroll.runs) {
    const [y, m] = run.payDate.split("-").map(Number) as [number, number];
    const quarter = `${y}-Q${Math.ceil(m / 3)}`;
    const q = byQ.get(quarter) ?? { quarter, federalIncomeTax: 0n, employeeFica: 0n, employerFica: 0n, total: 0n };
    for (const p of run.paychecks) {
      q.federalIncomeTax += p.federalIncomeTax;
      q.employeeFica += p.socialSecurity + p.medicare + p.additionalMedicare;
      q.employerFica += employerTaxes(p);
      q.total += withheld(p) + employerTaxes(p);
    }
    byQ.set(quarter, q);
  }
  return [...byQ.values()].sort((a, b) => b.quarter.localeCompare(a.quarter));
}

/** Pays withheld and employer taxes over to the IRS: Dr Payroll Liabilities, Cr Bank. */
export function recordTaxPayment(
  books: Books,
  input: { date: IsoDate; amount: Cents; bankAccountId: string; memo?: string },
): { books: Books; entry: Entry } {
  if (input.amount <= 0n) throw new PayrollError("Enter the amount paid");
  const bank = accountMap(books).get(input.bankAccountId);
  if (!bank || bank.type !== "bank") throw new PayrollError("Choose the bank account the payment came from");
  return postEntry(books, {
    date: input.date,
    memo: input.memo ?? "Payroll tax payment",
    source: { kind: "tax_payment" },
    lines: [
      { accountId: systemAccount(books, "payroll_liabilities").id, debit: input.amount },
      { accountId: input.bankAccountId, credit: input.amount },
    ],
  });
}
