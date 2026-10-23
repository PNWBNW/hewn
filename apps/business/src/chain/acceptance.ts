// ---------------------------------------------------------------------------
// Noticing an acceptance. When the person accepts, `accept_job_offer` hands
// the business its own FinalAgreement record, so the acceptance is read from
// Shield, never from a message: the records of the agreement program, the
// final ones carrying an offered link's agreement id. Those offers turn
// linked and anyone they were hiring joins the team (books/hiring.ts). Shield
// is asked only while an offer is waiting. Nothing here logs a record, an id
// or a name.
// ---------------------------------------------------------------------------

import type { Payroll } from "@pnw/payroll";
import type { Company } from "../books/company";
import { acceptOffers } from "../books/hiring";
import { hasWaitingOffer } from "../books/mailbox_feed";
import type { Rail } from "../books/rail";
import { AGREEMENT_PROGRAMS } from "./agreement_programs";
import { finalAgreements } from "./offer";

export type AcceptanceInput = {
  rail: Rail | null | undefined;
  payroll: Payroll;
  /** Shield's `requestRecords`; called once per agreement program, and only while an offer is waiting. */
  requestRecords: (programId: string, all?: boolean) => Promise<unknown[]>;
  updateCompany: (fn: (c: Company) => Company) => Promise<unknown>;
  now?: () => string;
};

export type AcceptanceResult = {
  /** The names of those whose offers were accepted since the last check, in the order the offers were sent. */
  accepted: string[];
};

const FALLBACK_NAME = "A team member";

/** Reads the business's agreement records and links every waiting offer that has been accepted. */
export async function checkAcceptances({ rail, payroll, requestRecords, updateCompany, now }: AcceptanceInput): Promise<AcceptanceResult> {
  if (!rail || !hasWaitingOffer(rail)) return { accepted: [] };
  const raw: unknown[] = [];
  for (const program of AGREEMENT_PROGRAMS) {
    const found = await requestRecords(program, true);
    if (Array.isArray(found)) raw.push(...found);
  }
  const found = finalAgreements(raw);
  const finals = new Set(found.keys());
  const waiting = rail.links.filter((l) => l.status === "offered" && finals.has(l.agreementId));
  if (waiting.length === 0) return { accepted: [] };
  const linkedAt = (now ?? (() => new Date().toISOString()))();
  const halves = new Map([...found].flatMap(([id, f]) => (f.workerHalf ? [[id, f.workerHalf] as const] : [])));
  await updateCompany((c) => acceptOffers(c, finals, linkedAt, halves));
  const names = new Map(payroll.workers.map((w) => [w.id, w.name]));
  return { accepted: waiting.map((l) => names.get(l.workerId) ?? FALLBACK_NAME) };
}
