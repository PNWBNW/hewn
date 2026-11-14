// A rail run released the way the pay panel releases it (`releaseRun`), with no screen: the books
// of one or two devices, a pretend Shield on each, one account on a pretend chain
// (release_test_helpers.ts). What is checked is what the books are told and what the chain holds.
import { describe, expect, it } from "vitest";
import { markPaycheckSettlement } from "@pnw/payroll";
import { centsToMinor } from "@pnw/rail";
import { type ReleaseContext, releaseRun, settleTo } from "./release";
import { Chain, type Device, type Shield, VirtualTime, firstDevice, postedRun, tree } from "./release_test_helpers";

type Start = ReturnType<typeof postedRun>;

/** One release on one device: the pay panel's call, with the paystubs noted instead of sent. */
function release(chain: Chain, device: Device, shield: Shield, start: Start, extra: Partial<ReleaseContext> = {}) {
  const delivered: string[] = [];
  const errors: unknown[] = [];
  const done = releaseRun({
    wallet: shield,
    network: chain.network,
    runId: start.runId,
    links: start.links,
    updateCompany: device.updateCompany,
    lookup: { wallet: shield, decrypt: chain.decrypt, shieldWaitMs: 50 },
    deliver: async (workerId) => void delivered.push(workerId),
    onError: (e) => errors.push(e),
    queue: { clock: chain.vt.clock, sleep: chain.vt.sleep, tree },
    ...extra,
  });
  return { done, delivered, errors };
}

/** How many payments reached each person in the run, in the run's order. */
const paidEach = (chain: Chain, start: Start) => start.workers.map((w) => chain.paid(start.links.get(w)!).length);

const float = centsToMinor(50_000_00n);

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
      expect(writes[0]).toMatchObject({ status: "pending" });
      expect(writes[0]!.attempt).toMatch(/^[0-9a-f]{32}$/);
      expect(writes[0]!.reference).toBeUndefined();
      // Once Shield took it: its own id for the request, with the same record.
      expect(writes[1]).toMatchObject({ status: "pending", attempt: writes[0]!.attempt });
      expect(writes[1]!.reference).toMatch(/^shield_/);
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
    expect(order[0]).toBe("prompts payment,payment,paystub,paystub after 0 calls");
    expect(order.filter((o) => o === "settled")).toHaveLength(2);
    expect(order.slice(-3)).toEqual(["paid", "paystub", "paystub"]);
  });

  it("an approval left to expire writes failed with its record kept, and the people after it are left as they were", async () => {
    const vt = new VirtualTime();
    const chain = new Chain(vt, [float]);
    const start = postedRun(3);
    const device = await firstDevice(start.company);
    const shield = chain.shield();
    shield.behaviour = (_call, n) => (n === 1 ? "expired" : "ok");
    const out = await vt.run(release(chain, device, shield, start).done);

    expect(out.stalled).toBe(true);
    const [first, second, third] = device.settlements;
    expect(first!.status).toBe("settled");
    expect(second).toMatchObject({ status: "failed", failure: "Approval expired. Request a fresh action." });
    expect(second!.attempt).toMatch(/^[0-9a-f]{32}$/);
    expect(third).toEqual({ status: "pending" });
    expect(paidEach(chain, start)).toEqual([1, 0, 0]);
  });

  it("a request Shield turned down is written not confirmed, never failed, with its record kept", async () => {
    const vt = new VirtualTime();
    const chain = new Chain(vt, [float]);
    const start = postedRun(2);
    const device = await firstDevice(start.company);
    const shield = chain.shield();
    shield.behaviour = () => "declined";
    const run = release(chain, device, shield, start);
    await vt.run(run.done);
    const [first, second] = device.settlements;
    expect(first!.status).toBe("pending");
    expect(first!.failure).toMatch(/Shield reported a problem \(User rejected the request\)/);
    expect(first!.attempt).toMatch(/^[0-9a-f]{32}$/);
    expect(first!.endedAt).toBeDefined();
    expect(second).toEqual({ status: "pending" });
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
});

describe("two devices and one run", () => {
  // Known today: the second device holds none of what the first kept, so it pays the run again.
  it.fails("the phone pays 6 of 6; the laptop restored from the earlier backup pays nobody again", async () => {
    const vt = new VirtualTime();
    const chain = new Chain(vt, [float]);
    const start = postedRun(6);
    const phone = await firstDevice(start.company);
    const laptop = await phone.restored(); // the books as they were before the release
    await vt.run(release(chain, phone, chain.shield(), start).done);
    expect(paidEach(chain, start)).toEqual([1, 1, 1, 1, 1, 1]);

    const shield = chain.shield();
    await vt.run(release(chain, laptop, shield, start).done);
    expect(paidEach(chain, start)).toEqual([1, 1, 1, 1, 1, 1]);
    expect(shield.approvals).toBe(0);
  });
});
