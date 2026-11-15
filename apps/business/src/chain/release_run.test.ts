// A rail run released the way the pay panel releases it (`releaseRun`), with no screen: the books
// of one or more devices, a pretend Shield on each, one account on a pretend chain
// (release_test_helpers.ts). What is checked is what the books are told and what the chain holds.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PROGRAMS } from "@pnw/config/programs";
import { ensureRailAccount, markPaycheckSettlement, postPayRun } from "@pnw/payroll";
import { NOTHING_PAID, NOT_PAID, type PayQueueEvent, centsToMinor, liveLines, recordTag } from "@pnw/rail";
import type { Company } from "../books/company";
import { deliverPaystub } from "./deliver";
import { LETTERS_PROGRAM, LetterBox, SEND_FUNCTION } from "./letters";
import { PAY_AGAIN_NOTE } from "./pay_outcome";
import { IN_PROGRESS, MARKED_FIRST, NOT_FROM_HERE, NOT_YET, OTHER_AMOUNT, type ReleaseContext, payAgain, promptSummary, releaseRun, settleTo } from "./release";
import { type Behaviour, Chain, type Device, type Shield, USERNAME, VirtualTime, firstDevice, postedRun, tree } from "./release_test_helpers";
import { markerDesk, sealOf } from "./run_marker";

type Start = ReturnType<typeof postedRun>;
const USDCX = PROGRAMS.external.usdcx;
const MIN = 60_000;

/** The account's run markers as one device reads and sends them. */
const desk = (chain: Chain, device: Device, shield: Shield) =>
  markerDesk({
    wallet: shield,
    address: chain.address,
    username: USERNAME,
    seal: sealOf(device.session),
    execute: { sleep: chain.vt.sleep, now: chain.vt.clock.now, pollMs: 2_000 },
    wait: { sleep: chain.vt.sleep, now: chain.vt.clock.now },
  });

const context = (chain: Chain, device: Device, shield: Shield, start: Start) => ({
  wallet: shield,
  network: chain.network,
  runId: start.runId,
  links: start.links,
  updateCompany: device.updateCompany,
  lookup: { wallet: shield, decrypt: chain.decrypt, shieldWaitMs: 50 },
  queue: { clock: chain.vt.clock, sleep: chain.vt.sleep, tree },
});

/** One release on one device: the pay panel's call, with the paystubs noted instead of sent. */
function release(chain: Chain, device: Device, shield: Shield, start: Start, extra: Partial<ReleaseContext> = {}) {
  const delivered: string[] = [];
  const errors: unknown[] = [];
  const held = new Map<string, string>();
  const events: PayQueueEvent[] = [];
  const done = releaseRun({
    ...context(chain, device, shield, start),
    markers: desk(chain, device, shield),
    deliver: async (workerId) => void delivered.push(workerId),
    onError: (e) => errors.push(e),
    onHeld: (workerId, why) => void held.set(workerId, why),
    onEvent: (e) => events.push(e),
    ...extra,
  });
  return { done, delivered, errors, held, events };
}

/** How many payments reached each person in the run, in the run's order. */
const paidEach = (chain: Chain, start: Start) => start.workers.map((w) => chain.paid(start.links.get(w)!).length);
/** What Shield does with the nth payment it is asked for (0-based); letters go through. */
const onPayment = (pick: (nth: number) => Behaviour) => {
  let n = 0;
  return (call: { program: string }): Behaviour => (call.program === USDCX ? pick(n++) : "ok");
};

const float = centsToMinor(50_000_00n);

/** A repeatable stream of numbers from 0 up to 1 (mulberry32), so a sweep draws the same orderings every time. */
const seeded = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

/** A run posted on the phone, and the books as they were saved before anything was released. */
async function posted(people: number, deposits: bigint[] = [float]) {
  const vt = new VirtualTime();
  const chain = new Chain(vt, deposits);
  const start = postedRun(people);
  const phone = await firstDevice(start.company);
  const saved: Company = structuredClone(start.company);
  return { vt, chain, start, phone, saved };
}

/** The same run in books that number it and its people differently, as a copy rebuilt on another device can. */
function renumbered(start: Start): Start {
  const other = (id: string) => `${id}-b`;
  const company = structuredClone(start.company);
  company.payroll = {
    ...company.payroll,
    workers: company.payroll.workers.map((w) => ({ ...w, id: other(w.id) })),
    runs: company.payroll.runs.map((r) => ({ ...r, id: other(r.id), paychecks: r.paychecks.map((p) => ({ ...p, workerId: other(p.workerId) })) })),
  };
  company.rail = { ...company.rail!, links: company.rail!.links.map((l) => ({ ...l, workerId: other(l.workerId) })) };
  return { company, runId: other(start.runId), workers: start.workers.map(other), links: new Map([...start.links].map(([w, to]) => [other(w), to])) };
}

/** A posted run of `n` people with an hour each, paid to `n` accounts of their own (the helper's repeat after 32). */
function manyAccounts(n: number): Start {
  const base = postedRun(n, undefined, () => 1);
  const letters = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
  const company = structuredClone(base.company);
  company.rail = { ...company.rail!, links: company.rail!.links.map((l, i) => ({ ...l, address: `aleo1${letters[(i + 1) % 32]!}${letters[Math.floor((i + 1) / 32)]!}${"q".repeat(56)}` })) };
  return { ...base, company, links: new Map(company.rail.links.map((l) => [l.workerId, l.address])) };
}

describe("releaseRun: what the books are told", () => {
  it("a three-person run settles each paycheck through releaseRun: its record's tag, then Shield's id, then settled", async () => {
    const vt = new VirtualTime();
    const chain = new Chain(vt, [float]);
    const start = postedRun(3);
    const device = await firstDevice(start.company);
    const shield = chain.shield();
    const run = release(chain, device, shield, start);
    const out = await vt.run(run.done);

    expect(out.stalled).toBe(false);
    expect(run.errors).toEqual([]);
    expect(paidEach(chain, start)).toEqual([1, 1, 1]);
    for (const workerId of start.workers) {
      const writes = device.writes.filter((w) => w.workerId === workerId).map((w) => w.settlement);
      // Before Shield is asked: the record it will spend, and the height the payment was first asked at.
      const kept = writes.findIndex((w) => w.attempt !== undefined);
      expect(writes[kept]).toMatchObject({ status: "pending" });
      expect(writes[kept]!.attempt).toMatch(/^[0-9a-f]{32}$/);
      expect(writes[kept]!.since).toBeGreaterThanOrEqual(4_000_000);
      expect(writes.slice(0, kept + 1).every((w) => w.reference === undefined)).toBe(true);
      // Once Shield took it: its own id for the request, with the same record.
      const sent = writes.findIndex((w) => w.reference !== undefined);
      expect(sent).toBeGreaterThan(kept);
      expect(writes[sent]).toMatchObject({ status: "pending", attempt: writes[kept]!.attempt });
      expect(writes[sent]!.reference).toMatch(/^shield_/);
      // Then the transaction the chain holds, its block and the fee paid.
      expect(writes.at(-1)).toMatchObject({ status: "settled", reference: chain.paid(start.links.get(workerId)!)[0]!.id, feeMicrocredits: 51_580n });
      expect(writes.at(-1)!.height).toBeGreaterThanOrEqual(4_000_000);
      expect(writes.at(-1)!.attempt).toBeUndefined();
    }
    expect(device.settlements.map((s) => s.status)).toEqual(["settled", "settled", "settled"]);
    // Each paystub goes once its paycheck is written settled, in the run's order, after the payments.
    expect(run.delivered).toEqual(start.workers);
  });

  it("says what Shield will be asked before it is asked, hands on every event, and calls onPaid before the paystubs", async () => {
    const vt = new VirtualTime();
    const chain = new Chain(vt, [float]);
    const start = postedRun(2);
    const device = await firstDevice(start.company);
    const shield = chain.shield();
    const order: string[] = [];
    const run = release(chain, device, shield, start, {
      onPrompts: (prompts) => order.push(`prompts ${prompts.map((p) => p.kind).join(",")} after ${shield.calls.length} calls`),
      onEvent: (e) => order.push(e.kind),
      onPaid: () => void order.push("paid"),
      deliver: async () => void order.push("paystub"),
    });
    await vt.run(run.done);
    expect(order[0]).toBe("prompts marker,payment,payment,paystub,paystub after 0 calls");
    expect(order.filter((o) => o === "settled")).toHaveLength(2);
    expect(order.slice(-3)).toEqual(["paid", "paystub", "paystub"]);
  });

  it("an approval left to expire writes failed with its record kept, and the people after it are left as they were", async () => {
    const vt = new VirtualTime();
    const chain = new Chain(vt, [float]);
    const start = postedRun(3);
    const device = await firstDevice(start.company);
    const shield = chain.shield();
    shield.behaviour = onPayment((nth) => (nth === 1 ? "expired" : "ok"));
    const out = await vt.run(release(chain, device, shield, start).done);

    expect(out.stalled).toBe(true);
    const [first, second, third] = device.settlements;
    expect(first!.status).toBe("settled");
    expect(second).toMatchObject({ status: "failed", failure: "Approval expired. Request a fresh action." });
    expect(second!.attempt).toMatch(/^[0-9a-f]{32}$/);
    expect(third).toEqual({ status: "pending", marker: second!.marker });
    expect(paidEach(chain, start)).toEqual([1, 0, 0]);
  });

  it("a request Shield turned down is written not confirmed, never failed, with its record kept", async () => {
    const vt = new VirtualTime();
    const chain = new Chain(vt, [float]);
    const start = postedRun(2);
    const device = await firstDevice(start.company);
    const shield = chain.shield();
    shield.behaviour = onPayment(() => "declined");
    const run = release(chain, device, shield, start);
    await vt.run(run.done);
    const [first, second] = device.settlements;
    expect(first!.status).toBe("pending");
    expect(first!.failure).toMatch(/Shield reported a problem \(User rejected the request\)/);
    expect(first!.attempt).toMatch(/^[0-9a-f]{32}$/);
    expect(first!.endedAt).toBeDefined();
    expect(second).toEqual({ status: "pending", marker: first!.marker });
    expect(run.delivered).toEqual([]);
  });

  it("a run the account can't cover is refused before Shield is asked: releaseRun throws, and nothing is written", async () => {
    const vt = new VirtualTime();
    const chain = new Chain(vt, [centsToMinor(100_00n)]);
    const start = postedRun(2);
    const device = await firstDevice(start.company);
    const shield = chain.shield();
    const run = release(chain, device, shield, start);
    await expect(vt.run(run.done)).rejects.toThrow(/short|enough|cover/i);
    expect(shield.calls).toEqual([]);
    expect(device.writes).toEqual([]);
    expect(run.delivered).toEqual([]);
  });
});

describe("settleTo", () => {
  it("never touches a settled paycheck", () => {
    const start = postedRun(1);
    const [w] = start.workers as [string];
    const settled = markPaycheckSettlement(start.company.payroll, start.runId, w, { status: "settled", reference: "at1" + "q".repeat(58) });
    expect(settleTo(settled, start.runId, w, { status: "failed", failure: "late news" })).toBe(settled);
    expect(settleTo(settled, start.runId, w, { status: "pending", attempt: "ab".repeat(16) })).toBe(settled);
    expect(settleTo(settled, start.runId, "nobody", { status: "settled" })).toBe(settled);
  });

  it("takes a failed paycheck back to pending on the way to anything else, and notes nothing when there is nothing to note", () => {
    const start = postedRun(1);
    const [w] = start.workers as [string];
    const failed = markPaycheckSettlement(start.company.payroll, start.runId, w, { status: "failed", failure: "no" });
    const of = (p: typeof failed) => p.runs[0]!.paychecks[0]!.settlement;
    expect(of(settleTo(failed, start.runId, w, { status: "pending" }))).toEqual({ status: "pending" });
    expect(of(settleTo(failed, start.runId, w, { status: "pending", attempt: "ab".repeat(16) }))).toEqual({ status: "pending", attempt: "ab".repeat(16) });
    expect(of(settleTo(failed, start.runId, w, { status: "settled", reference: "at1x" }))).toEqual({ status: "settled", reference: "at1x" });
    expect(settleTo(start.company.payroll, start.runId, w, { status: "pending" })).toBe(start.company.payroll);
  });

  it("carries the marker a device sent and the record a paycheck gave up until it settles, whatever a write leaves out", () => {
    const start = postedRun(1);
    const [w] = start.workers as [string];
    const [marker, old, tag] = ["aa".repeat(16), "bb".repeat(16), "cc".repeat(16)];
    const of = (p: typeof start.company.payroll) => p.runs[0]!.paychecks[0]!.settlement;
    let payroll = settleTo(start.company.payroll, start.runId, w, { status: "pending", marker });
    expect(of(payroll)).toEqual({ status: "pending", marker });
    payroll = settleTo(payroll, start.runId, w, { status: "pending", attempt: old, since: 7 });
    expect(of(payroll)).toEqual({ status: "pending", attempt: old, since: 7, marker });
    payroll = settleTo(payroll, start.runId, w, { status: "failed", failure: PAY_AGAIN_NOTE, replaces: old });
    expect(of(payroll)).toEqual({ status: "failed", failure: PAY_AGAIN_NOTE, replaces: old, marker });
    // A retry: back to pending, and still carrying both.
    payroll = settleTo(payroll, start.runId, w, { status: "pending", attempt: tag });
    expect(of(payroll)).toEqual({ status: "pending", attempt: tag, replaces: old, marker });
    payroll = settleTo(payroll, start.runId, w, { status: "pending", attempt: tag, failure: "No answer", reference: "shield_1" });
    expect(of(payroll)).toMatchObject({ replaces: old, marker });
    // A record never takes its own place: holding the old record again drops the note that it was given up.
    expect(of(settleTo(payroll, start.runId, w, { status: "pending", attempt: old }))).toEqual({ status: "pending", attempt: old, marker });
    // Settled: neither is kept.
    expect(of(settleTo(payroll, start.runId, w, { status: "settled", reference: "at1x" }))).toEqual({ status: "settled", reference: "at1x" });
  });
});

describe("the run's marker", () => {
  it("12 people from one deposit: 25 prompts, the calls Shield receives: 1 note to the account itself, 12 payments, then 12 paystubs", async () => {
    const { vt, chain, start, phone } = await posted(12);
    const shield = chain.shield();
    let said: readonly { kind: string; program: string; fn: string }[] = [];
    const run = release(chain, phone, shield, start, {
      onPrompts: (prompts) => (said = prompts),
      deliver: async (workerId) => {
        const client = new LetterBox({ wallet: shield, to: start.links.get(workerId)!, execute: { sleep: vt.sleep, now: vt.clock.now, pollMs: 2_000 } });
        phone.company = (await deliverPaystub({ company: phone.company, runId: start.runId, workerId, client })).company;
      },
    });
    await vt.run(run.done);
    expect(said.map((p) => p.kind)).toEqual(["marker", ...Array<string>(12).fill("payment"), ...Array<string>(12).fill("paystub")]);
    expect(shield.calls.map((c) => [c.program, c.function])).toEqual(said.map((p) => [p.program, p.fn]));
    expect(shield.calls[0]).toMatchObject({ program: LETTERS_PROGRAM, function: SEND_FUNCTION });
    expect(shield.calls[0]!.inputs[0]).toBe(chain.address);
    expect(shield.approvals).toBe(25);
    expect(promptSummary(said as Parameters<typeof promptSummary>[0])).toBe(
      "Shield will ask you about 25 times, one at a time (for 1 note to your own account, then 12 payments, then 12 paystubs), and may ask a few more or fewer.",
    );
    expect(paidEach(chain, start)).toEqual(Array<number>(12).fill(1));
  });

  it("is accepted before the first payment is asked for, names the first payment's record and no other, and is sent once", async () => {
    const { vt, chain, start, phone } = await posted(3);
    const shield = chain.shield();
    await vt.run(release(chain, phone, shield, start).done);
    const letter = chain.txs.findIndex((t) => t.fn === SEND_FUNCTION);
    expect(letter).toBe(0);
    expect(chain.txs.filter((t) => t.fn === SEND_FUNCTION)).toHaveLength(1);
    const listed = await desk(chain, phone, shield).read();
    expect(listed).toHaveLength(1);
    const { marker } = listed[0]!;
    expect([marker.from, marker.until]).toEqual(["2026-11-07", "2026-11-13"]);
    expect(marker.lines.map((l) => [l.to, l.minor])).toEqual(start.workers.map((w, i) => [start.links.get(w), centsToMinor(phone.company.payroll.runs[0]!.paychecks[i]!.net)]));
    expect(marker.lines.map((l) => l.tag !== undefined)).toEqual([true, false, false]);
    expect(marker.lines[0]!.tag).toBe(await recordTag(shield.payments[0]!.inputs[2]!));
    // A second release of the same run, with everyone paid, asks nothing and sends nothing.
    const again = chain.shield();
    await vt.run(release(chain, phone, again, start).done);
    expect(again.calls).toEqual([]);
  });

  it("the marker declined: nothing is paid, and the first line says so without keeping a record", async () => {
    const { vt, chain, start, phone } = await posted(3);
    const shield = chain.shield();
    shield.behaviour = (_call, n) => (n === 0 ? "declined" : "ok");
    const out = await vt.run(release(chain, phone, shield, start).done);
    expect(out.stalled).toBe(true);
    expect(shield.payments).toEqual([]);
    expect(chain.txs).toEqual([]);
    const [first, second] = phone.settlements;
    expect(first!.status).toBe("failed");
    expect(first!.failure!.startsWith(`${NOTHING_PAID}: `)).toBe(true);
    expect(first!.attempt).toBeUndefined();
    expect(second!.status).toBe("pending");
    // Tried again and approved: one marker, everyone paid once.
    shield.behaviour = () => "ok";
    await vt.run(release(chain, phone, shield, start).done);
    expect(chain.txs.filter((t) => t.fn === SEND_FUNCTION)).toHaveLength(1);
    expect(paidEach(chain, start)).toEqual([1, 1, 1]);
  });

  it("the marker landed, then Shield threw: the run goes on, with one marker", async () => {
    const { vt, chain, start, phone } = await posted(3);
    const shield = chain.shield({ lagMs: 0 });
    shield.behaviour = (_call, n) => (n === 0 ? "landed, then threw" : "ok");
    await vt.run(release(chain, phone, shield, start).done);
    expect(chain.txs.filter((t) => t.fn === SEND_FUNCTION)).toHaveLength(1);
    expect(paidEach(chain, start)).toEqual([1, 1, 1]);
    expect(shield.lettersSent).toHaveLength(1);
  });

  it("two people paid to one account: the run is refused before anything is asked or written", async () => {
    const { vt, chain, start, phone } = await posted(3);
    const shield = chain.shield();
    const links = new Map(start.links).set(start.workers[2]!, start.links.get(start.workers[0]!)!);
    await expect(vt.run(release(chain, phone, shield, start, { links }).done)).rejects.toThrow(/same account/);
    expect(shield.calls).toEqual([]);
    expect(phone.writes).toEqual([]);
  });

  it("a release that can't read the account's letters pays nothing", async () => {
    const { vt, chain, start, phone } = await posted(2);
    const shield = chain.shield();
    const markers = { ...desk(chain, phone, shield), read: async () => Promise.reject(new Error("Shield is busy")) };
    await expect(vt.run(release(chain, phone, shield, start, { markers }).done)).rejects.toThrow(/Nothing was paid.*Shield is busy/);
    expect(shield.calls).toEqual([]);
  });
});

describe("two devices and one run", () => {
  it("the phone pays 6 of 6; the laptop restored from the earlier backup pays nobody again", async () => {
    const { vt, chain, start, phone, saved } = await posted(6);
    const laptop = await phone.restored(saved); // the books as they were before the release
    await vt.run(release(chain, phone, chain.shield(), start).done);
    expect(paidEach(chain, start)).toEqual([1, 1, 1, 1, 1, 1]);

    const shield = chain.shield();
    let said: readonly unknown[] | undefined;
    const run = release(chain, laptop, shield, start, { onPrompts: (prompts) => (said = prompts) });
    await vt.run(run.done);
    expect(paidEach(chain, start)).toEqual([1, 1, 1, 1, 1, 1]);
    expect(shield.approvals).toBe(0);
    expect(shield.calls).toEqual([]);
    expect(said).toEqual([]); // and it said beforehand that Shield would be asked nothing
    // The laptop's books now hold each payment the phone made, by the transaction that made it.
    expect(laptop.settlements.map((s) => [s.status, s.reference])).toEqual(start.workers.map((w) => ["settled", chain.paid(start.links.get(w)!)[0]!.id]));
    expect(laptop.settlements.map((s) => s.reference)).toEqual(phone.settlements.map((s) => s.reference));
    // The paystubs were the phone's to send: the laptop sends none.
    expect(run.delivered).toEqual([]);

    // What that took: Shield's lists of records and of transaction ids and its transition view keys; the explorer's
    // blocks and transactions by id. No account, amount or key in anything asked of the explorer.
    expect(new Set(shield.asked)).toEqual(new Set([`records ${USDCX}`, `records ${LETTERS_PROGRAM}`, `records ${PROGRAMS.letters.hewn_letters_v1}`, `history ${USDCX}`, "view keys"]));
    for (const path of chain.asked) {
      expect(path).toMatch(/^(block\/height\/latest|block\/\d+|block\/ab1block\d+|find\/blockHash\/at1\w+|transaction\/(confirmed\/)?at1\w+|program\/[a-z0-9_]+\.aleo\/mapping\/[a-z_]+\/[0-9a-z]+)$/);
      expect(path).not.toMatch(/aleo1|AViewKey|u128/);
    }
  });

  it("the phone stops after 3 of 6; the laptop, with no tags, pays nobody for 30 minutes and then each of the other 3 once", async () => {
    const { vt, chain, start, phone, saved } = await posted(6);
    const laptop = await phone.restored(saved);
    const lost = chain.shield();
    lost.behaviour = onPayment((nth) => (nth < 3 ? "ok" : "lost"));
    await vt.run(Promise.race([release(chain, phone, lost, start).done, vt.sleep(10 * MIN)]));
    expect(paidEach(chain, start)).toEqual([1, 1, 1, 0, 0, 0]);
    const third = chain.paid(start.links.get(start.workers[2]!)!)[0]!;

    // Ten minutes in: the three the phone paid are found; nothing is sent for the rest.
    const shield = chain.shield();
    const first = release(chain, laptop, shield, start);
    await vt.run(first.done);
    expect(laptop.settlements.map((s) => s.status)).toEqual(["settled", "settled", "settled", "pending", "pending", "pending"]);
    expect([...first.held.keys()]).toEqual(start.workers.slice(3));
    expect(first.delivered).toEqual([]); // the phone paid them: their paystubs are the phone's to send
    for (const why of first.held.values()) expect(why).toMatch(new RegExp(`^${IN_PROGRESS}\\. If it has stopped there, this device can go on with it from \\d{1,2}:\\d{2} [AP]M\\.$`));
    expect(shield.approvals).toBe(0);

    // Twenty-five minutes after the phone's last payment: still nothing.
    await vt.run(vt.sleep(third.at + 25 * MIN - vt.now));
    const second = release(chain, laptop, shield, start);
    await vt.run(second.done);
    expect([...second.held.keys()]).toEqual(start.workers.slice(3));
    expect(shield.calls).toEqual([]);
    expect(paidEach(chain, start)).toEqual([1, 1, 1, 0, 0, 0]);

    // Past thirty: the laptop goes on with the run, from what the phone's last payment left and nothing else.
    await vt.run(vt.sleep(third.at + 31 * MIN - vt.now));
    const last = release(chain, laptop, shield, start);
    await vt.run(last.done);
    expect(last.held.size).toBe(0);
    expect(paidEach(chain, start)).toEqual([1, 1, 1, 1, 1, 1]);
    expect(shield.payments).toHaveLength(3);
    expect(last.delivered).toEqual(start.workers.slice(3)); // the three it paid itself
    expect(shield.lettersSent).toEqual([]); // the run is already marked: no second note
    expect(shield.payments[0]!.inputs[2]).toBe(chain.tokens.find((t) => t.from === third.id)!.plaintext);
    expect(laptop.settlements.every((s) => s.status === "settled")).toBe(true);

    // The phone, opened again later, finds every payment and asks for nothing.
    const back = chain.shield();
    await vt.run(release(chain, phone, back, start).done);
    expect(back.calls).toEqual([]);
    expect(phone.settlements.every((s) => s.status === "settled")).toBe(true);
    expect(paidEach(chain, start)).toEqual([1, 1, 1, 1, 1, 1]);
  });

  for (const hidesBusy of [false, true]) {
    it(`a payment the phone left on its way lands while the laptop waits: it is found, the wait starts again, and nobody is paid twice (Shield ${hidesBusy ? "no longer lists" : "still lists"} the record it is spending)`, async () => {
      const { vt, chain, start, phone, saved } = await posted(6);
      chain.hidesBusy = hidesBusy;
      const laptop = await phone.restored(saved);
      const lost = chain.shield();
      // The fourth is taken by Shield, called failed, and lands ten minutes later; the phone is gone after that.
      lost.behaviour = onPayment((nth) => (nth < 3 ? "ok" : nth === 3 ? { saysFailed: true, landsAfterMs: 10 * MIN } : "lost"));
      await vt.run(release(chain, phone, lost, start).done);
      expect(paidEach(chain, start)).toEqual([1, 1, 1, 0, 0, 0]);

      const shield = chain.shield();
      await vt.run(vt.sleep(5 * MIN));
      const early = release(chain, laptop, shield, start);
      await vt.run(early.done);
      expect([...early.held.keys()]).toEqual(start.workers.slice(3));

      // 35 minutes after the third payment, but only some 25 after the fourth landed: the fourth is found, the rest wait.
      const third = chain.paid(start.links.get(start.workers[2]!)!)[0]!;
      await vt.run(vt.sleep(third.at + 35 * MIN - vt.now));
      expect(paidEach(chain, start)).toEqual([1, 1, 1, 1, 0, 0]);
      const middle = release(chain, laptop, shield, start);
      await vt.run(middle.done);
      expect(laptop.settlements[3]!.status).toBe("settled");
      expect([...middle.held.keys()]).toEqual(start.workers.slice(4));
      expect(shield.calls).toEqual([]);

      const fourth = chain.paid(start.links.get(start.workers[3]!)!)[0]!;
      await vt.run(vt.sleep(fourth.at + 31 * MIN - vt.now));
      await vt.run(release(chain, laptop, shield, start).done);
      expect(paidEach(chain, start)).toEqual([1, 1, 1, 1, 1, 1]);
      expect(shield.payments).toHaveLength(2);
      expect(shield.payments[0]!.inputs[2]).toBe(chain.tokens.find((t) => t.from === fourth.id)!.plaintext);
    });
  }

  it("the laptop has gone on with the run and the phone is opened again while the laptop's payment is on its way: both ask from one record, and each is paid once", async () => {
    const { vt, chain, start, phone, saved } = await posted(5);
    const laptop = await phone.restored(saved);
    const first = chain.shield();
    // The phone's third prompt is left to expire: its line keeps its record, and the run stops there.
    first.behaviour = onPayment((nth) => (nth < 2 ? "ok" : "expired"));
    await vt.run(release(chain, phone, first, start).done);
    expect(paidEach(chain, start)).toEqual([1, 1, 0, 0, 0]);
    const second = chain.paid(start.links.get(start.workers[1]!)!)[0]!;

    // Past thirty minutes the laptop goes on with it. Shield takes its first payment, calls it failed, and it lands two minutes later.
    await vt.run(vt.sleep(second.at + 31 * MIN - vt.now));
    const shield = chain.shield();
    shield.behaviour = onPayment((nth) => (nth === 0 ? { saysFailed: true, landsAfterMs: 2 * MIN } : "ok"));
    await vt.run(release(chain, laptop, shield, start).done);
    expect(shield.payments).toHaveLength(1);
    // Meanwhile the phone is opened again and asks for the same payment: from the record it had kept, the one the laptop named.
    first.behaviour = () => "ok";
    const asked = first.payments.length;
    await vt.run(release(chain, phone, first, start).done);
    expect(first.payments[asked]!.inputs[2]).toBe(shield.payments[0]!.inputs[2]);
    await vt.run(vt.sleep(5 * MIN));
    await vt.run(release(chain, laptop, shield, start).done);
    await vt.run(release(chain, phone, first, start).done);
    expect(paidEach(chain, start)).toEqual([1, 1, 1, 1, 1]);
    for (const device of [phone, laptop]) expect(device.settlements.every((s) => s.status === "settled")).toBe(true);
  });

  it("the phone marks the run and stops before paying anyone: the laptop pays the first from the record the marker names, the rest only after the wait", async () => {
    const { vt, chain, start, phone, saved } = await posted(3);
    const laptop = await phone.restored(saved);
    const lost = chain.shield();
    lost.behaviour = onPayment(() => "lost");
    await vt.run(Promise.race([release(chain, phone, lost, start).done, vt.sleep(2 * MIN)]));
    const named = lost.payments[0]!.inputs[2]!;

    // The laptop's prompt for the first is left to expire: the ones after it wait for that payment, whatever the time.
    const shield = chain.shield();
    shield.behaviour = onPayment((nth) => (nth === 0 ? "expired" : "ok"));
    await vt.run(release(chain, laptop, shield, start).done);
    await vt.run(vt.sleep(40 * MIN));
    shield.behaviour = onPayment(() => "expired");
    const early = release(chain, laptop, shield, start);
    await vt.run(early.done);
    expect(paidEach(chain, start)).toEqual([0, 0, 0]);
    expect([...early.held.entries()]).toEqual(start.workers.slice(1).map((w) => [w, `${IN_PROGRESS}. Its first payment hasn't been found yet, and the ones after it are paid from what that one leaves.`]));

    shield.behaviour = () => "ok";
    const first = release(chain, laptop, shield, start);
    await vt.run(first.done);
    expect(paidEach(chain, start)).toEqual([1, 0, 0]);
    expect(new Set(shield.payments.map((c) => c.inputs[2]))).toEqual(new Set([named])); // the very record the phone set aside, each time
    expect([...first.held.keys()]).toEqual(start.workers.slice(1));
    expect(shield.lettersSent).toEqual([]);

    await vt.run(vt.sleep(31 * MIN));
    await vt.run(release(chain, laptop, shield, start).done);
    expect(paidEach(chain, start)).toEqual([1, 1, 1]);
    expect(shield.payments.at(-2)!.inputs[2]).toBe(chain.tokens.find((t) => t.from === chain.paid(start.links.get(start.workers[0]!)!)[0]!.id)!.plaintext);
  });

  it("while the account holds a second record, another device doesn't go on with a run: the device that started it does, and each is paid once", async () => {
    const { vt, chain, start, phone, saved } = await posted(3);
    const laptop = await phone.restored(saved);
    const first = chain.shield();
    first.behaviour = onPayment((nth) => (nth < 2 ? "ok" : "expired"));
    await vt.run(release(chain, phone, first, start).done);
    expect(paidEach(chain, start)).toEqual([1, 1, 0]);
    // Money arrives: the account now holds what the second payment left, and a record besides.
    chain.deposit(centsToMinor(1_000_00n));
    await vt.run(vt.sleep(45 * MIN));

    const shield = chain.shield();
    for (const wait of [0, 60 * MIN]) {
      await vt.run(vt.sleep(wait));
      const run = release(chain, laptop, shield, start);
      await vt.run(run.done);
      expect(shield.calls).toEqual([]);
      // What that run's last payment left still covers the payment, so the device that started it may pay from it:
      // paying them in Shield isn't offered, since that device would pay them again if it missed that payment.
      expect([...run.held.entries()]).toEqual([
        [
          start.workers[2],
          `${IN_PROGRESS}, and this device can't go on with it: it would pay only from what that run's last payment left, and only while that is the one record Shield lists for this account. Go on with the run on the device that started it.`,
        ],
      ]);
    }
    first.behaviour = () => "ok";
    await vt.run(release(chain, phone, first, start).done);
    await vt.run(vt.sleep(MIN));
    await vt.run(release(chain, laptop, shield, start).done);
    expect(shield.calls).toEqual([]);
    expect(paidEach(chain, start)).toEqual([1, 1, 1]);
    for (const device of [phone, laptop]) expect(device.settlements.every((s) => s.status === "settled")).toBe(true);
  });

  it("another device can't go on with a run whose last payment's change Shield combined with money that arrived: its line offers paying them in Shield, which nobody's device then pays again", async () => {
    const { vt, chain, start, phone, saved } = await posted(3);
    const laptop = await phone.restored(saved);
    const first = chain.shield();
    first.behaviour = onPayment((nth) => (nth < 2 ? "ok" : "expired"));
    await vt.run(release(chain, phone, first, start).done);
    expect(paidEach(chain, start)).toEqual([1, 1, 0]);
    chain.deposit(centsToMinor(1_000_00n));
    await vt.run(vt.sleep(MIN));
    chain.combine();
    await vt.run(vt.sleep(45 * MIN));
    const shield = chain.shield();
    const run = release(chain, laptop, shield, start);
    await vt.run(run.done);
    expect(shield.calls).toEqual([]);
    expect(run.held.get(start.workers[2]!)).toBe(
      `${IN_PROGRESS}, and this device can't go on with it: it would pay only from what that run's last payment left, and only while that is the one record Shield lists for this account. Go on with the run on the device that started it, or pay anyone it didn't pay in Shield; the run then finds the payment.`,
    );
    // Paid in Shield; neither device pays them again, even while Shield's history doesn't list that payment.
    chain.payByHand(start.links.get(start.workers[2]!)!, centsToMinor(phone.company.payroll.runs[0]!.paychecks[2]!.net));
    first.behaviour = () => "ok";
    first.listsHistory = false;
    shield.listsHistory = false;
    await vt.run(vt.sleep(MIN));
    await vt.run(release(chain, phone, first, start).done);
    await vt.run(release(chain, laptop, shield, start).done);
    expect(paidEach(chain, start)).toEqual([1, 1, 1]);
  });

  it("a device whose Shield doesn't list the other's transfers, or doesn't say which transaction made a record, pays nobody", async () => {
    for (const blind of ["history", "origins"] as const) {
      const { vt, chain, start, phone, saved } = await posted(4);
      const laptop = await phone.restored(saved);
      const lost = chain.shield();
      lost.behaviour = onPayment((nth) => (nth < 2 ? "ok" : "lost"));
      await vt.run(Promise.race([release(chain, phone, lost, start).done, vt.sleep(5 * MIN)]));
      const shield = chain.shield();
      if (blind === "history") shield.listsHistory = false;
      else chain.showOrigins = false;
      for (const wait of [0, 40 * MIN, 3 * 60 * MIN]) {
        await vt.run(vt.sleep(wait));
        const run = release(chain, laptop, shield, start);
        await vt.run(run.done);
        expect(shield.approvals).toBe(0);
        expect(paidEach(chain, start)).toEqual([1, 1, 0, 0]);
        expect([...run.held.values()].every((why) => why.startsWith(IN_PROGRESS))).toBe(true);
      }
    }
  });

  it("a copy of the books saved in the middle of a run, opened after the run finished, pays nobody", async () => {
    const { vt, chain, start, phone } = await posted(4);
    let midway: Company | undefined;
    let approving = 0;
    const run = release(chain, phone, chain.shield(), start, { onEvent: (e) => void (e.kind === "approving" && ++approving === 3 && (midway = structuredClone(phone.company))) });
    await vt.run(run.done);
    expect(midway!.payroll.runs[0]!.paychecks.map((p) => p.settlement.status)).toEqual(["settled", "settled", "pending", "pending"]);
    const laptop = await phone.restored(midway!);
    const shield = chain.shield();
    const copy = release(chain, laptop, shield, start);
    await vt.run(copy.done);
    expect(shield.calls).toEqual([]);
    expect(laptop.settlements.every((s) => s.status === "settled")).toBe(true);
    expect(paidEach(chain, start)).toEqual([1, 1, 1, 1]);
    // It only found them, the payments it held a record for included: the paystubs were the phone's to send.
    expect(copy.delivered).toEqual([]);
  });

  it("a copy of the books saved in the middle of a run, opened while the first device's payment is still on its way, spends the same record: each is paid once", async () => {
    const { vt, chain, start, phone } = await posted(4);
    let midway: Company | undefined;
    let approving = 0;
    const first = chain.shield();
    // The third is taken by Shield, called failed, and lands two minutes later; the phone is closed after that.
    first.behaviour = onPayment((nth) => (nth < 2 ? "ok" : nth === 2 ? { saysFailed: true, landsAfterMs: 2 * MIN } : "lost"));
    const run = release(chain, phone, first, start, { onEvent: (e) => void (e.kind === "approving" && ++approving === 3 && (midway = structuredClone(phone.company))) });
    await vt.run(run.done);
    expect(paidEach(chain, start)).toEqual([1, 1, 0, 0]);
    // The copy holds the third payment's record, as the phone does: asked for from there too, it names that record.
    const laptop = await phone.restored(midway!);
    const shield = chain.shield();
    await vt.run(release(chain, laptop, shield, start).done);
    expect(shield.payments[0]!.inputs[2]).toBe(first.payments[2]!.inputs[2]);
    await vt.run(vt.sleep(5 * MIN));
    await vt.run(release(chain, laptop, shield, start).done);
    await vt.run(release(chain, phone, chain.shield(), start).done);
    expect(paidEach(chain, start)).toEqual([1, 1, 1, 1]);
    expect(shield.lettersSent).toEqual([]);
    for (const device of [phone, laptop]) expect(device.settlements.every((s) => s.status === "settled")).toBe(true);
  });

  for (const hidesBusy of [false, true]) {
    it(`a copy of the books saved after the first payment is opened while the first device's second payment is on its way, in an account that holds a second record: nothing is paid from the other record, and each is paid once (Shield ${hidesBusy ? "no longer lists" : "still lists"} the record it is spending)`, async () => {
      const { vt, chain, start, phone } = await posted(3, [centsToMinor(20_000_00n), centsToMinor(33_000_00n)]);
      chain.hidesBusy = hidesBusy;
      let midway: Company | undefined;
      const first = chain.shield();
      // The second is taken by Shield, called failed, and lands four minutes later; the phone is closed after that.
      first.behaviour = onPayment((nth) => (nth === 0 ? "ok" : nth === 1 ? { saysFailed: true, landsAfterMs: 4 * MIN } : "lost"));
      const run = release(chain, phone, first, start, { onEvent: (e) => void (e.kind === "settled" && !midway && (midway = structuredClone(phone.company))) });
      await vt.run(Promise.race([run.done, vt.sleep(MIN)]));
      // The copy knows the run's marker, and holds a record for the first payment only.
      expect(midway!.payroll.runs[0]!.paychecks.map((p) => [!!p.settlement.attempt, !!p.settlement.marker])).toEqual([[true, true], [false, true], [false, true]]);
      const laptop = await phone.restored(midway!);
      const shield = chain.shield();
      const early = release(chain, laptop, shield, start);
      await vt.run(early.done);
      const left = chain.tokens.find((t) => t.from === chain.paid(start.links.get(start.workers[0]!)!)[0]!.id)!.plaintext;
      // Whatever the laptop asked for the second, it named what the first payment left: the record the phone is spending.
      expect(shield.payments.filter((c) => c.inputs[0] === start.links.get(start.workers[1]!)).every((c) => c.inputs[2] === left)).toBe(true);
      if (hidesBusy) {
        // That record isn't listed while the phone's payment is on its way, so the laptop asks for nothing.
        expect(shield.payments).toEqual([]);
        expect(laptop.settlements.map((s) => s.status)).toEqual(["settled", "failed", "pending"]);
        expect(laptop.settlements[1]!.failure!.startsWith(`${NOT_FROM_HERE}: `)).toBe(true);
        expect(laptop.settlements[1]!.attempt).toBeUndefined();
      }
      await vt.run(vt.sleep(10 * MIN));
      expect(paidEach(chain, start).every((n) => n <= 1)).toBe(true);
      await vt.run(release(chain, laptop, shield, start).done);
      await vt.run(release(chain, phone, chain.shield(), start).done);
      expect(paidEach(chain, start)).toEqual([1, 1, 1]);
      for (const device of [phone, laptop]) expect(device.settlements.every((s) => s.status === "settled")).toBe(true);
    });

    it(`the phone stops holding no record for its third payment, the laptop goes on with the run, money arrives while the laptop's payment is on its way, and the phone is opened again: it asks for nothing from the new record, and each is paid once (Shield ${hidesBusy ? "no longer lists" : "still lists"} the record it is spending)`, async () => {
      const { vt, chain, start, phone, saved } = await posted(3);
      chain.hidesBusy = hidesBusy;
      const laptop = await phone.restored(saved);
      const first = chain.shield();
      // From its second payment on, the phone's Shield is slow to list anything: what that payment left isn't
      // listed in time, and the run stops before a record is kept for the third.
      first.behaviour = onPayment((nth) => (nth === 1 && (first.lagMs = 10 * MIN), "ok"));
      expect((await vt.run(release(chain, phone, first, start).done)).stalled).toBe(true);
      expect(paidEach(chain, start)).toEqual([1, 1, 0]);
      expect(phone.settlements[2]).toEqual({ status: "pending", marker: phone.settlements[2]!.marker });
      const second = chain.paid(start.links.get(start.workers[1]!)!)[0]!;

      // Past thirty minutes the laptop goes on with it. Shield takes its payment, calls it failed, and it lands three minutes later.
      await vt.run(vt.sleep(second.at + 31 * MIN - vt.now));
      const shield = chain.shield();
      shield.behaviour = onPayment(() => ({ saysFailed: true, landsAfterMs: 3 * MIN }));
      await vt.run(release(chain, laptop, shield, start).done);
      expect(shield.payments).toHaveLength(1);
      expect(shield.payments[0]!.inputs[2]).toBe(chain.tokens.find((t) => t.from === second.id)!.plaintext);

      // Money arrives, and the phone is opened again while that payment is still on its way.
      chain.deposit(centsToMinor(1_000_00n));
      await vt.run(vt.sleep(10_000));
      first.lagMs = 1_000;
      first.behaviour = () => "ok";
      const asked = first.calls.length;
      const back = release(chain, phone, first, start);
      await vt.run(back.done);
      // The phone asks for the third only from the record the laptop is spending, what the second payment left, and
      // only while Shield lists it: the network lets one of the two through. Never from the new record.
      const left = chain.tokens.find((t) => t.from === second.id)!.plaintext;
      const again = first.calls.slice(asked).filter((c) => c.program === USDCX);
      expect(again).toHaveLength(hidesBusy ? 0 : 1);
      expect(again.every((c) => c.inputs[2] === left)).toBe(true);
      expect(first.calls.slice(asked).filter((c) => c.program !== USDCX)).toEqual([]);
      expect(paidEach(chain, start).every((n) => n <= 1)).toBe(true);
      if (hidesBusy) {
        const why = back.held.get(start.workers[2]!) ?? phone.settlements[2]!.failure;
        expect(why!.startsWith(`${NOT_FROM_HERE}: `)).toBe(true);
      }

      await vt.run(vt.sleep(5 * MIN));
      expect(paidEach(chain, start)).toEqual([1, 1, 1]);
      await vt.run(release(chain, phone, first, start).done);
      await vt.run(release(chain, laptop, shield, start).done);
      expect(first.calls).toHaveLength(asked + again.length);
      expect(paidEach(chain, start)).toEqual([1, 1, 1]);
      for (const device of [phone, laptop]) expect(device.settlements.every((s) => s.status === "settled")).toBe(true);
    });
  }

  it("a run that stopped with no record held for its next payment goes on, on the device that started it, from what its last payment left; while Shield doesn't say which payment made a record, nothing is asked", async () => {
    const { vt, chain, start, phone } = await posted(4, [centsToMinor(20_000_00n), centsToMinor(33_000_00n)]);
    const shield = chain.shield();
    // From its second payment on, Shield is slow to list anything: the run stops before a record is kept for the third.
    shield.behaviour = onPayment((nth) => (nth === 1 && (shield.lagMs = 10 * MIN), "ok"));
    expect((await vt.run(release(chain, phone, shield, start).done)).stalled).toBe(true);
    expect(paidEach(chain, start)).toEqual([1, 1, 0, 0]);
    const second = chain.paid(start.links.get(start.workers[1]!)!)[0]!;
    shield.lagMs = 1_000;
    shield.behaviour = () => "ok";
    await vt.run(vt.sleep(MIN));

    // Shield's list doesn't say which transaction made each record: the one the run goes on from can't be told from the other.
    chain.showOrigins = false;
    const asked = shield.calls.length;
    const blind = release(chain, phone, shield, start);
    await vt.run(blind.done);
    expect(shield.calls).toHaveLength(asked);
    expect([...blind.held.keys()]).toEqual(start.workers.slice(2));
    expect(blind.held.get(start.workers[2]!)).toMatch(new RegExp(`^${NOT_FROM_HERE}: this run stopped part-way, and it goes on only from what the payment before this one left\\.`));
    // That record may still be told apart, and the run would then pay them from it: paying them in Shield isn't offered.
    expect(blind.held.get(start.workers[2]!)).not.toMatch(/pay them in Shield/);
    expect(blind.held.get(start.workers[3]!)).toBe(`${NOT_FROM_HERE}: it is paid from what the payment before it in this run leaves, and that payment hasn't been found yet.`);
    expect(paidEach(chain, start)).toEqual([1, 1, 0, 0]);

    // Once it says: the third is asked for from what the second left, never from the account's other record, and the fourth follows.
    chain.showOrigins = true;
    const run = release(chain, phone, shield, start);
    await vt.run(run.done);
    expect(run.held.size).toBe(0);
    expect(shield.lettersSent).toHaveLength(1);
    expect(shield.payments).toHaveLength(4);
    expect(shield.payments[2]!.inputs[2]).toBe(chain.tokens.find((t) => t.from === second.id)!.plaintext);
    expect(paidEach(chain, start)).toEqual([1, 1, 1, 1]);
    expect(phone.settlements.every((s) => s.status === "settled")).toBe(true);
  });

  it("the laptop's books number the run and its people differently: payments are matched by account, period and amount, and nobody is paid twice", async () => {
    const { vt, chain, start, phone, saved } = await posted(4);
    const lost = chain.shield();
    lost.behaviour = onPayment((nth) => (nth < 2 ? "ok" : "lost"));
    await vt.run(Promise.race([release(chain, phone, lost, start).done, vt.sleep(3 * MIN)]));
    const theirs = renumbered({ ...start, company: saved });
    expect(theirs.runId).not.toBe(start.runId);
    const laptop = await phone.restored(theirs.company);
    const shield = chain.shield();
    const run = release(chain, laptop, shield, theirs);
    await vt.run(run.done);
    expect(shield.calls).toEqual([]);
    expect(laptop.settlements.map((s) => s.status)).toEqual(["settled", "settled", "pending", "pending"]);
    expect([...run.held.keys()]).toEqual(theirs.workers.slice(2));
    await vt.run(vt.sleep(31 * MIN));
    await vt.run(release(chain, laptop, shield, theirs).done);
    expect(paidEach(chain, start)).toEqual([1, 1, 1, 1]);
    expect(shield.lettersSent).toEqual([]);
  });

  it("the same device, reopened between the second payment and the third, goes on at once: no wait, no second note, each paid once", async () => {
    const { vt, chain, start, phone } = await posted(4);
    const before = chain.shield();
    before.behaviour = onPayment((nth) => (nth < 2 ? "ok" : "lost"));
    await vt.run(Promise.race([release(chain, phone, before, start).done, vt.sleep(3 * MIN)]));
    expect(paidEach(chain, start)).toEqual([1, 1, 0, 0]);
    const after = chain.shield();
    const run = release(chain, phone, after, start);
    await vt.run(run.done);
    expect(run.held.size).toBe(0);
    expect(after.lettersSent).toEqual([]);
    expect(after.payments).toHaveLength(2);
    expect(after.payments[0]!.inputs[2]).toBe(before.payments[2]!.inputs[2]); // the record it had set aside for the third
    expect(paidEach(chain, start)).toEqual([1, 1, 1, 1]);
  });

  it("another amount for a marked period is refused on every device", async () => {
    const { vt, chain, start, phone } = await posted(3);
    await vt.run(release(chain, phone, chain.shield(), start).done);
    // Other copies of the books, where the first person's hours for the same period were changed before the run was posted.
    const changed = postedRun(3, undefined, (i) => (i === 0 ? 31 : 20 + i));
    for (const device of [await phone.restored(changed.company), await phone.restored(changed.company)]) {
      const shield = chain.shield();
      const run = release(chain, device, shield, changed);
      await vt.run(run.done);
      expect(shield.calls).toEqual([]);
      expect([...run.held.entries()]).toEqual([[changed.workers[0], `${NOT_FROM_HERE}: ${OTHER_AMOUNT}`]]);
      expect(device.settlements.map((s) => s.status)).toEqual(["pending", "settled", "settled"]);
    }
    expect(paidEach(chain, start)).toEqual([1, 1, 1]);
  });

  it("two devices mark one person at different amounts moments apart: the later one stands down, and from then on neither pays that person", async () => {
    const { vt, chain, start, phone } = await posted(3);
    // The laptop's copy of the books has other hours for the first person, same period.
    const changed = postedRun(3, undefined, (i) => (i === 0 ? 31 : 20 + i));
    const laptop = await phone.restored(changed.company);
    const [a, b] = [chain.shield(), chain.shield()];
    // The phone's first prompt is left to expire, so its marker is there and nobody is paid yet.
    a.behaviour = onPayment((nth) => (nth === 0 ? "expired" : "ok"));
    await vt.run(Promise.allSettled([release(chain, phone, a, start).done, vt.sleep(4_000).then(() => release(chain, laptop, b, changed).done)]));
    expect(b.payments).toEqual([]);
    expect(laptop.settlements[0]).toMatchObject({ status: "failed", failure: `${NOTHING_PAID}: ${MARKED_FIRST}` });
    expect(paidEach(chain, start)).toEqual([0, 0, 0]);

    // Both notes are on the account, and both name the first person, at two amounts. Neither device pays them now.
    await vt.run(vt.sleep(MIN));
    const again = release(chain, phone, a, start);
    await vt.run(again.done);
    expect([...again.held.entries()]).toEqual([[start.workers[0], `${NOT_FROM_HERE}: ${OTHER_AMOUNT}`]]);
    expect(paidEach(chain, start)).toEqual([0, 1, 1]); // the others, at one amount on both, are paid once, by the device whose note came first
    const other = release(chain, laptop, b, changed);
    await vt.run(other.done);
    expect([...other.held.keys()]).toEqual([changed.workers[0]]);
    expect(b.payments).toEqual([]);
    expect(laptop.settlements.map((s) => s.status)).toEqual(["failed", "settled", "settled"]);
    expect(paidEach(chain, start)).toEqual([0, 1, 1]);
  });

  it("a later run for another period is marked on its own, and a correction for the same period at another amount is refused", async () => {
    const { vt, chain, start, phone } = await posted(2);
    const shield = chain.shield();
    await vt.run(release(chain, phone, shield, start).done);
    const next = postedRun(2, { payDate: "2026-11-20", periodStart: "2026-11-14", periodEnd: "2026-11-20" });
    const later = await phone.restored(next.company);
    await vt.run(release(chain, later, shield, next).done);
    expect(paidEach(chain, start)).toEqual([2, 2]); // once for each period
    expect(shield.lettersSent).toHaveLength(2);

    // A correction: the first person again, for the first period, at another amount. Nothing is asked for it.
    const correction = postedRun(1, { payDate: "2026-11-21", periodStart: "2026-11-07", periodEnd: "2026-11-13" }, () => 3);
    const asked = shield.calls.length;
    const run = release(chain, await phone.restored(correction.company), shield, correction);
    await vt.run(run.done);
    expect(shield.calls).toHaveLength(asked);
    expect([...run.held.entries()]).toEqual([
      [
        correction.workers[0],
        `${NOT_FROM_HERE}: a note on this account already pays this account a different amount for this same pay period (another pay run for these dates, or another copy of these books). Nothing is sent for them from this run; if they are still owed, pay them in Shield.`,
      ],
    ]);
    expect(paidEach(chain, start)).toEqual([2, 2]);
  });

  it("a second run in the same books for the same pay period at other amounts is held on every line, in words that don't say another copy is to blame", async () => {
    const { vt, chain, start, phone } = await posted(3);
    const shield = chain.shield();
    await vt.run(release(chain, phone, shield, start).done);
    expect(paidEach(chain, start)).toEqual([1, 1, 1]);
    await vt.run(vt.sleep(60 * MIN));
    const rail = ensureRailAccount(phone.company.books);
    const run0 = phone.company.payroll.runs[0]!;
    const second = postPayRun(
      rail.books,
      phone.company.payroll,
      { payDate: run0.payDate, periodStart: run0.periodStart, periodEnd: run0.periodEnd, bankAccountId: rail.accountId, mode: "rail", lines: start.workers.map((workerId, i) => ({ workerId, hours: 2 + i })) },
      { now: () => "2026-11-13T15:00:00.000Z" },
    );
    await phone.updateCompany((c) => ({ ...c, books: second.books, payroll: second.payroll }));
    const asked = shield.calls.length;
    const run = release(chain, phone, shield, { ...start, runId: second.run.id });
    await vt.run(run.done);
    expect(shield.calls).toHaveLength(asked);
    expect([...run.held.entries()]).toEqual(start.workers.map((w) => [w, `${NOT_FROM_HERE}: ${OTHER_AMOUNT}`]));
    expect(OTHER_AMOUNT).toContain("another pay run for these dates, or another copy of these books");
    expect(paidEach(chain, start)).toEqual([1, 1, 1]);
  });

  it("a payment holding another record than the one an earlier run's note names for its account, for days both periods share, is held in words that name that run", async () => {
    const { vt, chain, start, phone } = await posted(3);
    await vt.run(release(chain, phone, chain.shield(), start).done);
    // Books of another run, for a period that shares days with the first, at the same amounts; its first payment holds a record of its own.
    const next = postedRun(3, { payDate: "2026-11-20", periodStart: "2026-11-10", periodEnd: "2026-11-20" });
    next.company.payroll = markPaycheckSettlement(next.company.payroll, next.runId, next.workers[0]!, { status: "pending", attempt: "ab".repeat(16) });
    const shield = chain.shield();
    const run = release(chain, await phone.restored(next.company), shield, next);
    await vt.run(run.done);
    expect(shield.calls).toEqual([]);
    expect([...run.held.entries()]).toEqual(
      next.workers.map((w) => [w, `${NOT_FROM_HERE}: a pay run on the rail for 2026-11-07 to 2026-11-13 already pays this account, and this run's period shares days with it. Nothing is sent for them from this run; if they are still owed, pay them in Shield.`]),
    );
  });

  for (const deposits of [[float], [centsToMinor(20_000_00n), centsToMinor(33_000_00n)]]) {
    for (const hidesBusy of [false, true]) {
      it(`two devices start the same run moments apart, each is then reopened, then a third device opens it, in 40 orderings: nobody is paid twice (${deposits.length} record${deposits.length > 1 ? "s" : ""}, Shield ${hidesBusy ? "no longer lists" : "still lists"} the record it is spending)`, async () => {
        // Ten chosen by hand, then thirty drawn from a fixed seed: how long after the first device the second starts
        // (up to a minute), how far behind the chain each device's Shield lists (half a second to a minute and a
        // half), and how long the second device's person takes over a prompt (2 to 32 seconds).
        const next = seeded(20261114 + deposits.length * 2 + (hidesBusy ? 1 : 0));
        const between = (from: number, to: number) => from + Math.round(next() * (to - from));
        const orderings: (readonly [offset: number, lagA: number, lagB: number, approveB: number])[] = [
          [0, 1_000, 1_000, 8_000],
          [2_000, 1_000, 1_000, 8_000],
          [5_000, 1_000, 1_000, 8_000],
          [9_000, 1_000, 1_000, 8_000],
          [15_000, 1_000, 1_000, 8_000],
          [24_000, 1_000, 1_000, 8_000],
          [40_000, 1_000, 1_000, 8_000],
          [3_000, 1_000, 45_000, 8_000],
          [3_000, 45_000, 1_000, 8_000],
          [20_000, 90_000, 30_000, 8_000],
          ...Array.from({ length: 30 }, () => [between(0, 60_000), between(500, 90_500), between(500, 90_500), between(2_000, 32_000)] as const),
        ];
        expect(orderings).toHaveLength(40);
        for (const [offset, lagA, lagB, approveB] of orderings) {
          const { vt, chain, start, phone, saved } = await posted(3, deposits);
          chain.hidesBusy = hidesBusy;
          const laptop = await phone.restored(saved);
          const third = await phone.restored(saved);
          const [a, b] = [chain.shield({ lagMs: lagA }), chain.shield({ lagMs: lagB, approveMs: approveB })];
          const [first, second] = [release(chain, phone, a, start), vt.sleep(offset).then(() => release(chain, laptop, b, start).done)];
          await vt.run(Promise.allSettled([first.done, second]));
          const label = `offset ${offset} lags ${lagA}/${lagB} approval ${approveB}`;
          expect(paidEach(chain, start).every((n) => n <= 1), label).toBe(true);
          await vt.run(vt.sleep(3 * MIN));
          await vt.run(release(chain, laptop, b, start).done);
          await vt.run(release(chain, phone, a, start).done);
          const late = chain.shield();
          await vt.run(release(chain, third, late, start).done);
          expect(late.approvals, label).toBe(0);
          expect(paidEach(chain, start), label).toEqual([1, 1, 1]);
          for (const device of [phone, laptop, third]) expect(device.settlements.map((s) => s.status), label).toEqual(["settled", "settled", "settled"]);
        }
      });
    }
  }

  it("the device whose marker came second stands down: its first line says another device marked the run first, and it keeps no record", async () => {
    const { vt, chain, start, phone, saved } = await posted(3);
    const laptop = await phone.restored(saved);
    const [a, b] = [chain.shield(), chain.shield()];
    await vt.run(Promise.allSettled([release(chain, phone, a, start).done, vt.sleep(4_000).then(() => release(chain, laptop, b, start).done)]));
    expect(b.payments).toEqual([]);
    expect(b.lettersSent).toHaveLength(1);
    expect(laptop.settlements[0]).toMatchObject({ status: "failed", failure: `${NOTHING_PAID}: ${MARKED_FIRST}` });
    expect(laptop.settlements[0]!.attempt).toBeUndefined();
  });
});

describe("a run that stopped part-way, on the device that started it", () => {
  /** A run of three posted on the phone and released until Shield is slow to list what the first payment left: it stops there. */
  async function stoppedAfterOne(deposits: bigint[], hours?: (i: number) => number) {
    const vt = new VirtualTime();
    const chain = new Chain(vt, deposits);
    const start = postedRun(3, undefined, hours);
    const phone = await firstDevice(start.company);
    const shield = chain.shield();
    shield.behaviour = onPayment((nth) => (nth === 0 && (shield.lagMs = 10 * MIN), "ok"));
    expect((await vt.run(release(chain, phone, shield, start).done)).stalled).toBe(true);
    expect(paidEach(chain, start)).toEqual([1, 0, 0]);
    shield.lagMs = 1_000;
    shield.behaviour = () => "ok";
    await vt.run(vt.sleep(15 * MIN));
    const first = chain.paid(start.links.get(start.workers[0]!)!)[0]!;
    return { vt, chain, start, phone, shield, first };
  }

  it("a smaller record that covers the next payment is left alone: the next payment is asked for from what the first one left, and the run goes on", async () => {
    const nets = postedRun(3, undefined, (i) => 30 - i).company.payroll.runs[0]!.paychecks.map((p) => centsToMinor(p.net));
    const { vt, chain, start, phone, shield, first } = await stoppedAfterOne([float, nets[1]! + 1n], (i) => 30 - i);
    const asked = shield.payments.length;
    const run = release(chain, phone, shield, start);
    await vt.run(run.done);
    expect(run.held.size).toBe(0);
    expect(paidEach(chain, start)).toEqual([1, 1, 1]);
    expect(shield.payments.slice(asked)).toHaveLength(2);
    expect(shield.payments[asked]!.inputs[2]).toBe(chain.tokens.find((t) => t.from === first.id)!.plaintext);
    expect(phone.settlements.every((s) => s.status === "settled")).toBe(true);
  });

  it("what the first payment left was spent before Continue: the next person waits and the line says so; paid in Shield, the run finds that payment and goes on from what it left", async () => {
    const { vt, chain, start, phone, shield } = await stoppedAfterOne([float]);
    // A bill paid in Shield in the meantime: with one record in the account, it spends what the first payment left.
    chain.payByHand("aleo1" + "x".repeat(58), centsToMinor(1_00n));
    await vt.run(vt.sleep(MIN));
    const asked = shield.calls.length;
    const stuck = release(chain, phone, shield, start);
    await vt.run(stuck.done);
    expect(shield.calls).toHaveLength(asked);
    expect(stuck.held.get(start.workers[1]!)).toBe(
      `${NOT_FROM_HERE}: this run stopped part-way, and it goes on only from what the payment before this one left, and something else has spent that record (money arriving can make Shield combine it with another record, and a payment made in Shield can spend it). If Shield's activity shows no payment to them, pay them in Shield; the run then finds that payment and goes on from what it leaves.`,
    );
    expect(stuck.held.get(start.workers[2]!)).toBe(`${NOT_FROM_HERE}: it is paid from what the payment before it in this run leaves, and that payment hasn't been found yet.`);

    // The person pays the second in Shield; the run finds it, and the third is asked for from what that payment left.
    const second = start.links.get(start.workers[1]!)!;
    chain.payByHand(second, centsToMinor(phone.company.payroll.runs[0]!.paychecks[1]!.net));
    await vt.run(vt.sleep(MIN));
    const on = release(chain, phone, shield, start);
    await vt.run(on.done);
    expect(on.held.size).toBe(0);
    expect(paidEach(chain, start)).toEqual([1, 1, 1]);
    expect(shield.payments.at(-1)!.inputs[2]).toBe(chain.tokens.find((t) => t.from === chain.paid(second)[0]!.id)!.plaintext);
    expect(phone.settlements.every((s) => s.status === "settled")).toBe(true);
  });

  it("what the first payment left hasn't shown in Shield yet: the next person waits, and the line says to try again, not to pay them in Shield; once it shows, the run goes on from it and pays each person once", async () => {
    const { vt, chain, start, phone, shield, first } = await stoppedAfterOne([float, float]);
    // Shield is slow to list what the first payment left; its history doesn't list the account's transfers either.
    const change = chain.tokens.find((t) => t.from === first.id)!.plaintext;
    let hide = true;
    const records = shield.requestRecords.bind(shield);
    shield.requestRecords = async (program: string, all?: boolean) => (await records(program, all)).filter((r) => !(hide && (r as { recordPlaintext?: string }).recordPlaintext === change));
    shield.listsHistory = false;
    const asked = shield.calls.length;
    const waiting = release(chain, phone, shield, start);
    await vt.run(waiting.done);
    expect(shield.calls).toHaveLength(asked);
    expect(waiting.held.get(start.workers[1]!)).toBe(
      `${NOT_FROM_HERE}: this run stopped part-way, and it goes on only from what the payment before this one left. Shield doesn't list that record yet, or doesn't say which payment made it. It can take a few minutes to show; try again then.`,
    );
    expect(waiting.held.get(start.workers[1]!)).not.toMatch(/in Shield/);

    hide = false;
    await vt.run(vt.sleep(MIN));
    const on = release(chain, phone, shield, start);
    await vt.run(on.done);
    expect(on.held.size).toBe(0);
    expect(shield.payments[1]!.inputs[2]).toBe(change);
    expect(paidEach(chain, start)).toEqual([1, 1, 1]);
  });

  it("what the first payment left went into a record Shield combined with money that arrived: paid in Shield as the line says, a Continue that can't read Shield's history asks nothing, and one that can goes on from what that payment left", async () => {
    const { vt, chain, start, phone, shield, first } = await stoppedAfterOne([float]);
    chain.deposit(centsToMinor(100_00n));
    await vt.run(vt.sleep(MIN));
    chain.combine();
    await vt.run(vt.sleep(MIN));
    const asked = shield.calls.length;
    const stuck = release(chain, phone, shield, start);
    await vt.run(stuck.done);
    expect(shield.calls).toHaveLength(asked);
    expect(stuck.held.get(start.workers[1]!)).toMatch(new RegExp(`^${NOT_FROM_HERE}: this run stopped part-way, and it goes on only from what the payment before this one left, and something else has spent that record .* If Shield's activity shows no payment to them, pay them in Shield; `));
    expect(chain.tokens.find((t) => t.from === first.id)!.spent).toBe(true);

    // Paid in Shield, as the line says. This time Shield's history doesn't list it: nothing is asked, and nobody is paid twice.
    const second = start.links.get(start.workers[1]!)!;
    chain.payByHand(second, centsToMinor(phone.company.payroll.runs[0]!.paychecks[1]!.net));
    shield.listsHistory = false;
    await vt.run(vt.sleep(MIN));
    const blind = release(chain, phone, shield, start);
    await vt.run(blind.done);
    expect(shield.calls).toHaveLength(asked);
    expect(paidEach(chain, start)).toEqual([1, 1, 0]);

    // Once the history lists it, the run finds it and goes on from what it left.
    shield.listsHistory = true;
    await vt.run(vt.sleep(MIN));
    const on = release(chain, phone, shield, start);
    await vt.run(on.done);
    expect(on.held.size).toBe(0);
    expect(paidEach(chain, start)).toEqual([1, 1, 1]);
    expect(shield.payments.at(-1)!.inputs[2]).toBe(chain.tokens.find((t) => t.from === chain.paid(second)[0]!.id)!.plaintext);
  });

  it("a payment found during a release, on an account holding two records: the next one is refused any record but what the found one left, and the next press pays it from that", async () => {
    const vt = new VirtualTime();
    const hours = (i: number) => 30 - i;
    const nets = postedRun(3, undefined, hours).company.payroll.runs[0]!.paychecks.map((p) => centsToMinor(p.net));
    // The second record covers the third payment, and the plan would take it.
    const chain = new Chain(vt, [float, nets[2]! + 1n]);
    const start = postedRun(3, undefined, hours);
    const phone = await firstDevice(start.company);
    const shield = chain.shield();
    shield.behaviour = onPayment((nth) => (nth === 0 && (shield.lagMs = 10 * MIN), "ok"));
    await vt.run(release(chain, phone, shield, start).done);
    expect(paidEach(chain, start)).toEqual([1, 0, 0]);
    shield.lagMs = 1_000;
    await vt.run(vt.sleep(15 * MIN));
    // Continue: the second goes out from what the first left, and Shield throws though it landed. It is found.
    shield.behaviour = onPayment((nth) => (nth === 0 ? "landed, then threw" : "ok"));
    const two = release(chain, phone, shield, start);
    await vt.run(two.done);
    expect(paidEach(chain, start)).toEqual([1, 1, 0]);
    const left = chain.tokens.find((t) => t.from === chain.paid(start.links.get(start.workers[1]!)!)[0]!.id)!.plaintext;
    expect(phone.settlements[2]).toMatchObject({
      status: "failed",
      failure: `${NOT_FROM_HERE}: it goes out only from what the payment before this one left, and another record came up for it this time. Retry asks for it from that record.`,
    });
    expect(shield.payments.slice(2).every((c) => c.inputs[2] === left)).toBe(true);
    await vt.run(vt.sleep(MIN));
    await vt.run(release(chain, phone, shield, start).done);
    expect(paidEach(chain, start)).toEqual([1, 1, 1]);
    expect(shield.payments.slice(2).map((c) => c.inputs[2])).toEqual([left]);
  });

  it("what the first payment left is less than the next payment: the line says so, and nothing is asked", async () => {
    // The first payment goes out of the smaller record, which leaves less than the second person's pay.
    const { vt, chain, start, phone, shield } = await stoppedAfterOne([float, centsToMinor(1_000_00n)]);
    const asked = shield.calls.length;
    for (const wait of [0, 60 * MIN]) {
      await vt.run(vt.sleep(wait));
      const run = release(chain, phone, shield, start);
      await vt.run(run.done);
      expect(shield.calls).toHaveLength(asked);
      expect(run.held.get(start.workers[1]!)).toMatch(new RegExp(`^${NOT_FROM_HERE}: this run stopped part-way, and it goes on only from what the payment before this one left, and that is less than this payment\\. To pay them, pay them in Shield; `));
    }
    expect(paidEach(chain, start)).toEqual([1, 0, 0]);
  });
});

describe("a release, and what it sends besides the payments", () => {
  for (const same of [false, true]) {
    it(`the next week's run, whose period shares days with the last one's, is held on every line in words that name that run, and keeps no record (${same ? "the same" : "other"} amounts)`, async () => {
      const vt = new VirtualTime();
      const chain = new Chain(vt, [float]);
      const start = postedRun(3, { payDate: "2026-11-13", periodStart: "2026-10-31", periodEnd: "2026-11-13" });
      const phone = await firstDevice(start.company);
      const shield = chain.shield();
      await vt.run(release(chain, phone, shield, start).done);
      expect(paidEach(chain, start)).toEqual([1, 1, 1]);
      // The next week, in the same books, with the run page's default period: the 14 days ending on its pay date.
      await vt.run(vt.sleep(60 * MIN));
      const rail = ensureRailAccount(phone.company.books);
      const posted = postPayRun(
        rail.books,
        phone.company.payroll,
        { payDate: "2026-11-20", periodStart: "2026-11-07", periodEnd: "2026-11-20", bankAccountId: rail.accountId, mode: "rail", lines: start.workers.map((workerId, i) => ({ workerId, hours: same ? 20 + i : 10 + i })) },
        { now: () => "2026-11-20T12:00:00.000Z" },
      );
      await phone.updateCompany((c) => ({ ...c, books: posted.books, payroll: posted.payroll }));
      const next = { ...start, runId: posted.run.id };
      const asked = shield.calls.length;
      const run = release(chain, phone, shield, next);
      await vt.run(run.done);
      expect(shield.calls).toHaveLength(asked);
      expect([...run.held.entries()]).toEqual(
        start.workers.map((w) => [w, `${NOT_FROM_HERE}: a pay run on the rail for 2026-10-31 to 2026-11-13 already pays this account, and this run's period shares days with it. Nothing is sent for them from this run; if they are still owed, pay them in Shield.`]),
      );
      // Nothing of the last run's is written to this one's paychecks.
      expect(phone.company.payroll.runs.find((r) => r.id === posted.run.id)!.paychecks.map((p) => p.settlement)).toEqual(start.workers.map(() => ({ status: "pending" })));
      expect(paidEach(chain, start)).toEqual([1, 1, 1]);
    });
  }

  it("a payment found while the explorer couldn't say its block is read again later: another device goes on with the run once it has stopped", async () => {
    const { RailNetworkError } = await import("@pnw/rail");
    const { vt, chain, start, phone, saved } = await posted(4);
    const laptop = await phone.restored(saved);
    const lost = chain.shield();
    lost.behaviour = onPayment((nth) => (nth < 2 ? "ok" : "lost"));
    await vt.run(Promise.race([release(chain, phone, lost, start).done, vt.sleep(5 * MIN)]));
    expect(paidEach(chain, start)).toEqual([1, 1, 0, 0]);
    // While the laptop finds the phone's payments, the explorer can't read a transaction by its id.
    let stumble = true;
    const network = { fetchJson: async (path: string) => (stumble && /^transaction\/at1/.test(path) ? Promise.reject(new RailNetworkError("bad gateway", 502)) : chain.network.fetchJson(path)) };
    const shield = chain.shield();
    await vt.run(release(chain, laptop, shield, start, { network }).done);
    expect(laptop.settlements.slice(0, 2).map((s) => [s.status, s.height])).toEqual([
      ["settled", undefined],
      ["settled", undefined],
    ]);
    stumble = false;
    await vt.run(vt.sleep(2 * 60 * MIN));
    const later = release(chain, laptop, shield, start);
    await vt.run(later.done);
    expect(later.held.size).toBe(0);
    expect(paidEach(chain, start)).toEqual([1, 1, 1, 1]);
  });

  it("a payment Shield took but hadn't answered for when the release ended: the next press hears from this device's Shield that it was accepted, and sends its paystub", async () => {
    const { vt, chain, start, phone } = await posted(1);
    const shield = chain.shield();
    const first = release(chain, phone, shield, start, { queue: { clock: chain.vt.clock, sleep: chain.vt.sleep, tree, limits: { walletCapMs: 5_000 } } });
    await vt.run(first.done);
    expect(phone.settlements[0]).toMatchObject({ status: "pending", reference: expect.stringMatching(/^shield_/) });
    expect(first.delivered).toEqual([]);
    await vt.run(vt.sleep(MIN));
    const second = release(chain, phone, shield, start);
    await vt.run(second.done);
    expect(second.events.find((e) => e.kind === "settled")).not.toHaveProperty("found");
    expect(phone.settlements[0]!.status).toBe("settled");
    expect(second.delivered).toEqual([start.workers[0]]);
    expect(paidEach(chain, start)).toEqual([1]);
  });

  it("a device that only kept the record another device's note names, then found that device's payment, sends no paystub for it", async () => {
    const { vt, chain, start, phone, saved } = await posted(3);
    chain.hidesBusy = true;
    const laptop = await phone.restored(saved);
    const first = chain.shield();
    first.behaviour = onPayment((nth) => (nth === 0 ? { saysFailed: true, landsAfterMs: 4 * MIN } : "lost"));
    await vt.run(Promise.race([release(chain, phone, first, start).done, vt.sleep(MIN)]));
    const shield = chain.shield();
    await vt.run(release(chain, laptop, shield, start).done);
    expect(shield.payments).toEqual([]);
    expect(laptop.settlements[0]!.attempt).toBe(phone.settlements[0]!.attempt);
    await vt.run(vt.sleep(10 * MIN));
    expect(paidEach(chain, start)[0]).toBe(1);
    const later = release(chain, laptop, shield, start);
    await vt.run(later.done);
    expect(laptop.settlements[0]!.status).toBe("settled");
    expect(shield.payments).toEqual([]);
    expect(later.delivered).toEqual([]);
  });

  it("a run of 65 people: the first 64 are marked in one note and paid; the 65th waits, and the next press marks it in a note of its own and pays it", async () => {
    const vt = new VirtualTime();
    const chain = new Chain(vt, [centsToMinor(500_000_00n)]);
    const start = manyAccounts(65);
    const phone = await firstDevice(start.company);
    const shield = chain.shield();
    const run = release(chain, phone, shield, start);
    await vt.run(run.done);
    expect(shield.lettersSent).toHaveLength(1);
    expect(shield.payments).toHaveLength(64);
    expect([...run.held.entries()]).toEqual([[start.workers[64], expect.stringMatching(new RegExp(`^${NOT_YET}: one note to your own account names at most 64 payments`))]]);
    const again = release(chain, phone, shield, start);
    await vt.run(again.done);
    expect(again.held.size).toBe(0);
    expect(shield.lettersSent).toHaveLength(2);
    expect(paidEach(chain, start)).toEqual(start.workers.map(() => 1));
    expect(phone.settlements.every((s) => s.status === "settled")).toBe(true);
  }, 60_000);

  it("a run of 65 that stops part-way in the first press and again in the second: the 65th waits until the 64 before it are paid, then is marked first in a note of its own, and everyone is paid once", async () => {
    const vt = new VirtualTime();
    const chain = new Chain(vt, [centsToMinor(500_000_00n)]);
    const start = manyAccounts(65);
    const phone = await firstDevice(start.company);
    const shield = chain.shield();
    // Press 1: the 10th payment is turned down, and the run stops there.
    shield.behaviour = onPayment((nth) => (nth === 9 ? "declined" : "ok"));
    await vt.run(release(chain, phone, shield, start).done);
    expect(paidEach(chain, start).filter((n) => n === 1)).toHaveLength(9);
    // Press 2: the 6th payment asked this time is turned down. The 65th isn't marked while those before it are still owed.
    await vt.run(vt.sleep(MIN));
    shield.behaviour = onPayment((nth) => (nth === 5 ? "declined" : "ok"));
    const two = release(chain, phone, shield, start);
    await vt.run(two.done);
    expect(paidEach(chain, start).filter((n) => n === 1)).toHaveLength(14);
    expect([...two.held.entries()]).toEqual([
      [start.workers[64], `${NOT_YET}: the payments a note already names for this run go out first, and this one is marked in a note of its own once they are paid: press Pay now or Continue again then.`],
    ]);
    expect(shield.lettersSent).toHaveLength(1);
    // Press 3 pays the rest of the 64; press 4 marks the 65th, first in its note and so naming its record, and pays it.
    shield.behaviour = () => "ok";
    for (const press of [3, 4]) {
      await vt.run(vt.sleep(MIN));
      await vt.run(release(chain, phone, shield, start).done);
      expect(phone.settlements[64]!.status, `press ${press}`).toBe(press === 3 ? "pending" : "settled");
    }
    expect(paidEach(chain, start)).toEqual(start.workers.map(() => 1));
    const notes = await desk(chain, phone, shield).read();
    expect(notes.map((l) => l.marker.lines.length)).toEqual([64, 1]);
    expect(notes[1]!.marker.lines[0]!.tag).toMatch(/^[0-9a-f]{32}$/);
  }, 60_000);

  it("a run of 66 that stalls after its first payment in two presses running: each later press pays on, and everyone is paid once", async () => {
    const vt = new VirtualTime();
    const chain = new Chain(vt, [centsToMinor(500_000_00n)]);
    const start = manyAccounts(66);
    const phone = await firstDevice(start.company);
    const shield = chain.shield();
    // Presses 1 and 2: Shield is slow to list what the first payment of the press left, so each stops after one payment.
    for (const press of [1, 2]) {
      shield.behaviour = onPayment((nth) => (nth === 0 && (shield.lagMs = 10 * MIN), "ok"));
      const run = release(chain, phone, shield, start);
      await vt.run(run.done);
      expect(paidEach(chain, start).filter((n) => n === 1), `press ${press}`).toHaveLength(press);
      expect([...run.held.keys()], `press ${press}`).toEqual([start.workers[64], start.workers[65]]);
      shield.lagMs = 1_000;
      await vt.run(vt.sleep(15 * MIN));
    }
    shield.behaviour = () => "ok";
    for (let press = 3; press <= 4; press++) {
      await vt.run(release(chain, phone, shield, start).done);
      await vt.run(vt.sleep(MIN));
    }
    expect(paidEach(chain, start)).toEqual(start.workers.map(() => 1));
    expect(phone.settlements.every((s) => s.status === "settled")).toBe(true);
  }, 60_000);
});

describe("a payment Shield didn't confirm", () => {
  it("Shield says failed, the payment lands 20 s later; the worker is paid once", async () => {
    const { vt, chain, start, phone } = await posted(2, [centsToMinor(20_000_00n), centsToMinor(33_000_00n)]);
    const shield = chain.shield();
    shield.behaviour = onPayment((nth) => (nth === 0 ? { saysFailed: true, landsAfterMs: 20_000 } : "ok"));
    await vt.run(release(chain, phone, shield, start).done);
    expect(phone.settlements[0]).toMatchObject({ status: "pending" });
    expect(phone.settlements[0]!.failure).toMatch(/Shield reported a problem/);
    // One tap on Pay again, at once, and Continue.
    expect(await vt.run(payAgain(context(chain, phone, shield, start), start.workers[0]!))).toBe("same-record");
    await vt.run(release(chain, phone, shield, start).done);
    await vt.run(vt.sleep(MIN));
    await vt.run(release(chain, phone, shield, start).done);
    expect(paidEach(chain, start)).toEqual([1, 1]);
    expect(phone.settlements.map((s) => s.status)).toEqual(["settled", "settled"]);
    // Both tries named the same record.
    expect(new Set(shield.payments.filter((c) => c.inputs[0] === start.links.get(start.workers[0]!)).map((c) => c.inputs[2])).size).toBe(1);
  });

  for (const hidesBusy of [false, true]) {
    it(`Shield says failed; two records are listed; the payment lands 6 minutes later: the worker is paid once (Shield ${hidesBusy ? "no longer lists" : "still lists"} the record it is spending)`, async () => {
      const { vt, chain, start, phone } = await posted(2, [centsToMinor(20_000_00n), centsToMinor(33_000_00n)]);
      chain.hidesBusy = hidesBusy;
      const shield = chain.shield();
      shield.behaviour = onPayment((nth) => (nth === 0 ? { saysFailed: true, landsAfterMs: 6 * MIN } : "ok"));
      await vt.run(release(chain, phone, shield, start).done);
      const first = start.links.get(start.workers[0]!)!;
      // Five and a half minutes on, nothing has landed. The person taps Pay again, then Continue.
      await vt.run(vt.sleep(5 * MIN));
      const outcome = await vt.run(payAgain(context(chain, phone, shield, start), start.workers[0]!));
      expect(outcome).toBe(hidesBusy ? "check-later" : "same-record");
      if (hidesBusy) expect(phone.settlements[0]!.failure).toMatch(/^Not confirmed: check again at \d{1,2}:\d{2} [AP]M\. /);
      await vt.run(release(chain, phone, shield, start).done);
      // Whatever was asked for them, it named the one record the first try set aside: never the other one.
      expect(new Set(shield.payments.filter((c) => c.inputs[0] === first).map((c) => c.inputs[2])).size).toBe(1);
      await vt.run(vt.sleep(10 * MIN));
      await vt.run(release(chain, phone, shield, start).done);
      expect(paidEach(chain, start)).toEqual([1, 1]);
      expect(phone.settlements.map((s) => s.status)).toEqual(["settled", "settled"]);
    });
  }

  it("Shield says failed and the payment lands; pay again finds it: nothing is sent again, the line says it was found, and Continue settles it", async () => {
    const { vt, chain, start, phone } = await posted(1);
    const shield = chain.shield();
    shield.behaviour = onPayment(() => ({ saysFailed: true, landsAfterMs: 20_000 }));
    await vt.run(release(chain, phone, shield, start).done);
    expect(phone.settlements[0]).toMatchObject({ status: "pending" });
    await vt.run(vt.sleep(MIN));
    expect(await vt.run(payAgain(context(chain, phone, shield, start), start.workers[0]!))).toBe("check-later");
    expect(phone.settlements[0]!.failure).toBe("Not confirmed: a payment to them for this amount was found in the account's own transfers, so nothing was sent again. Continue settles it.");
    await vt.run(release(chain, phone, shield, start).done);
    expect(phone.settlements[0]!.status).toBe("settled");
    expect(shield.payments).toHaveLength(1);
    expect(paidEach(chain, start)).toEqual([1]);
  });

  it("pay again takes another record only once the old one is known to have gone into something else, and says so to every device", async () => {
    const { vt, chain, start, phone, saved } = await posted(3, [centsToMinor(20_000_00n)]);
    const shield = chain.shield();
    shield.behaviour = onPayment((nth) => (nth === 0 ? "declined" : "ok"));
    await vt.run(release(chain, phone, shield, start).done);
    const old = phone.settlements[0]!.attempt!;
    // Money arrives and Shield combines it with the record the first payment had set aside.
    chain.deposit(centsToMinor(5_000_00n));
    await vt.run(vt.sleep(5_000));
    chain.combine();
    await vt.run(vt.sleep(5_000));
    await vt.run(release(chain, phone, shield, start).done);
    expect(phone.settlements[0]!.failure!.startsWith(NOT_PAID)).toBe(true);
    // The others are paid from what the first payment leaves, so they wait for it: nothing was asked for them.
    expect(paidEach(chain, start)).toEqual([0, 0, 0]);
    expect(shield.payments).toHaveLength(1);
    expect(phone.settlements[1]).toMatchObject({ status: "failed", failure: `${NOT_FROM_HERE}: it is paid from what the payment before it in this run leaves, and that payment hasn't been found yet.` });
    expect(phone.settlements[1]!.attempt).toBeUndefined();

    expect(await vt.run(payAgain(context(chain, phone, shield, start), start.workers[0]!))).toBe("another-record");
    expect(phone.settlements[0]).toMatchObject({ status: "failed", failure: PAY_AGAIN_NOTE, replaces: old });
    expect(phone.settlements[0]!.attempt).toBeUndefined();
    await vt.run(release(chain, phone, shield, start).done);
    expect(paidEach(chain, start)).toEqual([1, 1, 1]);
    // A second note took the first line's place: one live line for that payee, naming the new record.
    expect(shield.lettersSent).toHaveLength(2);
    const live = liveLines(await desk(chain, phone, shield).read()).filter((l) => l.to === start.links.get(start.workers[0]!));
    expect(live).toHaveLength(1);
    expect(live[0]!.tag).not.toBe(old);

    // A third device, restored from before any of it, follows the new line and pays nobody.
    const third = await phone.restored(saved);
    const late = chain.shield();
    await vt.run(release(chain, third, late, start).done);
    expect(late.calls).toEqual([]);
    expect(third.settlements.map((s) => s.status)).toEqual(["settled", "settled", "settled"]);
    expect(paidEach(chain, start)).toEqual([1, 1, 1]);
  });

  it("money arrives while the first prompt is open and Shield combines the records: the payment is asked again from the new record, and a note says so first", async () => {
    const { vt, chain, start, phone, saved } = await posted(3, [centsToMinor(20_000_00n)]);
    const shield = chain.shield();
    shield.behaviour = onPayment((nth) => {
      if (nth === 0) {
        chain.deposit(centsToMinor(5_000_00n));
        chain.combine();
      }
      return "ok";
    });
    await vt.run(release(chain, phone, shield, start).done);
    expect(paidEach(chain, start)).toEqual([1, 1, 1]);
    // Asked, in order: the marker, the first payment (its record was gone), a note replacing that line, then the three payments.
    expect(shield.calls.map((c) => (c.program === USDCX ? "payment" : "note"))).toEqual(["note", "payment", "note", "payment", "payment", "payment"]);
    const listed = await desk(chain, phone, shield).read();
    const live = liveLines(listed).filter((l) => l.to === start.links.get(start.workers[0]!));
    expect(live.map((l) => l.tag)).toEqual([await recordTag(shield.payments[1]!.inputs[2]!)]);
    expect(listed[1]!.marker.lines).toEqual([{ to: live[0]!.to, minor: live[0]!.minor, tag: live[0]!.tag, replaces: await recordTag(shield.payments[0]!.inputs[2]!) }]);

    const laptop = await phone.restored(saved);
    const late = chain.shield();
    await vt.run(release(chain, laptop, late, start).done);
    expect(late.calls).toEqual([]);
    expect(laptop.settlements.every((s) => s.status === "settled")).toBe(true);
  });

  it("pay again keeps a record that changed while Shield was being asked, and does nothing to a settled paycheck", async () => {
    const { vt, chain, start, phone } = await posted(1);
    const shield = chain.shield();
    shield.behaviour = onPayment(() => "declined");
    await vt.run(release(chain, phone, shield, start).done);
    const [w] = start.workers as [string];
    const other = "ee".repeat(16);
    // The books change under the look: another try kept another record.
    const ctx = context(chain, phone, shield, start);
    const slow = { ...ctx, wallet: { ...shield, requestRecords: async (program: string) => (await phone.updateCompany((c) => ({ ...c, payroll: settleTo(c.payroll, start.runId, w, { status: "pending", attempt: other }) })), shield.requestRecords(program)) } };
    expect(await vt.run(payAgain(slow as typeof ctx, w))).toBe("same-record");
    expect(phone.settlements[0]).toMatchObject({ status: "failed", failure: PAY_AGAIN_NOTE, attempt: other });
    const settled = await phone.updateCompany((c) => ({ ...c, payroll: markPaycheckSettlement(settleTo(c.payroll, start.runId, w, { status: "pending", attempt: other }), start.runId, w, { status: "settled", reference: "at1" + "q".repeat(58) }) }));
    await vt.run(payAgain(ctx, w));
    expect(phone.company).toBe(settled);
  });
});

describe("a release keeps to Shield and the explorer", () => {
  it("registers no view key with a record scanner: no view key reaches the release or the markers", () => {
    for (const file of ["./release.ts", "./run_marker.ts"]) {
      const source = readFileSync(new URL(file, import.meta.url), "utf8");
      const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      const imports = [...code.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]!);
      expect(imports.filter((i) => /records|view_key|sdk|decrypt/.test(i)), file).toEqual([]);
      expect(code, file).not.toMatch(/view_key|(?<!transition)viewkey|openOwnRecord|openRecord|@provablehq\/sdk|@pnw\/records|scanner|register|fetch\(/i);
    }
  });

  it("is wired as the pay panel expects: a payment Shield took keeps when its try ended, Pay again's record check is bounded, and the panel is told when a payment is looked for", () => {
    const release = readFileSync(new URL("./release.ts", import.meta.url), "utf8");
    const panel = readFileSync(new URL("./PayPanel.tsx", import.meta.url), "utf8");
    expect(release).toMatch(/case "sent":\s*note\(e\.workerId, \{[\s\S]*?\.\.\.\(e\.endedAt \? \{ endedAt: e\.endedAt \} : \{\}\),?\s*\}\);\s*break;\s*case "settled"/);
    expect(release).toMatch(/await recordListedForPayAgain\(ctx\.wallet, tried\)/);
    expect(release).not.toMatch(/recordStillListed/);
    expect(release).toMatch(/ctx\.onLooking\?\.\(q\.workerId\);\s*return findPayment\(q\);/);
    expect(panel).toMatch(/onLooking: \(workerId\) => setStage\(workerId, \{ kind: "looking" \}\)/);
  });
});
