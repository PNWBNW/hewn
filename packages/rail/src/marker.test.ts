import { describe, expect, it } from "vitest";
import {
  type ListedMarker,
  MAX_MARKER_LINES,
  type MarkedPayment,
  type MarkerLine,
  type RunMarker,
  beaten,
  decideLines,
  decodeMarker,
  encodeMarker,
  liveLines,
  newMarkerId,
  orderMarkers,
  startingTag,
} from "./marker";
import { RailError } from "./types";

// ---- Fixtures ------------------------------------------------------------------

/** A well-formed account: `aleo1` and 58 characters of the address alphabet. */
const ADDR = (n: number) => `aleo1payee${"acdefghjkl"[n]}`.padEnd(63, "q");
const TAG = (n: number) => n.toString(16).padStart(32, "0");
const ID = (n: number) => n.toString(16).padStart(32, "f");
const TX = (n: number) => `at1tx${"acdefghjkl"[n]}`.padEnd(61, "x");

const NOV = { from: "2026-10-24", until: "2026-11-06" };
const OCT = { from: "2026-10-10", until: "2026-10-23" };

const marker = (id: number, lines: MarkerLine[], period = NOV): RunMarker => ({ v: 1, id: ID(id), ...period, lines });
const listed = (m: RunMarker, height: number, tx = 0): ListedMarker => ({ marker: m, height, txId: TX(tx) });
const payment = (workerId: string, to: string, minor: bigint, more: Partial<MarkedPayment> = {}): MarkedPayment => ({ workerId, to, minor, ...NOV, ...more });

// ---- The format ------------------------------------------------------------------

describe("a run marker's format", () => {
  const whole = marker(1, [
    { to: ADDR(1), minor: 1_234_560_000n, tag: TAG(1) },
    { to: ADDR(2), minor: 2_000_000_000n },
    { to: ADDR(3), minor: 1n, tag: TAG(3), replaces: TAG(9) },
  ]);

  it("goes to text and back unchanged, amounts as whole numbers of minor units", () => {
    const text = encodeMarker(whole);
    expect(decodeMarker(text)).toEqual(whole);
    expect(JSON.parse(text).lines[0].minor).toBe("1234560000");
    expect(encodeMarker(decodeMarker(text))).toBe(text);
  });

  it("names accounts, a period, amounts and record tags, and nothing else: no person, no run", () => {
    const parsed = JSON.parse(encodeMarker(whole)) as { lines: object[] };
    expect(Object.keys(parsed)).toEqual(["v", "id", "from", "until", "lines"]);
    expect(Object.keys(parsed.lines[0]!)).toEqual(["to", "minor", "tag"]);
    expect(Object.keys(parsed.lines[1]!)).toEqual(["to", "minor"]); // a later line of a chained run names no record
    expect(Object.keys(parsed.lines[2]!)).toEqual(["to", "minor", "tag", "replaces"]);
  });

  it("makes ids of 128 random bits", () => {
    const a = newMarkerId();
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(newMarkerId()).not.toBe(a);
  });

  const wire = (change: (m: { [k: string]: unknown; lines: { [k: string]: unknown }[] }) => void): string => {
    const m = JSON.parse(encodeMarker(whole));
    change(m);
    return JSON.stringify(m);
  };

  it("decode refuses an unknown key, a 65th line, and a malformed address or tag", () => {
    const refused = (text: string) => expect(() => decodeMarker(text)).toThrow(RailError);
    refused(wire((m) => (m.runId = "run-1")));
    refused(wire((m) => (m.lines[0]!.workerId = "wkr-1")));
    const line = { to: ADDR(1), minor: "1" };
    expect(decodeMarker(wire((m) => (m.lines = Array(MAX_MARKER_LINES).fill(line)))).lines).toHaveLength(64);
    refused(wire((m) => (m.lines = Array(MAX_MARKER_LINES + 1).fill(line))));
    refused(wire((m) => (m.lines[0]!.to = "aleo1short")));
    refused(wire((m) => (m.lines[0]!.to = ADDR(1).toUpperCase())));
    refused(wire((m) => (m.lines[0]!.to = `${ADDR(1).slice(0, 62)}b`))); // not in the address alphabet
    refused(wire((m) => (m.lines[0]!.tag = "abc")));
    refused(wire((m) => (m.lines[0]!.tag = TAG(1).toUpperCase().replace(/0/g, "A"))));
    refused(wire((m) => (m.lines[2]!.replaces = "nope")));
  });

  it("decode refuses anything else that is off: the version, the id, the period, an amount, an empty or repeated line", () => {
    const refused = (text: string) => expect(() => decodeMarker(text)).toThrow(RailError);
    refused("not json");
    refused("null");
    refused("[]");
    refused(wire((m) => (m.v = 2)));
    refused(wire((m) => delete m.v));
    refused(wire((m) => (m.id = "f".repeat(31))));
    refused(wire((m) => (m.from = "2026-02-30")));
    refused(wire((m) => (m.until = "06/11/2026")));
    refused(wire((m) => ((m.from = "2026-11-07"), (m.until = "2026-11-06")))); // ends before it starts
    refused(wire((m) => (m.lines = [])));
    refused(wire((m) => (m.lines = "none" as never)));
    refused(wire((m) => (m.lines[0] = null as never)));
    refused(wire((m) => (m.lines[0]!.minor = 5 as never))); // a number, not text
    refused(wire((m) => (m.lines[0]!.minor = "0")));
    refused(wire((m) => (m.lines[0]!.minor = "012")));
    refused(wire((m) => (m.lines[0]!.minor = "1.5")));
    refused(wire((m) => (m.lines[0]!.minor = "-3")));
    refused(wire((m) => (m.lines[0]!.minor = (2n ** 128n).toString()))); // more than a record can hold
    refused(wire((m) => delete m.lines[0]!.to));
    refused(wire((m) => (m.lines[2]!.replaces = TAG(3)))); // a line can't take the place of itself
    refused(wire((m) => (m.lines[2]!.tag = TAG(1)))); // one record, two lines
  });

  it("encode refuses what decode would", () => {
    expect(() => encodeMarker(marker(1, []))).toThrow(RailError);
    expect(() => encodeMarker(marker(1, [{ to: "aleo1short", minor: 1n }]))).toThrow(RailError);
    expect(() => encodeMarker(marker(1, [{ to: ADDR(1), minor: 0n }]))).toThrow(RailError);
    expect(() => encodeMarker({ ...marker(1, [{ to: ADDR(1), minor: 1n }]), id: "run-1" })).toThrow(RailError);
    expect(() => encodeMarker({ ...marker(1, [{ to: ADDR(1), minor: 1n }]), workerId: "wkr-1" } as RunMarker)).toThrow(RailError);
  });

  it("the record a chained run starts from is the first one its lines name", () => {
    expect(startingTag(whole)).toBe(TAG(1));
    expect(startingTag(marker(2, [{ to: ADDR(1), minor: 1n }]))).toBeUndefined();
  });
});

// ---- Which marker comes first ------------------------------------------------------

describe("the order of markers", () => {
  const a = listed(marker(1, [{ to: ADDR(1), minor: 5n, tag: TAG(1) }]), 100, 2);
  const b = listed(marker(2, [{ to: ADDR(1), minor: 5n, tag: TAG(2) }]), 100, 1);
  const c = listed(marker(3, [{ to: ADDR(1), minor: 5n, tag: TAG(3) }]), 99, 3);

  it("is by the block each was accepted in, then by transaction id, however they were listed", () => {
    expect(orderMarkers([a, b, c]).map((l) => l.marker.id)).toEqual([ID(3), ID(2), ID(1)]);
    expect(orderMarkers([b, c, a]).map((l) => l.marker.id)).toEqual([ID(3), ID(2), ID(1)]);
    expect([a, b, c].map((l) => l.marker.id)).toEqual([ID(1), ID(2), ID(3)]); // the list given is left as it was
  });

  it("a line named in replaces is not live; its replacement is", () => {
    const first = listed(marker(1, [{ to: ADDR(1), minor: 5n, tag: TAG(1) }, { to: ADDR(2), minor: 7n }]), 100);
    const second = listed(marker(2, [{ to: ADDR(1), minor: 5n, tag: TAG(2), replaces: TAG(1) }]), 120);
    const live = liveLines([second, first]);
    expect(live.map((l) => [l.marker, l.to, l.tag])).toEqual([
      [ID(1), ADDR(2), undefined],
      [ID(2), ADDR(1), TAG(2)],
    ]);
    expect(live[0]).toMatchObject({ ...NOV, height: 100, minor: 7n });
    // What it leads to: the payment resumes on the replacement's record, from the replacement's height.
    expect(decideLines([first, second], [payment("w1", ADDR(1), 5n)])).toEqual([{ workerId: "w1", kind: "resume", marker: ID(2), since: 120, tag: TAG(2) }]);
  });
});

// ---- What a device does with each payment -----------------------------------------------

describe("decideLines", () => {
  const phone = listed(
    marker(1, [
      { to: ADDR(1), minor: 500n, tag: TAG(1) },
      { to: ADDR(2), minor: 700n },
      { to: ADDR(3), minor: 900n },
    ]),
    100,
  );

  it("a payment no live line covers is fresh", () => {
    expect(decideLines([], [payment("w1", ADDR(1), 500n)])).toEqual([{ workerId: "w1", kind: "fresh" }]);
    expect(decideLines([phone], [payment("w4", ADDR(4), 500n)])).toEqual([{ workerId: "w4", kind: "fresh" }]);
  });

  it("the same payee, period and amount under different run ids resumes", () => {
    // The books were restored and number their people and runs differently: the marker names neither.
    const out = decideLines([phone], [payment("wkr-17", ADDR(1), 500n)]);
    expect(out).toEqual([{ workerId: "wkr-17", kind: "resume", marker: ID(1), since: 100, tag: TAG(1) }]);
  });

  it("a period that only touches the marked one is the same period; one beside it is not", () => {
    const touching = { from: "2026-11-06", until: "2026-11-20" };
    expect(decideLines([phone], [payment("w1", ADDR(1), 500n, touching)])[0]).toMatchObject({ kind: "resume" });
    const after = { from: "2026-11-07", until: "2026-11-20" };
    expect(decideLines([phone], [payment("w1", ADDR(1), 500n, after)])[0]).toEqual({ workerId: "w1", kind: "fresh" });
  });

  it("a correction for the previous period doesn't match this period's line", () => {
    expect(decideLines([phone], [payment("w1", ADDR(1), 120n, OCT)])).toEqual([{ workerId: "w1", kind: "fresh" }]);
    // And the other way about: a marker for the correction doesn't cover this period's pay.
    const correction = listed(marker(2, [{ to: ADDR(1), minor: 120n, tag: TAG(5) }], OCT), 90);
    expect(decideLines([correction], [payment("w1", ADDR(1), 500n)])).toEqual([{ workerId: "w1", kind: "fresh" }]);
  });

  it("another person under a reused worker id, at another address, is fresh", () => {
    expect(decideLines([phone], [payment("w1", ADDR(5), 500n)])).toEqual([{ workerId: "w1", kind: "fresh" }]);
  });

  it("two live lines for one payee and period: the earliest marker wins", () => {
    const laptop = listed(marker(2, [{ to: ADDR(1), minor: 500n, tag: TAG(2) }]), 101);
    for (const order of [
      [phone, laptop],
      [laptop, phone],
    ]) {
      expect(decideLines(order, [payment("w1", ADDR(1), 500n)])).toEqual([{ workerId: "w1", kind: "resume", marker: ID(1), since: 100, tag: TAG(1) }]);
    }
    // In one block, the lower transaction id is the earlier.
    const sameBlock = { ...laptop, height: 100, txId: TX(1) };
    const later = { ...phone, txId: TX(2) };
    expect(decideLines([later, sameBlock], [payment("w1", ADDR(1), 500n)])).toEqual([{ workerId: "w1", kind: "resume", marker: ID(2), since: 100, tag: TAG(2) }]);
  });

  it("another amount for a marked period is refused", () => {
    expect(decideLines([phone], [payment("w1", ADDR(1), 501n)])).toEqual([{ workerId: "w1", kind: "refused", why: "other-amount" }]);
    // Even when a line at this amount is listed too, earlier or later.
    const same = listed(marker(2, [{ to: ADDR(1), minor: 501n, tag: TAG(2) }]), 50);
    expect(decideLines([phone, same], [payment("w1", ADDR(1), 501n)])).toEqual([{ workerId: "w1", kind: "refused", why: "other-amount" }]);
  });

  it("a payment that already holds another record than the one marked is refused", () => {
    expect(decideLines([phone], [payment("w1", ADDR(1), 500n, { attempt: TAG(8) })])).toEqual([{ workerId: "w1", kind: "refused", why: "other-record" }]);
    expect(decideLines([phone], [payment("w1", ADDR(1), 500n, { attempt: TAG(1) })])).toEqual([{ workerId: "w1", kind: "resume", marker: ID(1), since: 100, tag: TAG(1) }]);
  });

  it("a payment's own replaced record is not a line against it", () => {
    // The person chose to pay again: the line for the old record is set aside, so the payment is marked afresh.
    expect(decideLines([phone], [payment("w1", ADDR(1), 500n, { replaces: TAG(1) })])).toEqual([{ workerId: "w1", kind: "fresh" }]);
    // Another amount under the old record doesn't refuse it either.
    expect(decideLines([phone], [payment("w1", ADDR(1), 450n, { replaces: TAG(1) })])).toEqual([{ workerId: "w1", kind: "fresh" }]);
  });

  it("a live chained line without a tag is not paid by a second device", () => {
    // The phone marked three payments from one record: only the first names it. A laptop with the same books opens the run.
    const laptop = decideLines([phone], [payment("w1", ADDR(1), 500n), payment("w2", ADDR(2), 700n), payment("w3", ADDR(3), 900n)]);
    expect(laptop).toEqual([
      { workerId: "w1", kind: "resume", marker: ID(1), since: 100, tag: TAG(1) }, // only by spending the record the phone named
      { workerId: "w2", kind: "elsewhere", marker: ID(1), since: 100, start: TAG(1) },
      { workerId: "w3", kind: "elsewhere", marker: ID(1), since: 100, start: TAG(1) },
    ]);
    // Neither is fresh, so no second marker is sent for them, and neither is given a record to spend.
    expect(laptop.filter((d) => d.kind === "fresh")).toEqual([]);
    // It holds a record of its own for one of them from before: still not its to pay.
    expect(decideLines([phone], [payment("w2", ADDR(2), 700n, { attempt: TAG(6) })])[0]).toMatchObject({ kind: "elsewhere" });
    // A marker listed twice, or a later marker from the laptop itself, changes nothing: the earliest line stands.
    const own = listed(marker(2, [{ to: ADDR(2), minor: 700n, tag: TAG(7) }]), 130);
    expect(decideLines([own, phone], [payment("w2", ADDR(2), 700n)], [ID(2)])[0]).toMatchObject({ kind: "elsewhere", marker: ID(1) });
  });

  it("the device that sent the marker goes on with its own chained lines, each keeping the record it holds", () => {
    const out = decideLines([phone], [payment("w2", ADDR(2), 700n), payment("w3", ADDR(3), 900n, { attempt: TAG(4) })], [ID(1)]);
    expect(out).toEqual([
      { workerId: "w2", kind: "resume", marker: ID(1), since: 100 },
      { workerId: "w3", kind: "resume", marker: ID(1), since: 100 },
    ]);
  });

  it("two payments to one account over one period read the same lines", () => {
    // Matched by payee, period and amount alone: at one amount both are sent to the one record named, so a caller doesn't mark such a run.
    const twice = listed(marker(3, [{ to: ADDR(1), minor: 500n, tag: TAG(1) }, { to: ADDR(1), minor: 500n }]), 100);
    expect(decideLines([twice], [payment("w1", ADDR(1), 500n), payment("w2", ADDR(1), 500n)], [ID(3)])).toEqual([
      { workerId: "w1", kind: "resume", marker: ID(3), since: 100, tag: TAG(1) },
      { workerId: "w2", kind: "resume", marker: ID(3), since: 100, tag: TAG(1) },
    ]);
    // At two amounts, each is another amount to the other: neither is paid from here.
    const apart = listed(marker(4, [{ to: ADDR(1), minor: 500n, tag: TAG(1) }, { to: ADDR(1), minor: 510n }]), 100);
    expect(decideLines([apart], [payment("w1", ADDR(1), 500n), payment("w2", ADDR(1), 510n)], [ID(4)])).toEqual([
      { workerId: "w1", kind: "refused", why: "other-amount" },
      { workerId: "w2", kind: "refused", why: "other-amount" },
    ]);
  });

  it("decides each payment on its own, in the order given", () => {
    const out = decideLines([phone], [payment("w9", ADDR(9), 1n), payment("w1", ADDR(1), 2n), payment("w2", ADDR(2), 700n)]);
    expect(out.map((d) => [d.workerId, d.kind])).toEqual([
      ["w9", "fresh"],
      ["w1", "refused"],
      ["w2", "elsewhere"],
    ]);
  });
});

// ---- Two devices marking at once ---------------------------------------------------------

describe("beaten", () => {
  const phone = listed(marker(1, [{ to: ADDR(1), minor: 500n, tag: TAG(1) }, { to: ADDR(2), minor: 700n }]), 100, 1);
  const laptop = listed(marker(2, [{ to: ADDR(2), minor: 700n, tag: TAG(2) }, { to: ADDR(3), minor: 900n }]), 100, 2);

  it("a marker is beaten when one accepted before it holds a live line for one of its payees over the same period", () => {
    expect(beaten([phone, laptop], ID(2))).toBe(true);
    expect(beaten([laptop, phone], ID(2))).toBe(true);
    expect(beaten([phone, laptop], ID(1))).toBe(false); // the earliest stands
  });

  it("not by a marker for other payees, another period, or a line it replaces", () => {
    const others = listed(marker(3, [{ to: ADDR(4), minor: 700n, tag: TAG(3) }]), 90);
    const lastPeriod = listed(marker(4, [{ to: ADDR(2), minor: 700n, tag: TAG(4) }], OCT), 80);
    expect(beaten([others, lastPeriod, laptop], ID(2))).toBe(false);
    const again = listed(marker(5, [{ to: ADDR(1), minor: 500n, tag: TAG(5), replaces: TAG(1) }]), 140);
    expect(beaten([phone, again], ID(5))).toBe(false);
    // The same marker listed twice is not its own rival.
    expect(beaten([laptop, { ...laptop, height: 99 }], ID(2))).toBe(false);
  });

  it("a marker that repeats a payment already marked reads as beaten by it: a marker holds fresh payments only", () => {
    const repeats = listed(marker(6, [{ to: ADDR(1), minor: 500n, tag: TAG(1) }, { to: ADDR(4), minor: 300n }]), 120);
    expect(beaten([phone, repeats], ID(6))).toBe(true);
    const freshOnly = listed(marker(7, [{ to: ADDR(4), minor: 300n, tag: TAG(7) }]), 120);
    expect(beaten([phone, freshOnly], ID(7))).toBe(false);
  });

  it("can't be said of a marker that isn't listed", () => {
    expect(() => beaten([phone], ID(2))).toThrow(RailError);
  });
});
