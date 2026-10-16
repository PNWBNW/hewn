// Receipts end to end with a fake mailbox: the receiver seals one, the sender
// reads it, keeps the time and drops it; and what each side waits on.
import { describe, expect, it } from "vitest";
import { KINDS, MailboxError, partiesKeyFromHex, receiptLookup } from "@pnw/mailbox";
import type { Payroll } from "@pnw/payroll";
import type { Rail, RailLink } from "../books/rail";
import { emptyWork, type Work } from "../books/work";
import { offerFileKind } from "./offer_files";
import { businessAwaiting, offerReceiptSlot, readReceipts, recordBusinessReceipts, recordWorkReceipts, sendReceipt, workAwaiting } from "./receipts";

const KEY = "ab".repeat(32);
const OTHER = "cd".repeat(32);
const OFFER_HASH = "ef".repeat(32);
const NOW = new Date("2026-10-16T18:00:00.000Z");
const ADDRESS = "aleo1" + "q".repeat(58);

type Put = { lookup: string; envelope: Uint8Array; keepUntil?: string };
function fakeMailbox(answer?: MailboxError) {
  const slots = new Map<string, Uint8Array<ArrayBuffer>>();
  const puts: Put[] = [];
  const dropped: string[] = [];
  const order: string[] = [];
  return {
    slots,
    puts,
    dropped,
    order,
    async put(lookup: string, envelope: Uint8Array, options?: { keepUntil?: string }) {
      if (answer) throw answer;
      puts.push({ lookup, envelope, ...(options?.keepUntil ? { keepUntil: options.keepUntil } : {}) });
      slots.set(lookup, new Uint8Array(envelope));
    },
    async get(lookup: string) {
      if (answer) throw answer;
      return slots.get(lookup) ?? null;
    },
    async drop(lookup: string) {
      order.push("drop");
      dropped.push(lookup);
      slots.delete(lookup);
    },
  };
}

describe("sending a receipt", () => {
  it("seals it at the receipt's address, kept 60 days", async () => {
    const box = fakeMailbox();
    expect(await sendReceipt(box, KEY, KINDS.paystub, 2, NOW)).toBe(true);
    expect(box.puts).toHaveLength(1);
    expect(box.puts[0]!.lookup).toBe(receiptLookup(partiesKeyFromHex(KEY), KINDS.paystub, 2));
    expect(box.puts[0]!.keepUntil).toBe("2026-12-15");
  });

  it("never throws: a taken slot means it went out before, anything else is just not sent", async () => {
    expect(await sendReceipt(fakeMailbox(new MailboxError("CONFLICT", "taken")), KEY, KINDS.paystub, 2, NOW)).toBe(true);
    expect(await sendReceipt(fakeMailbox(new MailboxError("NOT_CONFIGURED", "off")), KEY, KINDS.paystub, 2, NOW)).toBe(false);
    expect(await sendReceipt(fakeMailbox(), "not a key", KINDS.paystub, 2, NOW)).toBe(false);
  });
});

describe("reading receipts", () => {
  const waiting = [
    { partiesKey: KEY, kind: KINDS.paystub, seq: 0, target: "first" },
    { partiesKey: KEY, kind: KINDS.paystub, seq: 1, target: "second" },
  ];

  it("hands each one found to the vault, then drops it; the rest stay waiting", async () => {
    const box = fakeMailbox();
    await sendReceipt(box, KEY, KINDS.paystub, 1, NOW);
    const recorded: unknown[] = [];
    const r = await readReceipts(box, waiting, async (heard) => {
      box.order.push("record");
      recorded.push(...heard);
    });
    expect(r).toEqual({ heard: [{ target: "second", receivedAt: NOW.toISOString() }], off: false });
    expect(recorded).toEqual(r.heard);
    expect(box.order).toEqual(["record", "drop"]);
    expect(box.slots.size).toBe(0);
  });

  it("leaves alone a receipt sealed with another key, and records nothing", async () => {
    const box = fakeMailbox();
    const theirs = fakeMailbox();
    await sendReceipt(theirs, OTHER, KINDS.paystub, 0, NOW);
    // Put the other agreement's receipt where this one's would be.
    box.slots.set(receiptLookup(partiesKeyFromHex(KEY), KINDS.paystub, 0), theirs.puts[0]!.envelope as Uint8Array<ArrayBuffer>);
    let called = false;
    const r = await readReceipts(box, waiting, async () => {
      called = true;
    });
    expect(r.heard).toEqual([]);
    expect(called).toBe(false);
    expect(box.dropped).toEqual([]);
  });

  it("stops and says so when the mailbox is off or fails", async () => {
    const record = async () => {};
    expect(await readReceipts(fakeMailbox(new MailboxError("NOT_CONFIGURED", "off")), waiting, record)).toEqual({ heard: [], off: true });
    expect(await readReceipts(fakeMailbox(new MailboxError("REQUEST_FAILED", "failed (502)")), waiting, record)).toEqual({ heard: [], off: false, failed: "failed (502)" });
  });
});

describe("what the business waits to hear about", () => {
  const terms = {
    version: 2 as const,
    kind: "terms" as const,
    agreementId: OFFER_HASH,
    termsText: "Carpenter.",
    payType: "hourly" as const,
    rate: "3000",
    frequency: "biweekly" as const,
    startDate: "2026-11-02",
    businessName: "Day Construction",
    offeredAt: "2026-10-16T18:00:00.000Z",
    expiresAt: "2026-10-23T18:00:00.000Z",
    letter: { description: "", requirements: "", handbook: "", other: "" },
    files: [],
  };
  const offered: RailLink = { workerId: "wkr-1", address: ADDRESS, nameHash: "1", agreementId: "01".repeat(32), partiesKey: KEY, status: "offered", offeredAt: terms.offeredAt, terms };
  const linked: RailLink = { workerId: "wkr-2", address: ADDRESS, nameHash: "2", agreementId: "02".repeat(32), partiesKey: OTHER, status: "linked" };
  const rail: Rail = { version: 1, network: "testnet", address: ADDRESS, linkedAt: "2026-10-01T00:00:00.000Z", links: [offered, linked] };
  const delivery = { seq: 3, lookup: "aa".repeat(32), sentAt: "2026-10-16T19:00:00.000Z" };
  const payroll = {
    runs: [
      {
        id: "run-1",
        paychecks: [
          { workerId: "wkr-2", delivery },
          { workerId: "wkr-1" },
        ],
      },
    ],
  } as unknown as Payroll;

  it("is an offer still waiting (its own kind, slot 0) and each paystub delivered", () => {
    expect(offerReceiptSlot(OFFER_HASH)).toEqual({ kind: offerFileKind(OFFER_HASH), seq: 0 });
    expect(businessAwaiting({ rail, payroll })).toEqual([
      { partiesKey: KEY, kind: offerFileKind(OFFER_HASH), seq: 0, target: { kind: "offer", workerId: "wkr-1", agreementId: offered.agreementId } },
      { partiesKey: OTHER, kind: KINDS.paystub, seq: 3, target: { kind: "paystub", runId: "run-1", workerId: "wkr-2", seq: 3 } },
    ]);
    expect(businessAwaiting({ rail: undefined, payroll })).toEqual([]);
  });

  it("stops once heard, and the receipts land on the offer and the paystub", async () => {
    const company = { rail, payroll } as Parameters<typeof recordBusinessReceipts>[0];
    const heard = [
      { target: { kind: "offer" as const, workerId: "wkr-1", agreementId: offered.agreementId }, receivedAt: "2026-10-16T20:00:00.000Z" },
    ];
    const after = recordBusinessReceipts(company, heard);
    expect(after.rail!.links.find((l) => l.workerId === "wkr-1")!.offerReceivedAt).toBe("2026-10-16T20:00:00.000Z");
    expect(businessAwaiting(after)).toHaveLength(1);
  });
});

describe("what the person waits to hear about", () => {
  it("is each week of hours sent, until its receipt arrives", () => {
    const base = emptyWork("Ana");
    const work: Work = {
      ...base,
      agreements: [{ agreementId: "01".repeat(32), partiesKey: KEY, employerAddress: ADDRESS, employerNameHash: "1", status: "active" }],
      timesheets: [{ agreementId: "01".repeat(32), weekStart: "2026-10-12", seq: 4, lookup: "bb".repeat(32), totalMinutes: 480, sentAt: "2026-10-16T18:00:00.000Z" }],
    };
    expect(workAwaiting(work)).toEqual([{ partiesKey: KEY, kind: "timesheet", seq: 4, target: { kind: "timesheet", agreementId: "01".repeat(32), seq: 4 } }]);
    const heard = recordWorkReceipts(work, [{ target: { kind: "timesheet", agreementId: "01".repeat(32), seq: 4 }, receivedAt: "2026-10-17T09:00:00.000Z" }]);
    expect(heard.timesheets[0]!.receivedAt).toBe("2026-10-17T09:00:00.000Z");
    expect(workAwaiting(heard)).toEqual([]);
  });
});
