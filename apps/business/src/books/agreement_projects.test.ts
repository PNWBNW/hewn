import { describe, expect, it } from "vitest";
import { createBooks, updateProject } from "@pnw/ledger";
import { addCustomer } from "@pnw/sales";
import { projectForAgreement, syncAgreementProjects } from "./agreement_projects";
import { type Company, companyFromJson, companyToJson, emptyCompany } from "./company";
import type { Connections } from "./connections";
import type { Half } from "./key_ring";
import type { ServiceTerms } from "./service";
import type { ThreadItem } from "./thread";

const CUST = "aleo1" + "a".repeat(58);
const ID = "0123456789abcdef";
const key = (c: string) => "04" + c.repeat(128);
const half = (c: string): Half => ({ publicKey: key(c), privateKey: { kty: "EC", crv: "P-256", x: "x", y: "y", d: "d" } });
let n = 0;
const item = (body: ThreadItem["body"], from: "business" | "worker"): ThreadItem => {
  n++;
  return { version: 1, id: n.toString(16).padStart(32, "0"), from, sentAt: `2026-10-26T10:${String(n % 60).padStart(2, "0")}:00.000Z`, body, mine: from === "business", seq: n };
};
const terms: ServiceTerms = { id: ID, rev: 1, title: "Kitchen sink repair", scope: "Fix the leak", priceKind: "fixed", amount: "3000", startDate: "2026-10-25", closesWhen: "The customer signs off on the work" };
const offered = item({ type: "agreement_offer", terms }, "business");
const accepted = item({ type: "agreement_answer", id: ID, rev: 1, answer: "accept" }, "worker");
const completed = item({ type: "agreement_close", id: ID, reason: "complete" }, "business");

function business(items: ThreadItem[]): Company {
  const base = emptyCompany(createBooks({ businessName: "Hewn Test Business", fiscalYearStartMonth: 1 }));
  const cust = addCustomer(base.sales, { name: "alder_h" });
  const clients: Connections = { [CUST]: { address: CUST, name: "alder_h", nameHash: "42", mine: half("1"), theirs: key("2"), customerId: cust.customer.id, thread: { items, nextIn: 1, nextOut: 1 } } };
  return { ...base, sales: cust.sales, clients };
}

describe("an agreed job's project (Joshua, 2026-10-26)", () => {
  it("is made when the customer accepts, named after the job and tied to the customer", () => {
    const proposed = business([offered]);
    expect(syncAgreementProjects(proposed)).toBe(proposed); // not before it's agreed
    const c = syncAgreementProjects(business([offered, accepted]));
    const project = c.dimensions.projects.find((p) => p.id === projectForAgreement(c, ID));
    expect(project).toMatchObject({ name: "Kitchen sink repair", customerId: c.sales.customers[0]!.id, status: "active" });
    expect(syncAgreementProjects(c)).toBe(c); // once
    expect(companyFromJson(companyToJson(c)).agreementProjects).toEqual(c.agreementProjects);
  });

  it("closes when the job is marked complete, and stays open if the business reopens it", () => {
    let c = syncAgreementProjects(business([offered, accepted]));
    c = syncAgreementProjects({ ...c, clients: { [CUST]: { ...c.clients![CUST]!, thread: { items: [offered, accepted, completed], nextIn: 2, nextOut: 2 } } } });
    const pid = projectForAgreement(c, ID)!;
    expect(c.dimensions.projects.find((p) => p.id === pid)!.status).toBe("closed");
    const reopened = { ...c, dimensions: updateProject(c.dimensions, pid, { status: "active" }) };
    expect(syncAgreementProjects(reopened)).toBe(reopened);
  });

  it("takes a free name when the job's title is already a project", () => {
    const base = business([offered, accepted]);
    const withSame = { ...base, dimensions: { ...base.dimensions, projects: [{ id: "proj-9", name: "Kitchen sink repair", status: "active" as const }], nextProject: 10 } };
    const c = syncAgreementProjects(withSame);
    expect(c.dimensions.projects.find((p) => p.id === projectForAgreement(c, ID))!.name).toBe("Kitchen sink repair (2)");
  });

  it("makes nothing for a job that ended before it had a project", () => {
    const c = business([offered, accepted, completed]);
    expect(syncAgreementProjects(c)).toBe(c);
  });
});
