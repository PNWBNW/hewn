import { describe, expect, it } from "vitest";
import type { Hello } from "../books/connections";
import { MAX_HELLOS, checkHello, connectionKey, helloLookup, nextHelloPlace, packHello, readHellos, unpackHello } from "./clients";
import { pairKey } from "./coworkers";
import type { DirectoryEntry } from "./directory";
import { newHalf } from "./key_ring";
import type { LetterRecord } from "./letters";

const BIZ = "aleo1" + "b".repeat(58);
const CUST = "aleo1" + "c".repeat(58);
const OTHER = "aleo1" + "d".repeat(58);
const hello = (publicKey: string, side: Hello["side"] = "customer"): Hello => ({ v: 1, type: "hello", side, name: "rowan", nameHash: "42", publicKey });

describe("hellos as letters", () => {
  it("go to a place per recipient and per try", async () => {
    expect(await helloLookup(BIZ, 0)).not.toBe(await helloLookup(BIZ, 1));
    expect(await helloLookup(BIZ, 0)).not.toBe(await helloLookup(CUST, 0));
    expect(await helloLookup(BIZ, 0)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("round-trip, and anything else reads as nothing", async () => {
    const h = hello((await newHalf()).publicKey);
    expect(unpackHello(packHello(h))).toEqual(h);
    expect(unpackHello(new TextEncoder().encode("{}"))).toBeNull();
    expect(unpackHello(Uint8Array.of(1, 2, 3))).toBeNull();
  });

  it("are read place by place: the newest from each sender, none without a sender, none from myself", async () => {
    const k1 = (await newHalf()).publicKey;
    const k2 = (await newHalf()).publicKey;
    const k3 = (await newHalf()).publicKey;
    const at = new Map<string, LetterRecord[]>();
    const letter = (sender: string | undefined, h: Hello): LetterRecord => ({ kind: "letter", lookup: "", envelope: packHello(h), ...(sender ? { sender } : {}) });
    at.set(await helloLookup(BIZ, 0), [letter(CUST, hello(k1)), letter(undefined, hello(k3)), letter(BIZ, hello(k3))]);
    at.set(await helloLookup(BIZ, 1), [letter(CUST, hello(k2))]);
    at.set(await helloLookup(BIZ, 3), [letter(OTHER, hello(k3))]); // after a gap: not read
    const found = await readHellos(async (l) => at.get(l) ?? [], BIZ);
    expect(found).toEqual([{ sender: CUST, hello: hello(k2) }]);
  });

  it("finds the first place this account hasn't used", async () => {
    const used = new Set([await helloLookup(CUST, 0), await helloLookup(CUST, 1)]);
    expect(await nextHelloPlace(async (l) => used.has(l), CUST)).toBe(await helloLookup(CUST, 2));
    expect(await nextHelloPlace(async () => true, CUST)).toBeNull();
    expect(MAX_HELLOS).toBeGreaterThan(2);
  });
});

describe("whom a hello is from", () => {
  const entry = (over: Partial<DirectoryEntry>): DirectoryEntry => ({ name: "rowan", nameHash: "42", address: CUST, kind: "worker", ...over });

  it("takes the registry's name for the sender, never the one the hello claims", async () => {
    const h = { sender: CUST, hello: { ...hello("04" + "1".repeat(128)), name: "someone_else", nameHash: "7" } };
    expect(await checkHello(h, async () => entry({}))).toEqual({ name: "rowan", nameHash: "42" });
  });

  it("refuses a sender with the wrong kind of name, another account's entry, or none", async () => {
    const h = { sender: CUST, hello: hello("04" + "1".repeat(128)) };
    expect(await checkHello(h, async () => entry({ kind: "business" }))).toBeNull(); // a business can't say hello as a customer
    expect(await checkHello({ sender: BIZ, hello: hello("04" + "1".repeat(128), "business") }, async () => entry({ address: BIZ, kind: "worker" }))).toBeNull();
    expect(await checkHello(h, async () => entry({ address: OTHER }))).toBeNull();
    expect(await checkHello(h, async () => entry({ name: "" }))).toBeNull();
    expect(await checkHello(h, async () => { throw new Error("no name"); })).toBeNull();
  });
});

describe("the key a business and a customer share", () => {
  it("is the same on both sides, and nobody else's", async () => {
    const biz = await newHalf();
    const cust = await newHalf();
    const stranger = await newHalf();
    const onBusiness = await connectionKey({ mine: biz, theirs: cust.publicKey });
    expect(await connectionKey({ mine: cust, theirs: biz.publicKey })).toBe(onBusiness);
    expect(await connectionKey({ mine: stranger, theirs: biz.publicKey })).not.toBe(onBusiness);
    // Kept apart from a coworker key made from the same two halves.
    expect(await pairKey(biz, cust.publicKey)).not.toBe(onBusiness);
    await expect(connectionKey({ mine: biz })).rejects.toThrow(/Not connected/);
  });
});
