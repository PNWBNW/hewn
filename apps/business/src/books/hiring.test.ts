import { describe, expect, it } from "vitest";
import { addAccount, createBooks } from "@pnw/ledger";
import { addWorker, postPayRun } from "@pnw/payroll";
import { type Company, companyFromJson, companyToJson, emptyCompany } from "./company";
import { DEFAULT_W4, acceptOffers, dropOffer, hireByOffer, isOfferOut, removeFromTeam, removeProblem } from "./hiring";
import { type Rail, type RailLink, linkFor, linkStatus, registeredFor } from "./rail";

const ADDR = "aleo1" + "q".repeat(58);
const ANA = "aleo1" + "z".repeat(58);
const AGREEMENT = "01".repeat(32);
const KEY = "ab".repeat(32);
const WHO = { address: ANA, nameHash: "456", name: "ana" };

const rail: Rail = { version: 1, network: "testnet", address: ADDR, linkedAt: "2026-10-14T18:00:00.000Z", businessNameHash: "123", businessName: "brothers", links: [] };
const company = (): Company => ({ ...emptyCompany(createBooks({ businessName: "Brothers", fiscalYearStartMonth: 1 })), rail });
// What sendOffer returns, under whatever id the offer was sent with.
const sentLink: RailLink = { workerId: "new", address: ANA, nameHash: "456", agreementId: AGREEMENT, partiesKey: KEY, status: "offered", offeredAt: "2026-10-16T10:00:00.000Z" };
const PAY = { payType: "hourly" as const, rate: 3000n, frequency: "biweekly" as const };

describe("hiring by offer", () => {
  it("keeps someone sent an offer as Offer out: on the books but not active, tied to the offer", () => {
    const { company: c, workerId } = hireByOffer(company(), { name: "Ana Ruiz", who: WHO, pay: PAY, link: sentLink });
    const w = c.payroll.workers.find((x) => x.id === workerId)!;
    expect([w.name, w.active, w.rate, w.w4]).toEqual(["Ana Ruiz", false, 3000n, DEFAULT_W4]);
    expect(linkFor(c.rail!, workerId)).toMatchObject({ workerId, status: "offered", joinsOnAccept: true });
    expect(registeredFor(c.rail, "worker", workerId)).toEqual(WHO);
    expect(isOfferOut(c, workerId)).toBe(true);
    // It survives the vault.
    expect(isOfferOut(companyFromJson(companyToJson(c)), workerId)).toBe(true);
  });

  it("brings them onto the team when they accept, and leaves the rest alone", () => {
    const { company: hired, workerId } = hireByOffer(company(), { name: "Ana Ruiz", who: WHO, pay: PAY, link: sentLink });
    expect(acceptOffers(hired, new Set(["ff".repeat(32)]), "2026-10-17T09:00:00.000Z")).toEqual(hired);
    const c = acceptOffers(hired, new Set([AGREEMENT]), "2026-10-17T09:00:00.000Z");
    expect(c.payroll.workers.find((w) => w.id === workerId)!.active).toBe(true);
    expect(linkStatus(c.rail, "worker", workerId)).toBe("linked");
    expect(linkFor(c.rail!, workerId)).not.toHaveProperty("joinsOnAccept");
    expect(isOfferOut(c, workerId)).toBe(false);
  });

  it("takes them out of the books when the offer is withdrawn", () => {
    const { company: hired, workerId } = hireByOffer(company(), { name: "Ana Ruiz", who: WHO, pay: PAY, link: sentLink });
    const c = dropOffer(hired, workerId);
    expect(c.payroll.workers).toEqual([]);
    expect(c.rail!.links).toEqual([]);
    expect(registeredFor(c.rail, "worker", workerId)).toBeUndefined();
  });

  it("keeps a team member who was already in the books when their offer is withdrawn: typed again", () => {
    const base = company();
    const added = addWorker(base.payroll, { name: "Bo", ...PAY, w4: DEFAULT_W4 });
    const c0: Company = { ...base, payroll: added.payroll, rail: { ...rail, links: [{ ...sentLink, workerId: added.worker.id }] } };
    expect(isOfferOut(c0, added.worker.id)).toBe(false);
    const c = dropOffer(c0, added.worker.id);
    expect(c.payroll.workers.map((w) => w.name)).toEqual(["Bo"]);
    expect(linkStatus(c.rail, "worker", added.worker.id)).toBe("typed");
  });
});

describe("removing a team member", () => {
  it("takes someone never paid out of the books, with what the rail held for them", () => {
    const { company: hired, workerId } = hireByOffer(company(), { name: "Ana Ruiz", who: WHO, pay: PAY, link: sentLink });
    const linked = acceptOffers(hired, new Set([AGREEMENT]), "2026-10-17T09:00:00.000Z");
    expect(removeProblem(linked, workerId)).toBeNull();
    const c = removeFromTeam(linked, workerId);
    expect(c.payroll.workers).toEqual([]);
    expect(c.rail!.links).toEqual([]);
    expect(registeredFor(c.rail, "worker", workerId)).toBeUndefined();
  });

  it("refuses while an offer is out, and for anyone who has been paid", () => {
    const { company: hired, workerId } = hireByOffer(company(), { name: "Ana Ruiz", who: WHO, pay: PAY, link: sentLink });
    expect(removeProblem(hired, workerId)).toMatch(/Withdraw their offer first/);
    expect(() => removeFromTeam(hired, workerId)).toThrow(/Withdraw their offer first/);
    expect(removeProblem(hired, "wkr-404")).toMatch(/not found/);

    const base = company();
    const bank = addAccount(base.books, { name: "Checking", type: "bank" });
    const added = addWorker(base.payroll, { name: "Bo", ...PAY, w4: DEFAULT_W4 });
    const paid = postPayRun(bank.books, added.payroll, {
      payDate: "2026-10-16",
      periodStart: "2026-10-01",
      periodEnd: "2026-10-15",
      bankAccountId: bank.account.id,
      lines: [{ workerId: added.worker.id, hours: 10 }],
    });
    const c: Company = { ...base, books: paid.books, payroll: paid.payroll };
    expect(removeProblem(c, added.worker.id)).toMatch(/deactivate them instead/);
    expect(() => removeFromTeam(c, added.worker.id)).toThrow(/deactivate them instead/);
  });
});

describe("the link's joinsOnAccept", () => {
  it("is true or absent, and only kept while the offer is out", async () => {
    const { validateLink } = await import("./rail");
    expect(validateLink({ ...sentLink, joinsOnAccept: true }).joinsOnAccept).toBe(true);
    expect(() => validateLink({ ...sentLink, joinsOnAccept: "yes" })).toThrow(/true or left out/);
    expect(validateLink({ ...sentLink, status: "linked", joinsOnAccept: true })).not.toHaveProperty("joinsOnAccept");
  });
});
