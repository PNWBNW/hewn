import { describe, expect, it } from "vitest";
import { billsIn } from "./bill";
import { connectionState, endConnection, noteHelloReceived, noteHelloSent, updateConnectionThread, type Connections, type Hello } from "./connections";
import type { Half } from "./key_ring";
import { agreementsIn, invoiceableAgreements, newServiceId, type ServiceTerms, validateTerms } from "./service";
import { type ThreadItem, addToThread, emptyThread, validateMessage } from "./thread";

const A = "aleo1" + "a".repeat(58);
const key = (c: string) => "04" + c.repeat(128);
const half = (c: string): Half => ({ publicKey: key(c), privateKey: { kty: "EC", crv: "P-256", x: "x", y: "y", d: "d" } });
const hello = (c: string): Hello => ({ v: 1, type: "hello", side: "business", name: "cedar_co", nameHash: "7", publicKey: key(c) });
let n = 0;
const at = (i: number) => `2026-10-26T10:${String(i).padStart(2, "0")}:00.000Z`;
const item = (body: ThreadItem["body"], from: "business" | "worker", mine: boolean): ThreadItem => {
  n++;
  return { version: 1, id: n.toString(16).padStart(32, "0"), from, sentAt: at(n % 60), body, mine, seq: n };
};
const ID = "0123456789abcdef";
const terms = (over: Partial<ServiceTerms> = {}): ServiceTerms => ({ id: ID, rev: 1, title: "Kitchen sink", scope: "Replace the trap and the faucet.", priceKind: "fixed", amount: "45000", startDate: "2026-11-01", closesWhen: "The customer signs off on the work", ...over });
const offer = (t: ServiceTerms) => item({ type: "agreement_offer", terms: t }, "business", false);
const answer = (rev: number, a: "accept" | "changes" | "decline", note?: string) => item({ type: "agreement_answer", id: ID, rev, answer: a, ...(note ? { note } : {}) }, "worker", true);

describe("an agreement for one job", () => {
  it("goes proposed → changes asked → revised → agreed → complete, as the customer's side sees it", () => {
    const items = [offer(terms()), answer(1, "changes", "Can it start sooner?")];
    expect(agreementsIn(items)[0]).toMatchObject({ status: "changes", note: { text: "Can it start sooner?", mine: true } });
    items.push(offer(terms({ rev: 2, startDate: "2026-10-28" })));
    expect(agreementsIn(items)[0]).toMatchObject({ status: "offered", terms: { rev: 2, startDate: "2026-10-28" } });
    items.push(answer(1, "accept")); // an answer to the old revision counts for nothing
    expect(agreementsIn(items)[0]!.status).toBe("offered");
    items.push(answer(2, "accept"));
    expect(agreementsIn(items)[0]!.status).toBe("active");
    expect(invoiceableAgreements(items).map((a) => a.terms.id)).toEqual([ID]);
    items.push(offer(terms({ rev: 3, amount: "99999" }))); // agreed terms can't be changed by a new proposal
    expect(agreementsIn(items)[0]!.terms.rev).toBe(2);
    items.push(item({ type: "agreement_close", id: ID, reason: "complete" }, "business", false));
    expect(agreementsIn(items)[0]!.status).toBe("complete");
    expect(invoiceableAgreements(items)).toHaveLength(1); // a final invoice can still name it
  });

  it("can't be closed before it's agreed, and a declined one isn't invoiceable", () => {
    const items = [offer(terms()), item({ type: "agreement_close", id: ID, reason: "cancelled" }, "worker", true)];
    expect(agreementsIn(items)[0]!.status).toBe("offered");
    items.push(answer(1, "decline"));
    expect(agreementsIn(items)[0]!.status).toBe("declined");
    expect(invoiceableAgreements(items)).toEqual([]);
  });

  it("is proposed only by the business and answered only by the customer", () => {
    const base = { version: 1, id: "f".repeat(32), sentAt: at(1) };
    expect(validateMessage({ ...base, from: "business", body: { type: "agreement_offer", terms: terms() } }, "business").body.type).toBe("agreement_offer");
    expect(() => validateMessage({ ...base, from: "worker", body: { type: "agreement_offer", terms: terms() } }, "worker")).toThrow(/can't send/);
    expect(() => validateMessage({ ...base, from: "business", body: { type: "agreement_answer", id: ID, rev: 1, answer: "accept" } }, "business")).toThrow(/can't send/);
    expect(validateMessage({ ...base, from: "worker", body: { type: "agreement_close", id: ID, reason: "complete" } }, "worker").body.type).toBe("agreement_close");
  });

  it("refuses terms that are damaged", () => {
    expect(() => validateTerms({ ...terms(), amount: "-1" })).toThrow(/amount/);
    expect(() => validateTerms({ ...terms(), endDate: "2026-10-01" })).toThrow(/end date/);
    expect(() => validateTerms({ ...terms(), title: "" })).toThrow(/title/i);
    expect(() => validateTerms({ ...terms(), id: "short" })).toThrow(/id/);
    expect(newServiceId()).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe("disconnecting", () => {
  const connected = (): Connections => noteHelloSent(noteHelloReceived({}, A, hello("2"), at(1)), { address: A, name: "cedar_co", nameHash: "7" }, half("1"), at(2));

  it("ends the link when either side's disconnect is in the conversation, keeping what was said", () => {
    const bill = { v: 1 as const, id: "inv-1", number: "INV-0001", date: "2026-10-20", dueDate: "2026-11-19", lines: [{ description: "Sink", quantity: "1", unitPrice: "100" }], taxRateBp: 0, subtotal: "100", tax: "0", total: "100" };
    let c = updateConnectionThread(connected(), A, (t) => addToThread(t, item({ type: "invoice", bill }, "business", false)), emptyThread);
    expect(connectionState(c[A])).toBe("connected");
    c = updateConnectionThread(c, A, (t) => addToThread(t, { ...item({ type: "disconnect" }, "business", false), receivedAt: at(5) }), emptyThread);
    expect(connectionState(c[A])).toBe("ended");
    expect(c[A]!.mine).toBeUndefined();
    expect(c[A]!.theirs).toBeUndefined();
    expect(billsIn(c).map((b) => b.bill.number)).toEqual(["INV-0001"]); // the bill stays
    // Their old hello, still among the letters, doesn't come back as a request.
    expect(noteHelloReceived(c, A, hello("2"), at(9))).toBe(c);
    // A new hello from them does.
    expect(connectionState(noteHelloReceived(c, A, hello("3"), at(9))[A])).toBe("asked");
  });

  it("ignores their later hellos when I ended it, until I connect again", () => {
    let c = endConnection(connected(), A, { byMe: true, at: at(5) });
    expect(connectionState(c[A])).toBe("ignored");
    c = noteHelloReceived(c, A, hello("3"), at(6));
    expect(connectionState(c[A])).toBe("ignored");
    c = noteHelloSent(c, { address: A, name: "cedar_co", nameHash: "7" }, half("4"), at(7));
    expect(connectionState(c[A])).toBe("connected");
    expect(c[A]!.mine!.publicKey).toBe(key("4")); // a fresh key, not the old one
  });
});
