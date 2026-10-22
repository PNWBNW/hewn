import { describe, expect, it } from "vitest";
import { businessDirectory, coworkerTag, coworkersFrom, directoryDigest, owedEmptyDirectory, validateCoworkerThread, validateIdentity } from "./directory";
import { type Mailbox, emptyMailbox, updateThread } from "./mailbox";
import type { Rail, RailLink } from "./rail";
import { type ThreadBody, type ThreadItem, addToThread, emptyThread } from "./thread";

const ADDRESS = "aleo1" + "q".repeat(58);
const PK = (c: string) => "04" + c.repeat(128);
const KA = "a1".repeat(32);
const KB = "b2".repeat(32);
const link = (workerId: string, partiesKey: string, status: RailLink["status"] = "linked"): RailLink => ({ workerId, address: ADDRESS, nameHash: "1", agreementId: partiesKey, partiesKey, status });
const rail = (...links: RailLink[]): Rail => ({ version: 1, network: "testnet", address: ADDRESS, linkedAt: "2026-10-01T00:00:00.000Z", links });
let n = 0;
const msg = (from: "business" | "worker", body: ThreadBody, mine: boolean): ThreadItem => ({ version: 1, id: (++n).toString(16).padStart(32, "0"), from, sentAt: `2026-10-16T10:00:${String(n).padStart(2, "0")}.000Z`, body, mine, seq: n });
const say = (m: Mailbox, key: string, workerId: string, item: ThreadItem) => updateThread(m, key, workerId, (t) => addToThread(t, item));

describe("the business's directory", () => {
  it("lists linked people whose latest word was to join, one entry per key", () => {
    let m = emptyMailbox();
    m = say(m, KA, "ana", msg("worker", { type: "directory_join", name: "Ana", publicKey: PK("a") }, false));
    m = say(m, KB, "bo", msg("worker", { type: "directory_join", name: "Bo", publicKey: PK("b") }, false));
    m = say(m, KB, "bo", msg("worker", { type: "directory_leave" }, false));
    const r = rail(link("ana", KA), link("bo", KB));
    // Their account comes from the business's own link to them, never from what they sent.
    expect(businessDirectory(r, m)).toEqual([{ name: "Ana", publicKey: PK("a"), address: ADDRESS, workerId: "ana", partiesKey: KA }]);
    // An offer that hasn't been accepted isn't a coworker yet.
    expect(businessDirectory(rail(link("ana", KA, "offered")), m)).toEqual([]);
    // Two people sending the same key: only the first is listed.
    const dup = say(m, KB, "bo", msg("worker", { type: "directory_join", name: "Not Ana", publicKey: PK("a") }, false));
    expect(businessDirectory(r, dup).map((e) => e.name)).toEqual(["Ana"]);
  });

  it("owes an empty list to someone who left after being sent a full one, and knows when it changed", () => {
    let m = emptyMailbox();
    m = say(m, KB, "bo", msg("worker", { type: "directory_join", name: "Bo", publicKey: PK("b") }, false));
    m = say(m, KB, "bo", msg("business", { type: "directory", entries: [{ name: "Ana", publicKey: PK("a") }] }, true));
    m = say(m, KB, "bo", msg("worker", { type: "directory_leave" }, false));
    const r = rail(link("bo", KB));
    expect(owedEmptyDirectory(r, m)).toEqual([{ workerId: "bo", partiesKey: KB, address: ADDRESS }]);
    const after = say(m, KB, "bo", msg("business", { type: "directory", entries: [] }, true));
    expect(owedEmptyDirectory(r, after)).toEqual([]);
    expect(directoryDigest([{ name: "A", publicKey: PK("a") }, { name: "B", publicKey: PK("b") }])).toBe(directoryDigest([{ name: "B", publicKey: PK("b") }, { name: "A", publicKey: PK("a") }]));
    expect(directoryDigest([{ name: "A", publicKey: PK("a") }])).not.toBe(directoryDigest([{ name: "A2", publicKey: PK("a") }]));
    // A list sent before accounts were in it counts as changed, so everyone gets accounts.
    expect(directoryDigest([{ name: "A", publicKey: PK("a") }])).not.toBe(directoryDigest([{ name: "A", publicKey: PK("a"), address: ADDRESS }]));
  });

  it("knows what it owes: the new list to everyone in it, an empty one to anyone who left, nothing once sent", async () => {
    const { directoryOutbox } = await import("./directory");
    let m = emptyMailbox();
    m = say(m, KA, "ana", msg("worker", { type: "directory_join", name: "Ana", publicKey: PK("a") }, false));
    m = say(m, KB, "bo", msg("worker", { type: "directory_join", name: "Bo", publicKey: PK("b") }, false));
    const r = rail(link("ana", KA), link("bo", KB));
    const owed = directoryOutbox(r, m);
    expect(owed.copies.map((c) => [c.workerId, c.address, c.entries.map((e) => [e.name, e.address])])).toEqual([
      ["ana", ADDRESS, [["Ana", ADDRESS], ["Bo", ADDRESS]]],
      ["bo", ADDRESS, [["Ana", ADDRESS], ["Bo", ADDRESS]]],
    ]);
    expect(directoryOutbox(r, { ...m, directorySent: owed.digest }).copies).toEqual([]);
    // Bo leaves after getting the list: Ana gets the shorter list, Bo an empty one.
    let left = say({ ...m, directorySent: owed.digest }, KB, "bo", msg("business", { type: "directory", entries: owed.copies[1]!.entries }, true));
    left = say(left, KB, "bo", msg("worker", { type: "directory_leave" }, false));
    expect(directoryOutbox(r, left).copies.map((c) => [c.workerId, c.entries.length])).toEqual([
      ["ana", 1],
      ["bo", 0],
    ]);
  });
});

describe("the person's side", () => {
  it("takes the latest list the business sent", () => {
    let t = emptyThread();
    t = addToThread(t, msg("business", { type: "directory", entries: [{ name: "Ana", publicKey: PK("a") }] }, false));
    t = addToThread(t, msg("business", { type: "directory", entries: [{ name: "Ana", publicKey: PK("a") }, { name: "Cy", publicKey: PK("c") }] }, false));
    expect(coworkersFrom(t).map((c) => c.name)).toEqual(["Ana", "Cy"]);
    expect(coworkersFrom(undefined)).toEqual([]);
    expect(coworkerTag(PK("a"))).toBe("a".repeat(16));
  });

  it("keeps an identity's private key and a coworker thread of what coworkers send only", () => {
    const id = { publicKey: PK("a"), privateKey: { kty: "EC", crv: "P-256", x: "x", y: "y", d: "d" }, createdAt: "2026-10-16T10:00:00.000Z", listed: true, name: "Ana" };
    expect(validateIdentity(id)).toEqual(id);
    expect(() => validateIdentity({ ...id, privateKey: { kty: "EC", crv: "P-256", x: "x", y: "y" } })).toThrow(/private key/);
    const thread = { ...addToThread(emptyThread(), msg("worker", { type: "text", text: "Hi" }, true)), businessKey: KA, name: "Bo" };
    expect(validateCoworkerThread(JSON.parse(JSON.stringify(thread)))).toEqual(thread);
    const sneaky = { ...addToThread(emptyThread(), msg("business", { type: "channel_left", channelId: "c".repeat(16), name: "x" }, false)), businessKey: KA, name: "Bo" };
    expect(() => validateCoworkerThread(sneaky)).toThrow(/doesn't travel between coworkers/);
  });

  it("reads an account on a list entry, and refuses one that isn't an account", async () => {
    const { validateMessage, newMessageId } = await import("./thread");
    const list = (entries: unknown[]) => ({ version: 1, id: newMessageId(), from: "business", sentAt: "2026-10-16T00:00:00.000Z", body: { type: "directory", entries } });
    const ok = validateMessage(list([{ name: "Ana", publicKey: PK("a"), address: ADDRESS }, { name: "Bo", publicKey: PK("b") }]), "business");
    expect(ok.body).toEqual({ type: "directory", entries: [{ name: "Ana", publicKey: PK("a"), address: ADDRESS }, { name: "Bo", publicKey: PK("b") }] });
    expect(() => validateMessage(list([{ name: "Ana", publicKey: PK("a"), address: "aleo1nope" }]), "business")).toThrow(/account/);
    expect(() => validateMessage(list([{ name: "Ana", publicKey: PK("a"), address: 7 }]), "business")).toThrow(/account/);
  });
});
