import { describe, expect, it, vi } from "vitest";
import { createBooks } from "@pnw/ledger";
import { type Company, emptyCompany } from "../books/company";
import { hireByOffer } from "../books/hiring";
import { type Rail, type RailLink, linkStatus } from "../books/rail";
import { checkAcceptances } from "./acceptance";
import { bytesToAleoU8Array } from "./offer";
import { AGREEMENT_PROGRAMS, AGREEMENT_V5, halfToInput } from "./agreement_programs";
import { newHalf } from "./key_ring";
import { isTwinSealed } from "../books/key_ring";

const ADDR = "aleo1" + "q".repeat(58);
const ANA = "aleo1" + "z".repeat(58);
const AGREEMENT = "01".repeat(32);
const OTHER = "02".repeat(32);
const KEY = "ab".repeat(32);
const AT = "2026-10-19T21:00:00.000Z";

const rail: Rail = { version: 1, network: "testnet", address: ADDR, linkedAt: "2026-10-14T18:00:00.000Z", businessNameHash: "123", businessName: "brothers", links: [] };
const sentLink: RailLink = { workerId: "new", address: ANA, nameHash: "456", agreementId: AGREEMENT, partiesKey: KEY, status: "offered", offeredAt: "2026-10-16T10:00:00.000Z" };
const PAY = { payType: "hourly" as const, rate: 3000n, frequency: "biweekly" as const };

/** A company with Ana hired by an offer that is still waiting. */
function hired(): { company: Company; workerId: string } {
  const base: Company = { ...emptyCompany(createBooks({ businessName: "Brothers", fiscalYearStartMonth: 1 })), rail };
  return hireByOffer(base, { name: "Ana Ruiz", who: { address: ANA, nameHash: "456", name: "ana" }, pay: PAY, link: sentLink });
}

const record = (name: string, agreementId: string, spent = false) => ({
  recordName: name,
  spent,
  recordPlaintext: `{\n  owner: ${ADDR}.private,\n  agreement_id: ${bytesToAleoU8Array(agreementId)}.private,\n  worker_address: ${ANA}.private\n}`,
});

/** A vault that applies each update to the company it holds. */
function vault(initial: Company) {
  let company = initial;
  return {
    get: () => company,
    updateCompany: vi.fn(async (fn: (c: Company) => Company) => {
      company = fn(company);
    }),
  };
}

describe("checkAcceptances", () => {
  it("links a waiting offer whose FinalAgreement is in the account, brings the hire onto the team, and names them", async () => {
    const { company, workerId } = hired();
    const v = vault(company);
    const requestRecords = vi.fn(async () => [record("FinalAgreement", AGREEMENT), record("FinalAgreement", OTHER), null]);
    const r = await checkAcceptances({ rail: company.rail, payroll: company.payroll, requestRecords, updateCompany: v.updateCompany, now: () => AT });
    expect(r).toEqual({ accepted: ["Ana Ruiz"] });
    // Every agreement program the app reads (v4, and v5 once offers go there).
    expect(requestRecords.mock.calls).toEqual(AGREEMENT_PROGRAMS.map((p) => [p, true]));
    expect(linkStatus(v.get().rail, "worker", workerId)).toBe("linked");
    expect(v.get().rail!.links[0]!.linkedAt).toBe(AT);
    expect(v.get().payroll.workers.find((w) => w.id === workerId)!.active).toBe(true);
  });

  it("leaves a waiting offer alone while the account holds no final record for it", async () => {
    const { company, workerId } = hired();
    const v = vault(company);
    // The pending copy is the worker's; a spent final, or one for another agreement, is not an acceptance.
    const requestRecords = vi.fn(async () => [record("PendingAgreement", AGREEMENT), record("FinalAgreement", AGREEMENT, true), record("FinalAgreement", OTHER)]);
    const r = await checkAcceptances({ rail: company.rail, payroll: company.payroll, requestRecords, updateCompany: v.updateCompany });
    expect(r).toEqual({ accepted: [] });
    expect(v.updateCompany).not.toHaveBeenCalled();
    expect(linkStatus(v.get().rail, "worker", workerId)).toBe("offered");
  });

  it("asks Shield for nothing while no offer is waiting", async () => {
    const { company } = hired();
    const linked: Company = { ...company, rail: { ...rail, links: [{ ...sentLink, status: "linked", linkedAt: AT }] } };
    const requestRecords = vi.fn(async () => []);
    const v = vault(linked);
    expect(await checkAcceptances({ rail: linked.rail, payroll: linked.payroll, requestRecords, updateCompany: v.updateCompany })).toEqual({ accepted: [] });
    expect(await checkAcceptances({ rail: null, payroll: linked.payroll, requestRecords, updateCompany: v.updateCompany })).toEqual({ accepted: [] });
    expect(requestRecords).not.toHaveBeenCalled();
  });

  it("passes a wallet refusal on, with the vault untouched", async () => {
    const { company } = hired();
    const v = vault(company);
    const requestRecords = vi.fn(async () => {
      throw new Error("Shield is locked");
    });
    await expect(checkAcceptances({ rail: company.rail, payroll: company.payroll, requestRecords, updateCompany: v.updateCompany })).rejects.toThrow(/Shield is locked/);
    expect(v.updateCompany).not.toHaveBeenCalled();
  });
});

describe("a v5 acceptance", () => {
  it("seeds the conversation's pair from this business's half and the worker's in the record", async () => {
    const mine = await newHalf();
    const theirs = (await newHalf()).publicKey;
    const base: Company = { ...emptyCompany(createBooks({ businessName: "Brothers", fiscalYearStartMonth: 1 })), rail };
    const { company } = hireByOffer(base, { name: "Ana Ruiz", who: { address: ANA, nameHash: "456", name: "ana" }, pay: PAY, link: { ...sentLink, program: AGREEMENT_V5, half: mine } });
    const v = vault(company);
    const final = { recordName: "FinalAgreement", spent: false, recordPlaintext: `{\n  owner: ${ADDR}.private,\n  agreement_id: ${bytesToAleoU8Array(AGREEMENT)}.private,\n  worker_half: ${halfToInput(theirs)}.private\n}` };
    const requestRecords = vi.fn(async () => [final]);
    await checkAcceptances({ rail: v.get().rail, payroll: v.get().payroll, requestRecords, updateCompany: v.updateCompany, now: () => AT });
    const ring = v.get().mailbox?.threads?.[KEY]?.ring;
    expect(isTwinSealed(ring)).toBe(true);
    expect(ring?.pairs[0]).toMatchObject({ mine, theirs, createdAt: AT });
    expect(linkStatus(v.get().rail!, "worker", v.get().rail!.links[0]!.workerId)).toBe("linked");
  });
});
