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
// The same entry shape is what payroll_gl_bridge.aleo will post in settled
// mode (plus the USDCx transfer and platform fee), so fiat and settled books
// match line for line.
// ---------------------------------------------------------------------------

import {
  type Books,
  type Cents,
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

export type Paycheck = {
  workerId: string;
  hours?: number;
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
};

export type PayRun = {
  id: string;
  payDate: IsoDate;
  periodStart: IsoDate;
  periodEnd: IsoDate;
  bankAccountId: string;
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

export class PayrollError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PayrollError";
  }
}

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

// ---- Paychecks -------------------------------------------------------------

/** Gross and SS already paid to a worker this calendar year, before `beforeDate`. */
export type YearToDate = { gross: Cents; socialSecurity: Cents; employerSocialSecurity: Cents };

export function yearToDate(payroll: Payroll, workerId: string, beforeDate: IsoDate): YearToDate {
  const year = beforeDate.slice(0, 4);
  let gross = 0n;
  let socialSecurity = 0n;
  let employerSocialSecurity = 0n;
  for (const run of payroll.runs) {
    if (run.payDate.slice(0, 4) !== year || run.payDate >= beforeDate) continue;
    for (const p of run.paychecks) {
      if (p.workerId !== workerId) continue;
      gross += p.gross;
      socialSecurity += p.socialSecurity;
      employerSocialSecurity += p.employerSocialSecurity;
    }
  }
  return { gross, socialSecurity, employerSocialSecurity };
}

/** Gross for one period: hours × rate, or annual salary ÷ periods per year. */
export function grossFor(worker: Worker, hours?: number): Cents {
  if (worker.payType === "salary") return (worker.rate + BigInt(perYear(worker.frequency)) / 2n) / BigInt(perYear(worker.frequency));
  if (hours === undefined || !Number.isFinite(hours) || hours < 0) throw new PayrollError(`Enter hours for ${worker.name}`);
  // Hours to the hundredth; rate in cents. Integer math, rounded half-up.
  const centiHours = BigInt(Math.round(hours * 100));
  return (worker.rate * centiHours + 50n) / 100n;
}

export function computePaycheck(worker: Worker, gross: Cents, ytd: Partial<YearToDate> & { gross: Cents }, hours?: number): Paycheck {
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
  const paycheck: Paycheck = {
    workerId: worker.id,
    ...(worker.payType === "hourly" && hours !== undefined ? { hours } : {}),
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

export const withheld = (p: Paycheck) => p.federalIncomeTax + p.socialSecurity + p.medicare + p.additionalMedicare;
export const employerTaxes = (p: Paycheck) => p.employerSocialSecurity + p.employerMedicare;

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

// ---- Pay runs --------------------------------------------------------------

export type PayRunInput = {
  payDate: IsoDate;
  periodStart: IsoDate;
  periodEnd: IsoDate;
  bankAccountId: string;
  /**
   * Who's paid in this run. Hourly workers need hours; salaried ones don't.
   * Optional tags (a project, say) go on that paycheck's wage and employer-tax
   * lines, so the labour shows up in the project's profit.
   */
  lines: { workerId: string; hours?: number; tags?: Tags }[];
};

/** Computes every paycheck without touching the books, for the review screen. */
export function previewPayRun(payroll: Payroll, input: PayRunInput): Paycheck[] {
  assertDate(input.payDate);
  if (input.lines.length === 0) throw new PayrollError("Choose at least one person to pay");
  const seen = new Set<string>();
  return input.lines.map((line) => {
    const worker = payroll.workers.find((w) => w.id === line.workerId);
    if (!worker) throw new PayrollError("Team member not found");
    if (!worker.active) throw new PayrollError(`${worker.name} is inactive`);
    if (seen.has(worker.id)) throw new PayrollError(`${worker.name} is listed twice`);
    seen.add(worker.id);
    const paycheck = computePaycheck(worker, grossFor(worker, line.hours), yearToDate(payroll, worker.id, input.payDate), line.hours);
    const tags = cleanTags(line.tags);
    return tags ? { ...paycheck, tags } : paycheck;
  });
}

export function postPayRun(
  books: Books,
  payroll: Payroll,
  input: PayRunInput,
): { books: Books; payroll: Payroll; run: PayRun; entries: Entry[] } {
  assertDate(input.periodStart);
  assertDate(input.periodEnd);
  if (input.periodStart > input.periodEnd) throw new PayrollError("The pay period ends before it starts");
  const bank = accountMap(books).get(input.bankAccountId);
  if (!bank || bank.type !== "bank") throw new PayrollError("Choose the bank account paychecks come from");
  const paychecks = previewPayRun(payroll, input);

  let { books: next, accounts } = ensurePayrollAccounts(books);
  const runId = `run-${payroll.runs.length + 1}`;
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
    const r = postEntry(next, {
      date: input.payDate,
      memo: `Payroll, ${input.periodStart} to ${input.periodEnd}`,
      source: { kind: "payroll", ref: runId },
      lines,
    });
    next = r.books;
    entries.push(r.entry);
  }
  const run: PayRun = {
    id: runId,
    payDate: input.payDate,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    bankAccountId: input.bankAccountId,
    paychecks,
    entryIds: entries.map((e) => e.id),
  };
  return { books: next, payroll: { ...payroll, runs: [...payroll.runs, run] }, run, entries };
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
