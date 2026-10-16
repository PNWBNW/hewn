// ---------------------------------------------------------------------------
// Hiring by offer (Joshua, 2026-10-16): the offer comes first, and the person
// joins the team when they accept. A business finds someone by their
// registered name and sends an offer straight away; until they accept they
// are "Offer out": a team record that isn't active (so no pay run includes
// them), tied to the offer by `joinsOnAccept` on its link.
//
//   sent      → an inactive team member, with the offer's pay, and the link
//   accepted  → active, the link `linked`, `joinsOnAccept` gone
//   withdrawn → out of the books again (never paid, so nothing to keep)
//
// A team member added the old way (already in the books) is never removed by
// a withdrawn offer; they are just typed again, ready for another.
//
// Also here: taking a never-paid team member out of the books (to clear ones
// added by mistake). Pure: no I/O, no React.
// ---------------------------------------------------------------------------

import { type Payroll, type W4, type Worker, addWorker, hasBeenPaid, removeWorker, updateWorker } from "@pnw/payroll";
import type { Company } from "./company";
import { type RailLink, type Registered, addLink, linkFor, markLinked, removeLink, removePartyLink, setRegistered } from "./rail";

/** Until their own W-4 arrives: single, nothing else claimed (the IRS default for a missing W-4). */
export const DEFAULT_W4: W4 = { filingStatus: "single", dependentCredit: 0n, otherIncome: 0n, extraDeductions: 0n, extraWithholding: 0n };

export type Hire = {
  /** Their name in these books (their registered name, unless the business typed another). */
  name: string;
  who: Registered;
  pay: Pick<Worker, "payType" | "rate" | "frequency">;
  /** The offer as sent (`sendOffer`), whatever team member id it was sent under. */
  link: RailLink;
};

const railOf = (c: Company) => {
  if (!c.rail) throw new Error("Link Shield first");
  return c.rail;
};

/** An offer sent to someone not yet on the team: they're kept as "Offer out" until they answer. */
export function hireByOffer(company: Company, hire: Hire): { company: Company; workerId: string } {
  const added = addWorker(company.payroll, { name: hire.name, ...hire.pay, w4: DEFAULT_W4 });
  const payroll = updateWorker(added.payroll, added.worker.id, { active: false });
  let rail = setRegistered(railOf(company), "worker", added.worker.id, hire.who);
  rail = addLink(rail, { ...hire.link, workerId: added.worker.id, joinsOnAccept: true });
  return { company: { ...company, payroll, rail }, workerId: added.worker.id };
}

/** True while someone's offer is out and they aren't on the team yet. */
export const isOfferOut = (company: { rail?: Company["rail"] | null }, workerId: string): boolean => {
  const link = company.rail ? linkFor(company.rail, workerId) : undefined;
  return link?.status === "offered" && link.joinsOnAccept === true;
};

/**
 * Every offer that has been accepted (`finals`: the agreement ids) becomes linked; anyone it
 * was hiring joins the team (active).
 */
export function acceptOffers(company: Company, finals: ReadonlySet<string>, linkedAt: string): Company {
  if (!company.rail) return company;
  let rail = company.rail;
  let payroll: Payroll = company.payroll;
  for (const l of company.rail.links) {
    if (l.status !== "offered" || !finals.has(l.agreementId)) continue;
    if (l.joinsOnAccept && payroll.workers.some((w) => w.id === l.workerId)) payroll = updateWorker(payroll, l.workerId, { active: true });
    rail = markLinked(rail, l.workerId, linkedAt);
  }
  return { ...company, rail, payroll };
}

/**
 * The offer is off (withdrawn, or expired and withdrawn): the link goes, and
 * someone it was hiring leaves the books. A team member who was already in
 * the books stays, typed again.
 */
export function dropOffer(company: Company, workerId: string): Company {
  if (!company.rail) return company;
  const hiring = isOfferOut(company, workerId);
  const rail = removeLink(company.rail, workerId);
  if (!hiring || hasBeenPaid(company.payroll, workerId)) return { ...company, rail };
  return { ...company, rail: removePartyLink(rail, "worker", workerId), payroll: removeWorker(company.payroll, workerId) };
}

/** Why a team member can't be taken out of the books, or null when they can. */
export function removeProblem(company: { payroll: Company["payroll"]; rail?: Company["rail"] | null }, workerId: string): string | null {
  if (!company.payroll.workers.some((w) => w.id === workerId)) return "Team member not found";
  if (hasBeenPaid(company.payroll, workerId)) return "They've been paid, so they stay in the books; deactivate them instead";
  if (company.rail && linkFor(company.rail, workerId)?.status === "offered") return "Withdraw their offer first";
  return null;
}

/**
 * Takes a never-paid team member out of the books, with what the rail held
 * for them. An agreement they already accepted stays on the chain; only these
 * books forget it.
 */
export function removeFromTeam(company: Company, workerId: string): Company {
  const problem = removeProblem(company, workerId);
  if (problem) throw new Error(problem);
  const rail = company.rail ? removePartyLink(removeLink(company.rail, workerId), "worker", workerId) : company.rail;
  return { ...company, payroll: removeWorker(company.payroll, workerId), ...(rail ? { rail } : {}) };
}
