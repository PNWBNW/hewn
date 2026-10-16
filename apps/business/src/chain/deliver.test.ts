// deliverPaystub against a fake mailbox: what goes in the envelope, where it
// goes, and that the vault's copy only moves once the mailbox has it.
import { describe, expect, it } from "vitest";
import { type Books, applyTemplate, createBooks, emptyDimensions } from "@pnw/ledger";
import { ENVELOPE_VERSION, KINDS, MailboxError, lookupId, open, partiesKeyFromHex } from "@pnw/mailbox";
import { type Payroll, type W4, addWorker, canonicalPaystub, emptyPayroll, ensureRailAccount, markPaycheckSettlement, paystubDocument, postPayRun, yearToDate } from "@pnw/payroll";
import { emptySales } from "@pnw/sales";
import type { Company } from "../books/company";
import { type Rail, linkFor } from "../books/rail";
import { unpackPayload } from "./compress";
import { REIMPORT_MESSAGE, deliverPaystub, paystubEnvelope, recordDelivery } from "./deliver";
import { LETTER_BYTES } from "./letters";

const W4_SINGLE: W4 = { filingStatus: "single", dependentCredit: 0n, otherIncome: 0n, extraDeductions: 0n, extraWithholding: 0n };
const clock = { now: () => "2026-10-16T12:00:00.000Z" };
const SENT_AT = "2026-10-16T12:05:00.000Z";
const now = () => SENT_AT;
const EMPLOYER = "aleo1" + "q".repeat(58);
const WORKER = "aleo1" + "z".repeat(58);
const KEY = "0123456789abcdef".repeat(4);
const TX = "at1yphn8n9zejqnnsktuev7rl9vkv8styq00rjpffa0h7rxnccssyyqdk9ltw";

type Put = { lookup: string; envelope: Uint8Array };

/** A mailbox that answers each put in turn: a status, or a thrown error. */
function fakeClient(...answers: (number | Error)[]) {
  const puts: Put[] = [];
  return {
    puts,
    async put(lookup: string, envelope: Uint8Array) {
      puts.push({ lookup, envelope: new Uint8Array(envelope) });
      const a = answers.shift() ?? 204;
      if (a instanceof Error) throw a;
      if (a === 409) throw new MailboxError("CONFLICT", "taken");
      if (a === 503) throw new MailboxError("NOT_CONFIGURED", "off");
      if (a >= 400) throw new MailboxError("REQUEST_FAILED", `failed (${a})`);
    },
  };
}

function setup({ legacy = false, settle = true } = {}) {
  const partiesKey = legacy ? undefined : KEY;
  let books: Books = applyTemplate(createBooks({ businessName: "Day Construction", fiscalYearStartMonth: 1 }), "service");
  const rail = ensureRailAccount(books);
  books = rail.books;
  let payroll: Payroll = emptyPayroll();
  const ana = addWorker(payroll, { name: "Ana Ruiz", payType: "hourly", rate: 3000n, frequency: "weekly", w4: W4_SINGLE });
  payroll = ana.payroll;
  const posted = postPayRun(
    books,
    payroll,
    { payDate: "2026-10-16", periodStart: "2026-10-10", periodEnd: "2026-10-16", bankAccountId: rail.accountId, mode: "rail", lines: [{ workerId: ana.worker.id, hours: 40 }] },
    clock,
  );
  payroll = settle
    ? markPaycheckSettlement(posted.payroll, posted.run.id, ana.worker.id, { status: "settled", reference: TX, height: 4_210_777, settledAt: clock.now(), feeMicrocredits: 51_580n })
    : posted.payroll;
  const link = { workerId: ana.worker.id, address: WORKER, nameHash: "12345", agreementId: "01020304", status: "linked" as const, ...(partiesKey ? { partiesKey } : {}) };
  const company: Company = {
    books: posted.books,
    payroll,
    sales: emptySales(),
    dimensions: emptyDimensions(),
    rail: { version: 1, network: "testnet", address: EMPLOYER, linkedAt: clock.now(), links: [link] } satisfies Rail,
  };
  return { company, runId: posted.run.id, workerId: ana.worker.id, worker: ana.worker };
}

const paycheckOf = (c: Company, runId: string, workerId: string) => c.payroll.runs.find((r) => r.id === runId)!.paychecks.find((p) => p.workerId === workerId)!;

describe("deliverPaystub", () => {
  it("seals the paystub and its settlement to slot 0, then records the delivery and advances the slot", async () => {
    const { company, runId, workerId, worker } = setup();
    const client = fakeClient(201);
    const result = await deliverPaystub({ company, runId, workerId, client, now });

    // One put, to the lookup both parties can compute, with a version-1 envelope.
    const key = partiesKeyFromHex(KEY);
    expect(client.puts).toHaveLength(1);
    expect(client.puts[0]!.lookup).toBe(lookupId(key, KINDS.paystub, 0));
    expect(client.puts[0]!.envelope[0]).toBe(ENVELOPE_VERSION);

    // The person can open it with the key, the kind and the slot, and nothing else.
    expect(client.puts[0]!.envelope.length).toBeLessThanOrEqual(LETTER_BYTES); // one letter, not a page
    const plain = JSON.parse(new TextDecoder().decode(await unpackPayload(await open(key, KINDS.paystub, 0, client.puts[0]!.envelope))));
    const run = company.payroll.runs[0]!;
    const paycheck = run.paychecks[0]!;
    const doc = paystubDocument(run, paycheck, worker, company.books.settings, yearToDate(company.payroll, workerId, run.payDate, runId));
    expect(plain).toEqual({
      version: 1,
      kind: "paystub",
      document: JSON.parse(canonicalPaystub(doc)),
      settlement: { transactionId: TX, height: 4_210_777, feeMicrocredits: "51580" },
      businessName: "Day Construction",
    });
    expect(plain.document.workerName).toBe("Ana Ruiz");
    expect(plain.document.net).toBe(paycheck.net.toString());
    await expect(open(key, KINDS.paystub, 1, client.puts[0]!.envelope)).rejects.toMatchObject({ code: "TAMPERED" });
    await expect(open(key, KINDS.w4, 0, client.puts[0]!.envelope)).rejects.toMatchObject({ code: "TAMPERED" });

    // The ciphertext carries no names in the clear.
    const wire = new TextDecoder("utf-8", { fatal: false }).decode(client.puts[0]!.envelope);
    expect(wire).not.toContain("Ana");
    expect(wire).not.toContain("Day Construction");
    expect(wire).not.toContain(TX);

    // The vault's copy: delivery on the paycheck, slot advanced on the link, nothing else touched.
    expect(result.slotTaken).toBe(false);
    expect(result.delivery).toEqual({ seq: 0, lookup: client.puts[0]!.lookup, sentAt: SENT_AT });
    expect(paycheckOf(result.company, runId, workerId).delivery).toEqual(result.delivery);
    expect(paycheckOf(result.company, runId, workerId).settlement).toEqual(paycheck.settlement);
    expect(linkFor(result.company.rail!, workerId)!.mailboxSeq).toEqual({ paystub: 1 });
    expect(result.company.books).toBe(company.books);
    expect(paycheckOf(company, runId, workerId).delivery).toBeUndefined(); // the input is not mutated
    expect(linkFor(company.rail!, workerId)!.mailboxSeq).toBeUndefined();
  });

  it("a resend goes to the next slot with a fresh envelope and replaces the record", async () => {
    const { company, runId, workerId } = setup();
    const client = fakeClient(201, 201);
    const first = await deliverPaystub({ company, runId, workerId, client, now });
    const second = await deliverPaystub({ company: first.company, runId, workerId, client, now: () => "2026-10-17T09:00:00.000Z" });
    expect(client.puts.map((p) => p.lookup)).toEqual([lookupId(partiesKeyFromHex(KEY), KINDS.paystub, 0), lookupId(partiesKeyFromHex(KEY), KINDS.paystub, 1)]);
    expect(client.puts[0]!.envelope).not.toEqual(client.puts[1]!.envelope); // fresh IV
    expect(second.delivery).toEqual({ seq: 1, lookup: client.puts[1]!.lookup, sentAt: "2026-10-17T09:00:00.000Z" });
    expect(paycheckOf(second.company, runId, workerId).delivery).toEqual(second.delivery);
    expect(linkFor(second.company.rail!, workerId)!.mailboxSeq).toEqual({ paystub: 2 });
  });

  it("treats a taken slot (409) as delivered and moves on", async () => {
    const { company, runId, workerId } = setup();
    const client = fakeClient(409);
    const result = await deliverPaystub({ company, runId, workerId, client, now });
    expect(client.puts).toHaveLength(1);
    expect(result.slotTaken).toBe(true);
    expect(result.delivery.seq).toBe(0);
    expect(paycheckOf(result.company, runId, workerId).delivery).toEqual(result.delivery);
    expect(linkFor(result.company.rail!, workerId)!.mailboxSeq).toEqual({ paystub: 1 });
    // The next send takes slot 1.
    const next = await deliverPaystub({ company: result.company, runId, workerId, client: fakeClient(201), now });
    expect(next.delivery.seq).toBe(1);
  });

  it("any other failure throws and leaves the company exactly as it was", async () => {
    const { company, runId, workerId } = setup();
    const before = JSON.stringify(company, (_, v) => (typeof v === "bigint" ? v.toString() : v));
    await expect(deliverPaystub({ company, runId, workerId, client: fakeClient(502), now })).rejects.toMatchObject({ code: "REQUEST_FAILED" });
    await expect(deliverPaystub({ company, runId, workerId, client: fakeClient(503), now })).rejects.toMatchObject({ code: "NOT_CONFIGURED" });
    await expect(deliverPaystub({ company, runId, workerId, client: fakeClient(new TypeError("Failed to fetch")), now })).rejects.toThrow(/Failed to fetch/);
    expect(JSON.stringify(company, (_, v) => (typeof v === "bigint" ? v.toString() : v))).toBe(before);
    expect(paycheckOf(company, runId, workerId).delivery).toBeUndefined();
    expect(linkFor(company.rail!, workerId)!.mailboxSeq).toBeUndefined();
  });

  it("refuses to send a paystub that doesn't match the books, before anything leaves", async () => {
    const { company, runId, workerId } = setup();
    const run = company.payroll.runs[0]!;
    const tampered: Company = {
      ...company,
      payroll: { ...company.payroll, runs: [{ ...run, paychecks: [{ ...run.paychecks[0]!, paystubHash: "00".repeat(32) }] }] },
    };
    const client = fakeClient(201);
    await expect(deliverPaystub({ company: tampered, runId, workerId, client, now })).rejects.toThrow(/doesn't match the one the books committed to/);
    // A changed worker name rebuilds to a different document, and so a different hash.
    const renamed: Company = { ...company, payroll: { ...company.payroll, workers: [{ ...company.payroll.workers[0]!, name: "Ana R." }] } };
    await expect(deliverPaystub({ company: renamed, runId, workerId, client, now })).rejects.toThrow(/doesn't match/);
    expect(client.puts).toHaveLength(0);
  });

  it("explains a link without a parties key, and the other things it can't do", async () => {
    const legacy = setup({ legacy: true });
    const client = fakeClient(201);
    await expect(deliverPaystub({ ...legacy, client, now })).rejects.toThrow(REIMPORT_MESSAGE);
    const pending = setup({ settle: false });
    await expect(deliverPaystub({ ...pending, client, now })).rejects.toThrow(/once the pay has settled/);
    const { company, runId, workerId } = setup();
    await expect(deliverPaystub({ company: { ...company, rail: undefined }, runId, workerId, client, now })).rejects.toThrow(/Link Shield/);
    await expect(deliverPaystub({ company, runId, workerId: "wkr-9", client, now })).rejects.toThrow(/no account on the rail/);
    await expect(deliverPaystub({ company, runId: "run-9", workerId, client, now })).rejects.toThrow(/not found/);
    expect(() => paystubEnvelope(company, runId, "wkr-9")).toThrow(/isn't in this pay run/);
    expect(client.puts).toHaveLength(0);
  });

  it("recordDelivery is what the app applies to the latest vault copy", () => {
    const { company, runId, workerId } = setup();
    const delivery = { seq: 4, lookup: "f".repeat(64), sentAt: SENT_AT };
    const applied = recordDelivery(company, runId, workerId, delivery);
    expect(paycheckOf(applied, runId, workerId).delivery).toEqual(delivery);
    expect(linkFor(applied.rail!, workerId)!.mailboxSeq).toEqual({ paystub: 5 });
    expect(() => recordDelivery({ ...company, rail: undefined }, runId, workerId, delivery)).toThrow(/Link Shield/);
  });
});
