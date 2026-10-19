// ---------------------------------------------------------------------------
// The paystub document: what the employer commits to when a pay run posts.
//
// One document per paycheck, built from the run, the paycheck and the worker
// as they were at posting. Its hash goes into the journal entry's
// `source.doc`, so it sits inside the entry hash and the chain: change a cent
// on the paystub and the books no longer verify. The document itself stays
// private in the vault (and, later, travels to the worker's); only the hash
// is ever shared.
//
// hash = BLAKE3("PNW::PAYSTUB::v1" || 0x00 || canonical(doc))
//
// canonical() is JSON with every key in a fixed order, amounts as decimal
// strings and absent fields as null, mirroring the ledger's entry hash. The
// overtime fields (2026-10-19) come last and only when the paycheck has
// overtime, so every paystub from before them keeps its exact bytes and hash.
// ---------------------------------------------------------------------------

import { blake3 } from "@noble/hashes/blake3.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import type { Cents, IsoDate, Settings } from "@pnw/ledger";
import { PayrollError } from "./errors";
import type { Paycheck, PaycheckDraft, PayRun, Worker, YearToDate } from "./payroll";

export const PAYSTUB_DOMAIN = "PNW::PAYSTUB::v1";

export type PaystubDocument = {
  version: 1;
  businessName: string;
  workerId: string;
  workerName: string;
  payDate: IsoDate;
  periodStart: IsoDate;
  periodEnd: IsoDate;
  payType: Worker["payType"];
  /** Hourly: per hour. Salary: per year. */
  rate: Cents;
  hours?: number;
  /** Hours paid at the overtime rate, and its multiplier (1.5 for time and a half), when there were any. */
  overtimeHours?: number;
  overtimeRate?: number;
  gross: Cents;
  federalIncomeTax: Cents;
  socialSecurity: Cents;
  medicare: Cents;
  additionalMedicare: Cents;
  employerSocialSecurity: Cents;
  employerMedicare: Cents;
  net: Cents;
  /** This calendar year including this check. */
  ytdGross: Cents;
  ytdWithheld: Cents;
  runId: string;
  /** Which paycheck of the run this is, from 1. */
  position: number;
};

/**
 * Builds the document for one paycheck. `ytd` is the worker's year to date
 * *before* this check (what `yearToDate` returns for the run's pay date); the
 * document carries the totals after it. The paycheck's position is its place
 * in the run (each worker is paid once per run).
 */
export function paystubDocument(
  run: Pick<PayRun, "id" | "payDate" | "periodStart" | "periodEnd"> & { paychecks: readonly Pick<Paycheck, "workerId">[] },
  paycheck: PaycheckDraft,
  worker: Pick<Worker, "id" | "name" | "payType" | "rate">,
  settings: Pick<Settings, "businessName">,
  ytd: Pick<YearToDate, "gross" | "withheld">,
): PaystubDocument {
  const index = run.paychecks.findIndex((p) => p.workerId === paycheck.workerId);
  if (index < 0 || worker.id !== paycheck.workerId) throw new PayrollError("That paycheck isn't in this run");
  const withheldNow = paycheck.federalIncomeTax + paycheck.socialSecurity + paycheck.medicare + paycheck.additionalMedicare;
  return {
    version: 1,
    businessName: settings.businessName,
    workerId: worker.id,
    workerName: worker.name,
    payDate: run.payDate,
    periodStart: run.periodStart,
    periodEnd: run.periodEnd,
    payType: worker.payType,
    rate: worker.rate,
    ...(paycheck.hours !== undefined ? { hours: paycheck.hours } : {}),
    ...(paycheck.overtimeHours !== undefined && paycheck.overtimeRate !== undefined ? { overtimeHours: paycheck.overtimeHours, overtimeRate: paycheck.overtimeRate } : {}),
    gross: paycheck.gross,
    federalIncomeTax: paycheck.federalIncomeTax,
    socialSecurity: paycheck.socialSecurity,
    medicare: paycheck.medicare,
    additionalMedicare: paycheck.additionalMedicare,
    employerSocialSecurity: paycheck.employerSocialSecurity,
    employerMedicare: paycheck.employerMedicare,
    net: paycheck.net,
    ytdGross: ytd.gross + paycheck.gross,
    ytdWithheld: ytd.withheld + withheldNow,
    runId: run.id,
    position: index + 1,
  };
}

const str = (c: Cents) => c.toString();
const opt = <T>(v: T | undefined) => (v === undefined ? null : v);

/** The exact bytes that are hashed, keys in a fixed order, bigints as strings. */
export function canonicalPaystub(doc: PaystubDocument): string {
  return JSON.stringify({
    version: doc.version,
    businessName: doc.businessName,
    workerId: doc.workerId,
    workerName: doc.workerName,
    payDate: doc.payDate,
    periodStart: doc.periodStart,
    periodEnd: doc.periodEnd,
    payType: doc.payType,
    rate: str(doc.rate),
    hours: opt(doc.hours),
    gross: str(doc.gross),
    federalIncomeTax: str(doc.federalIncomeTax),
    socialSecurity: str(doc.socialSecurity),
    medicare: str(doc.medicare),
    additionalMedicare: str(doc.additionalMedicare),
    employerSocialSecurity: str(doc.employerSocialSecurity),
    employerMedicare: str(doc.employerMedicare),
    net: str(doc.net),
    ytdGross: str(doc.ytdGross),
    ytdWithheld: str(doc.ytdWithheld),
    runId: doc.runId,
    position: doc.position,
    ...(doc.overtimeHours !== undefined && doc.overtimeRate !== undefined ? { overtimeHours: doc.overtimeHours, overtimeRate: doc.overtimeRate } : {}),
  });
}

export function paystubHash(doc: PaystubDocument): string {
  const domain = utf8ToBytes(PAYSTUB_DOMAIN);
  const body = utf8ToBytes(canonicalPaystub(doc));
  const input = new Uint8Array(domain.length + 1 + body.length);
  input.set(domain, 0);
  input.set(body, domain.length + 1); // byte at domain.length stays 0x00
  return bytesToHex(blake3(input));
}
