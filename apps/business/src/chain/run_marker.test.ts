// Run markers as letters to the business's own account: sent, waited for and read back through a
// pretend Shield on a pretend chain (release_test_helpers.ts), sealed with a real vault key.
import { describe, expect, it } from "vitest";
import { type RunMarker, encodeMarker, newMarkerId } from "@pnw/rail";
import { createVault, sha256Hex } from "@pnw/vault";
import { finderKey, pageLookup } from "./books_backup";
import { LETTER_BYTES, LetterBox, SEND_FUNCTION, SEND_PAGE_FUNCTION } from "./letters";
import { Chain, type Device, type Shield, USERNAME, VirtualTime, account, firstDevice, postedRun } from "./release_test_helpers";
import { MARKER_LETTER_LINES, type MarkerSeal, RunMarkerError, awaitOwnMarker, markerFunction, markerLookup, readMarkers, sealOf, sendMarker } from "./run_marker";

const TAG = (n: number) => n.toString(16).padStart(2, "0").repeat(16);

function marker(lines: number, over: Partial<RunMarker> = {}): RunMarker {
  return {
    v: 1,
    id: newMarkerId(),
    from: "2026-11-07",
    until: "2026-11-13",
    // A chained run: the first line names the record the run starts from, the rest name none.
    lines: Array.from({ length: lines }, (_x, i) => ({ to: account(i + 1), minor: 612_345_600n + BigInt(i) * 17_250_000n, ...(i === 0 ? { tag: TAG(1) } : {}) })),
    ...over,
  };
}

async function world() {
  const vt = new VirtualTime();
  const chain = new Chain(vt, []);
  const phone = await firstDevice(postedRun(1).company);
  const finder = await finderKey(USERNAME, chain.address);
  /** A device's letter box over its own Shield, and what seals its markers. */
  const desk = (device: Device, shield: Shield = chain.shield()) => ({
    shield,
    box: new LetterBox({ wallet: shield, to: chain.address, execute: { sleep: vt.sleep, now: vt.clock.now, pollMs: 2_000 } }),
    seal: sealOf(device.session),
  });
  return { vt, chain, phone, finder, desk };
}

describe("run markers as letters to the account itself", () => {
  it("a marker sent on one device is read on a second restored from the same books", async () => {
    const { vt, chain, phone, finder, desk } = await world();
    const mine = marker(3);
    const a = desk(phone);
    await vt.run(sendMarker(a.box, a.seal, finder, mine));
    // One approval, one letter, to the account itself.
    expect(a.shield.approvals).toBe(1);
    expect(a.shield.calls.map((c) => [c.function, c.inputs[0]])).toEqual([[SEND_FUNCTION, chain.address]]);

    const laptop = await phone.restored();
    const b = desk(laptop);
    await vt.run(vt.sleep(5_000));
    const listed = await readMarkers(b.box, b.seal, finder);
    expect(listed).toHaveLength(1);
    expect(listed[0]!.marker).toEqual(mine);
    // When it was accepted comes from the letter's own record: its block and its transaction.
    expect(listed[0]).toMatchObject({ height: chain.txs[0]!.height, txId: chain.txs[0]!.id });
    expect(b.shield.approvals).toBe(0); // reading asks nothing of the person
  });

  it("nothing of a marker reads in its letter, and its slot comes from the username and the account, apart from the backup's", async () => {
    const { vt, chain, phone, finder, desk } = await world();
    const mine = marker(2);
    const a = desk(phone);
    await vt.run(sendMarker(a.box, a.seal, finder, mine));
    const sent = a.shield.calls[0]!.inputs.join(" ");
    for (const secret of [mine.id, TAG(1), account(1), account(2).slice(5, 25), "612345600"]) expect(sent).not.toContain(secret);
    expect(await markerLookup(finder, 0)).toBe(await sha256Hex(new TextEncoder().encode(`${finder}:pay-marker:0`)));
    expect(await markerLookup(finder, 0)).not.toBe(await markerLookup(finder, 1));
    expect(await markerLookup(finder, 0)).not.toBe(await pageLookup(finder, 0, 0, 0));
    expect(await markerLookup(await finderKey("someone-else", chain.address), 0)).not.toBe(await markerLookup(finder, 0));
  });

  it("each marker takes the first empty slot, and two letters under one slot are both read, in block order", async () => {
    const { vt, chain, phone, finder, desk } = await world();
    const laptop = await phone.restored();
    const [a, b] = [desk(phone), desk(laptop)];
    const [first, second, third] = [marker(1), marker(2), marker(3)];
    // Two devices at once: neither sees the other's letter yet, so both write under slot 0.
    await vt.run(Promise.all([sendMarker(a.box, a.seal, finder, first), vt.sleep(3_000).then(() => sendMarker(b.box, b.seal, finder, second))]));
    await vt.run(vt.sleep(5_000));
    await vt.run(sendMarker(a.box, a.seal, finder, third));
    await vt.run(vt.sleep(5_000));

    const slot = (call: { inputs: string[] }) => call.inputs[1];
    expect(slot(a.shield.calls[0]!)).toBe(slot(b.shield.calls[0]!));
    expect(slot(a.shield.calls[1]!)).not.toBe(slot(a.shield.calls[0]!));
    const listed = await readMarkers(b.box, b.seal, finder);
    expect(listed.map((l) => l.marker.id)).toEqual([first.id, second.id, third.id]);
    expect(listed.map((l) => l.txId)).toEqual(chain.txs.map((t) => t.id));
    expect(listed[0]!.height).toBeLessThanOrEqual(listed[1]!.height);
  });

  it("a letter that doesn't open, or opens to something that isn't a marker, is ignored, and the walk goes on past it", async () => {
    const { vt, phone, finder, desk } = await world();
    const a = desk(phone);
    // Slot 0: sealed under another vault's key. Slot 1: this vault's key, the wrong slot's seal. Slot 2: not a marker.
    const stranger = sealOf(await createVault("hewn:v1\nsomeone\nanother long passphrase", "{}", { id: "acct-other", iterations: 1000 }));
    await vt.run(sendMarker(a.box, stranger, finder, marker(1)));
    await vt.run(vt.sleep(5_000));
    const misplaced: MarkerSeal = { seal: (_id, bytes) => a.seal.seal("pm-7", bytes), open: a.seal.open };
    await vt.run(sendMarker(a.box, misplaced, finder, marker(1)));
    await vt.run(vt.sleep(5_000));
    const junk = await a.seal.seal("pm-2", new TextEncoder().encode('{"v":1,"id":"nope"}'));
    const bytes = Uint8Array.from(atob(junk.data), (c) => c.charCodeAt(0));
    const iv = Uint8Array.from(atob(junk.iv), (c) => c.charCodeAt(0));
    await vt.run(a.box.put(await markerLookup(finder, 2), Uint8Array.of(1, ...iv, bytes.length >> 8, bytes.length & 0xff, ...bytes)));
    await vt.run(vt.sleep(5_000));
    const real = marker(2);
    await vt.run(sendMarker(a.box, a.seal, finder, real));
    await vt.run(vt.sleep(5_000));

    expect(a.shield.calls).toHaveLength(4);
    const listed = await readMarkers(a.box, a.seal, finder);
    expect(listed.map((l) => l.marker.id)).toEqual([real.id]);
  });

  it("the walk stops at the first empty slot", async () => {
    const { vt, phone, finder, desk } = await world();
    const a = desk(phone);
    const [first, second, stray] = [marker(1), marker(1), marker(1)];
    await vt.run(sendMarker(a.box, a.seal, finder, first));
    await vt.run(vt.sleep(5_000));
    await vt.run(sendMarker(a.box, a.seal, finder, second));
    // A well-sealed marker two slots further on, with an empty slot between: never reached.
    const sealed = await a.seal.seal("pm-3", new TextEncoder().encode(encodeMarker(stray)) as Uint8Array<ArrayBuffer>);
    const raw = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
    const data = raw(sealed.data);
    await vt.run(a.box.put(await markerLookup(finder, 3), Uint8Array.of(1, ...raw(sealed.iv), data.length >> 8, data.length & 0xff, ...data)));
    await vt.run(vt.sleep(5_000));
    expect((await readMarkers(a.box, a.seal, finder)).map((l) => l.marker.id)).toEqual([first.id, second.id]);
  });

  it("declined: it throws and nothing is listed", async () => {
    const { vt, phone, finder, desk } = await world();
    const a = desk(phone);
    a.shield.behaviour = () => "declined";
    await expect(vt.run(sendMarker(a.box, a.seal, finder, marker(3)))).rejects.toThrow();
    await vt.run(vt.sleep(60_000));
    expect(await readMarkers(a.box, a.seal, finder)).toEqual([]);
  });

  it("landed, then Shield threw: the marker is found, one marker, and sendMarker returns normally", async () => {
    const { vt, chain, phone, finder, desk } = await world();
    const a = desk(phone);
    a.shield.lagMs = 0;
    a.shield.behaviour = () => "landed, then threw";
    const mine = marker(3);
    await expect(vt.run(sendMarker(a.box, a.seal, finder, mine))).resolves.toBeUndefined();
    expect(chain.txs).toHaveLength(1);
    expect((await readMarkers(a.box, a.seal, finder)).map((l) => l.marker.id)).toEqual([mine.id]);
  });

  it("Shield says it failed and it never landed: it throws", async () => {
    const { vt, phone, finder, desk } = await world();
    const a = desk(phone);
    a.shield.behaviour = () => ({ saysFailed: true, landsAfterMs: 3_600_000 });
    await expect(vt.run(Promise.race([sendMarker(a.box, a.seal, finder, marker(1)), vt.sleep(600_000).then(() => "still waiting")]))).rejects.toThrow();
  });

  it("awaitOwnMarker reads again until its own marker is listed, and gives up after two minutes", async () => {
    const { vt, phone, finder, desk } = await world();
    const a = desk(phone);
    a.shield.lagMs = 30_000; // this device lists a block half a minute late
    const mine = marker(2);
    await vt.run(sendMarker(a.box, a.seal, finder, mine));
    expect(await readMarkers(a.box, a.seal, finder)).toEqual([]);
    const wait = { sleep: vt.sleep, now: vt.clock.now };
    const listed = await vt.run(awaitOwnMarker(a.box, a.seal, finder, mine.id, wait));
    expect(listed.map((l) => l.marker.id)).toEqual([mine.id]);

    const before = vt.now;
    await expect(vt.run(awaitOwnMarker(a.box, a.seal, finder, newMarkerId(), wait))).rejects.toBeInstanceOf(RunMarkerError);
    expect(vt.now - before).toBeGreaterThanOrEqual(120_000);
    expect(vt.now - before).toBeLessThan(140_000);
  });

  it("a marker Shield gives no block or transaction for can't be placed in order: reading refuses, it doesn't guess", async () => {
    const { vt, chain, phone, finder, desk } = await world();
    const a = desk(phone);
    await vt.run(sendMarker(a.box, a.seal, finder, marker(1)));
    await vt.run(vt.sleep(5_000));
    for (const drop of ["blockHeight", "transactionId"] as const) {
      const bare = Object.assign(Object.create(a.shield) as Shield, {
        requestRecords: async (program: string) => (await a.shield.requestRecords(program)).map((r) => ({ ...(r as object), [drop]: undefined })),
      });
      await expect(readMarkers(new LetterBox({ wallet: bare }), a.seal, finder)).rejects.toBeInstanceOf(RunMarkerError);
    }
    expect(chain.txs).toHaveLength(1);
  });

  it("a marker of up to 12 lines is one letter, even when every line names a record; one of 13 or more is one page", async () => {
    const { vt, phone, finder, desk } = await world();
    const a = desk(phone);
    expect(MARKER_LETTER_LINES).toBe(12);
    expect([1, 12, 13, 64].map(markerFunction)).toEqual([SEND_FUNCTION, SEND_FUNCTION, SEND_PAGE_FUNCTION, SEND_PAGE_FUNCTION]);
    // Accounts and tags that don't repeat, as real ones don't: nothing for the packing to gain.
    let seed = 0x2545f491;
    const next = () => (seed = (Math.imul(seed ^ (seed >>> 15), 0x2c1b3c6d) + 0x9e3779b9) | 0) >>> 0;
    const anyAccount = () => `aleo1${Array.from({ length: 58 }, () => "qpzry9x8gf2tvdw0s3jn54khce6mua7l"[next() % 32]).join("")}`;
    const anyTag = () => Array.from({ length: 32 }, () => "0123456789abcdef"[next() % 16]).join("");
    const lines = (n: number, tagged: (i: number) => boolean) => Array.from({ length: n }, (_x, i) => ({ to: anyAccount(), minor: 100_000_000_000n + BigInt(next()) * 200n, ...(tagged(i) ? { tag: anyTag() } : {}) }));
    const sent = [
      // The most a release writes in 12 lines: every line with a record of its own, the first also taking another's place, amounts in the hundreds of thousands of dollars.
      marker(12, { lines: lines(12, () => true).map((l, i) => (i === 0 ? { ...l, replaces: anyTag() } : l)) }),
      // A run as it is marked: the first line names the record the run starts from.
      marker(12, { lines: lines(12, (i) => i === 0) }),
      marker(13, { lines: lines(13, (i) => i === 0) }),
      marker(64, { lines: lines(64, (i) => i === 0) }),
    ];
    for (const m of sent) {
      await vt.run(sendMarker(a.box, a.seal, finder, m));
      await vt.run(vt.sleep(5_000));
    }
    expect(a.shield.calls.map((c) => c.function)).toEqual(sent.map((m) => markerFunction(m.lines.length)));
    expect(a.shield.approvals).toBe(4); // one approval each, either way
    expect((await readMarkers(a.box, a.seal, finder)).map((l) => l.marker)).toEqual(sent);
    expect(LETTER_BYTES).toBe(1052);
  });
});
