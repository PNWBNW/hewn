// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { fakeStore } from "./testing";
import { sweepHandler } from "./sweep";
import { GET } from "./sweep/route.server";

const A = "a".repeat(64);
const B = "b".repeat(64);
const C = "c".repeat(64);
const NOW = () => new Date("2026-10-16T04:17:00.000Z");
const call = (auth?: string) => new Request("http://books.local/api/mailbox/sweep", auth ? { headers: { Authorization: auth } } : {});

function seeded() {
  const s = fakeStore({ [A]: new Uint8Array(40), [B]: new Uint8Array(40), [C]: new Uint8Array(40) });
  s.keep.set(A, "2026-10-15"); // past
  s.keep.set(B, "2026-10-16"); // today: still kept
  // C has no day: kept until collected
  return s;
}

describe("the daily sweep", () => {
  it("unpins only pins whose keep-until day has passed, and reports a count", async () => {
    const { store, pins, calls } = seeded();
    const res = await sweepHandler(store, "s3cret", { now: NOW })(call("Bearer s3cret"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ swept: 1 });
    expect([...pins.keys()].sort()).toEqual([B, C]);
    expect(calls).toEqual(["expired 2026-10-16 500", `unpin cid-${A.slice(0, 8)}`]);
  });

  it("does nothing without the scheduler's secret, or without one set", async () => {
    for (const auth of [undefined, "Bearer wrong", "s3cret"]) {
      const { store, calls } = seeded();
      const res = await sweepHandler(store, "s3cret", { now: NOW })(call(auth));
      expect(res.status, String(auth)).toBe(401);
      expect(calls).toEqual([]);
    }
    const { store, calls } = seeded();
    expect((await sweepHandler(store, null)(call("Bearer "))).status).toBe(503);
    expect((await sweepHandler(null, "s3cret")(call("Bearer s3cret"))).status).toBe(503);
    expect(calls).toEqual([]);
  });

  it("answers 502 without details when the pinning service fails", async () => {
    const { store } = seeded();
    const res = await sweepHandler({ ...store, expired: async () => { throw new Error("pinata says no: jwt=abc"); } }, "s3cret")(call("Bearer s3cret"));
    expect(res.status).toBe(502);
    expect(await res.text()).not.toContain("jwt");
  });
});

describe("the sweep route", () => {
  const saved = { jwt: process.env.PINATA_JWT, secret: process.env.CRON_SECRET };
  afterEach(() => {
    for (const [k, v] of [["PINATA_JWT", saved.jwt], ["CRON_SECRET", saved.secret]] as const) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it("answers 503 when the pinning key or the scheduler's secret is unset", async () => {
    delete process.env.PINATA_JWT;
    process.env.CRON_SECRET = "s3cret";
    expect((await GET(call("Bearer s3cret"))).status).toBe(503);
    process.env.PINATA_JWT = "set-but-never-used";
    delete process.env.CRON_SECRET;
    expect((await GET(call("Bearer undefined"))).status).toBe(503);
  });

  it("answers 401 to a wrong secret before touching the pinning service", async () => {
    process.env.PINATA_JWT = "set-but-never-used";
    process.env.CRON_SECRET = "s3cret";
    expect((await GET(call("Bearer nope"))).status).toBe(401);
  });
});
