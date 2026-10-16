import { describe, expect, it } from "vitest";
import { MailboxError, lookupId, openReceipt, partiesKeyFromHex, receiptLookup, seal } from "@pnw/mailbox";
import { addHours, emptyMailbox } from "../books/mailbox";
import type { Rail, RailLink } from "../books/rail";
import { scanHours } from "./mailbox_scan";
import { TIMESHEET_KIND } from "./work/timesheet";

const ADDRESS = "aleo1kypwp5m7qtk9mwazgcpg0tq8aal23mnrvwfvug65qgcg9xvsrqgspyjm6n";
const KEY_HEX = "11".repeat(32);
const AGREEMENT = "ab".repeat(32);
const ENTRY = { date: "2026-10-05", in: "2026-10-05T15:00:00.000Z", out: "2026-10-05T23:30:00.000Z", minutes: 510 };
const PAYLOAD = { version: 1, kind: "timesheet", agreementId: AGREEMENT, weekStart: "2026-10-05", entries: [ENTRY], totalMinutes: 510, sentAt: "2026-10-11T18:00:00.000Z" };

const link = (over: Partial<RailLink> = {}): RailLink => ({ workerId: "wkr-1", address: ADDRESS, nameHash: "7", agreementId: AGREEMENT, partiesKey: KEY_HEX, status: "linked", ...over });
const rail = (...links: RailLink[]): Rail => ({ version: 1, network: "testnet", address: ADDRESS, linkedAt: "2026-10-01T00:00:00.000Z", links });

/** A fake mailbox: lookup → envelope. */
function fakeClient(store: Map<string, Uint8Array<ArrayBuffer>>) {
  const dropped: string[] = [];
  return {
    dropped,
    get: async (lookup: string) => store.get(lookup) ?? null,
    drop: async (lookup: string) => {
      dropped.push(lookup);
      store.delete(lookup);
    },
  };
}

async function put(store: Map<string, Uint8Array<ArrayBuffer>>, seq: number, payload: unknown, kind: string = TIMESHEET_KIND) {
  const key = partiesKeyFromHex(KEY_HEX);
  const sealed = await seal(key, kind, seq, new TextEncoder().encode(JSON.stringify(payload)));
  store.set(sealed.lookup, sealed.envelope);
  return sealed.lookup;
}

function harness(r: Rail, client: ReturnType<typeof fakeClient>, mailbox = emptyMailbox()) {
  const kept: unknown[] = [];
  const skipped: [string, number][] = [];
  const run = () =>
    scanHours({
      rail: r,
      mailbox,
      client,
      store: async (h) => void kept.push(h),
      skip: async (id, seq) => void skipped.push([id, seq]),
      now: () => "2026-10-12T09:00:00.000Z",
    });
  return { kept, skipped, run };
}

describe("scanHours", () => {
  it("keeps each week in the vault before dropping its pin, stopping at the first empty slot", async () => {
    const store = new Map<string, Uint8Array<ArrayBuffer>>();
    const l0 = await put(store, 0, PAYLOAD);
    const l1 = await put(store, 1, { ...PAYLOAD, weekStart: "2026-10-12" });
    const client = fakeClient(store);
    const order: string[] = [];
    const r = await scanHours({
      rail: rail(link()),
      mailbox: emptyMailbox(),
      client: { get: client.get, drop: async (l) => void (order.push(`drop:${l}`), await client.drop(l)) },
      store: async (x) => void order.push(`store:${x.seq}`),
      skip: async () => {},
    });
    expect(r.checked).toBe(1);
    expect(r.received.map((x) => x.seq)).toEqual([0, 1]);
    expect(order).toEqual(["store:0", `drop:${l0}`, "store:1", `drop:${l1}`]);
    expect(r.received[0]).toMatchObject({ workerId: "wkr-1", agreementId: AGREEMENT, totalMinutes: 510, weekStart: "2026-10-05" });
  });

  it("sends the person a receipt for each week it keeps", async () => {
    const store = new Map<string, Uint8Array<ArrayBuffer>>();
    await put(store, 0, PAYLOAD);
    const client = fakeClient(store);
    const puts: { lookup: string; envelope: Uint8Array }[] = [];
    await scanHours({ rail: rail(link()), mailbox: emptyMailbox(), client: { ...client, put: async (lookup, envelope) => void puts.push({ lookup, envelope }) }, store: async () => {}, skip: async () => {} });
    const key = partiesKeyFromHex(KEY_HEX);
    expect(puts.map((p) => p.lookup)).toEqual([receiptLookup(key, TIMESHEET_KIND, 0)]);
    expect((await openReceipt(key, TIMESHEET_KIND, 0, puts[0]!.envelope)).version).toBe(1);
  });

  it("starts at the slot after the ones it already has", async () => {
    const store = new Map<string, Uint8Array<ArrayBuffer>>();
    await put(store, 0, PAYLOAD);
    await put(store, 1, { ...PAYLOAD, weekStart: "2026-10-12" });
    const known = addHours(emptyMailbox(), { agreementId: AGREEMENT, seq: 0, lookup: lookupId(partiesKeyFromHex(KEY_HEX), TIMESHEET_KIND, 0), receivedAt: "2026-10-11T00:00:00.000Z", workerId: "wkr-1", weekStart: "2026-10-05", entries: [ENTRY], totalMinutes: 510, sentAt: PAYLOAD.sentAt });
    const h = harness(rail(link()), fakeClient(store), known);
    const r = await h.run();
    expect(r.received.map((x) => x.seq)).toEqual([1]);
  });

  it("skips an envelope that won't check and goes on to the next, leaving its pin", async () => {
    const store = new Map<string, Uint8Array<ArrayBuffer>>();
    const bad = await put(store, 0, { ...PAYLOAD, totalMinutes: 9999 }); // inflated total
    await put(store, 1, PAYLOAD);
    const client = fakeClient(store);
    const h = harness(rail(link()), client);
    const r = await h.run();
    expect(r.skipped).toEqual([{ agreementId: AGREEMENT, seq: 0, message: "The hours don't add up" }]);
    expect(h.skipped).toEqual([[AGREEMENT, 0]]);
    expect(r.received.map((x) => x.seq)).toEqual([1]);
    expect(client.dropped).not.toContain(bad);
  });

  it("skips hours sealed under another kind, and hours that name another agreement", async () => {
    const store = new Map<string, Uint8Array<ArrayBuffer>>();
    // Sealed as a paystub but placed in the timesheet slot: the kind is bound into the key, so it won't open.
    const key = partiesKeyFromHex(KEY_HEX);
    const wrong = await seal(key, "paystub", 0, new TextEncoder().encode(JSON.stringify(PAYLOAD)));
    store.set(lookupId(partiesKeyFromHex(KEY_HEX), TIMESHEET_KIND, 0), wrong.envelope);
    await put(store, 1, { ...PAYLOAD, agreementId: "ff".repeat(32) });
    const h = harness(rail(link()), fakeClient(store));
    const r = await h.run();
    expect(r.received).toEqual([]);
    expect(r.skipped.map((s) => s.seq)).toEqual([0, 1]);
    expect(r.skipped[1]?.message).toMatch(/different agreement/);
  });

  it("reads only linked agreements that have a key", async () => {
    const store = new Map<string, Uint8Array<ArrayBuffer>>();
    await put(store, 0, PAYLOAD);
    const offered = link({ workerId: "wkr-2", agreementId: "cd".repeat(32), status: "offered" });
    const legacy = link({ workerId: "wkr-3", agreementId: "ee".repeat(32), partiesKey: undefined });
    const r = await harness(rail(offered, legacy), fakeClient(store)).run();
    expect(r.checked).toBe(0);
    expect(r.received).toEqual([]);
  });

  it("says when the server has no mailbox, and stops on any other read failure", async () => {
    const off = await scanHours({
      rail: rail(link()),
      mailbox: null,
      client: { get: async () => Promise.reject(new MailboxError("NOT_CONFIGURED", "off")), drop: async () => {} },
      store: async () => {},
      skip: async () => {},
    });
    expect(off.off).toBe(true);
    const broken = await scanHours({
      rail: rail(link()),
      mailbox: null,
      client: { get: async () => Promise.reject(new Error("network down")), drop: async () => {} },
      store: async () => {},
      skip: async () => {},
    });
    expect(broken).toMatchObject({ off: false, failed: "network down", received: [] });
  });

  it("keeps a week even when its pin can't be dropped", async () => {
    const store = new Map<string, Uint8Array<ArrayBuffer>>();
    await put(store, 0, PAYLOAD);
    const r = await scanHours({
      rail: rail(link()),
      mailbox: null,
      client: { get: async (l) => store.get(l) ?? null, drop: async () => Promise.reject(new Error("nope")) },
      store: async () => {},
      skip: async () => {},
    });
    expect(r.received).toHaveLength(1);
  });
});
