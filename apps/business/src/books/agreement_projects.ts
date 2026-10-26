// ---------------------------------------------------------------------------
// An agreed job becomes a project (Joshua, 2026-10-26). When a customer
// accepts an agreement (books/service.ts), the business's books get a project
// for it, named after the job and tied to the customer; when either side marks
// the job complete or cancels it, the project closes. A project the business
// reopens afterwards stays open: each agreement closes its project once.
// Invoices under the agreement are tagged to the project (the invoice form),
// so the project's income follows the job.
//
// Kept in the business's vault as which project each agreement has. Pure.
// ---------------------------------------------------------------------------

import { addProject, updateProject } from "@pnw/ledger";
import type { Company } from "./company";
import { itemsOf } from "./connections";
import { agreementsIn } from "./service";

/** Each agreement's project, and whether the job's end already closed it. */
export type AgreementProjects = Record<string, { projectId: string; ended?: true }>;

const ID = /^[0-9a-f]{16}$/;

export function validateAgreementProjects(raw: unknown): AgreementProjects {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("The agreements' projects are damaged");
  const out: AgreementProjects = {};
  for (const [id, v] of Object.entries(raw as Record<string, unknown>)) {
    const r = v as Record<string, unknown> | null;
    if (!ID.test(id) || !r || typeof r.projectId !== "string" || !r.projectId) throw new Error("The agreements' projects are damaged");
    out[id] = { projectId: r.projectId, ...(r.ended === true ? { ended: true as const } : {}) };
  }
  return out;
}

/** A name for the job's project that isn't taken: the job's title, then "title (2)" and on. */
function freeName(taken: readonly string[], title: string): string {
  const used = new Set(taken.map((n) => n.toLowerCase()));
  if (!used.has(title.toLowerCase())) return title;
  for (let i = 2; ; i++) if (!used.has(`${title} (${i})`.toLowerCase())) return `${title} (${i})`;
}

/**
 * The books with every agreement's project in step: a project for each agreed job that has none,
 * and each project closed once when its job is marked complete or cancelled. Unchanged (the same
 * object) when nothing needs doing.
 */
export function syncAgreementProjects(company: Company): Company {
  let dims = company.dimensions;
  let links: AgreementProjects = company.agreementProjects ?? {};
  let changed = false;
  for (const c of Object.values(company.clients ?? {})) {
    if (!c.customerId || !company.sales.customers.some((x) => x.id === c.customerId)) continue;
    for (const a of agreementsIn(itemsOf(c))) {
      const link = links[a.terms.id];
      if (!link && a.status === "active") {
        const made = addProject(dims, { name: freeName(dims.projects.map((p) => p.name), a.terms.title), customerId: c.customerId });
        dims = made.dims;
        links = { ...links, [a.terms.id]: { projectId: made.project.id } };
        changed = true;
      } else if (link && !link.ended && (a.status === "complete" || a.status === "cancelled")) {
        if (dims.projects.some((p) => p.id === link.projectId && p.status === "active")) dims = updateProject(dims, link.projectId, { status: "closed" });
        links = { ...links, [a.terms.id]: { ...link, ended: true } };
        changed = true;
      }
    }
  }
  return changed ? { ...company, dimensions: dims, agreementProjects: links } : company;
}

/** The project an agreement's invoices are tagged to, if it has one that still exists. */
export function projectForAgreement(company: Pick<Company, "agreementProjects" | "dimensions">, agreementId: string): string | undefined {
  const id = company.agreementProjects?.[agreementId]?.projectId;
  return id && company.dimensions.projects.some((p) => p.id === id) ? id : undefined;
}
