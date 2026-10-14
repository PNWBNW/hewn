import { describe, expect, it } from "vitest";
import {
  type Rail,
  type RailLink,
  addLink,
  bumpSeq,
  isRailAddress,
  linkFor,
  nextSeq,
  railFromJson,
  railToJson,
  shortAddress,
  validateLink,
  validateRail,
} from "./rail";

const ADDR = "aleo1" + "q".repeat(58);
const ADDR_B = "aleo1" + "z".repeat(58);
const KEY = "ab".repeat(32);
const KEY_B = "cd".repeat(32);

const link: RailLink = { workerId: "wkr-1", address: ADDR_B, nameHash: "456", agreementId: "01".repeat(32), partiesKey: KEY };

const rail: Rail = {
  version: 1,
  network: "testnet",
  address: ADDR,
  linkedAt: "2026-10-14T18:00:00.000Z",
  businessNameHash: "123",
  businessName: "brothers",
  linkProof: { message: "hewn:link:v1\ndefault\n" + ADDR + "\n2026-10-14T18:00:00.000Z", signature: "ab".repeat(32) },
  links: [link],
};

describe("rail", () => {
  it("round-trips through JSON", () => {
    expect(railFromJson(railToJson(rail))).toEqual(rail);
  });

  it("round-trips without the optional parts", () => {
    const bare: Rail = { version: 1, network: "testnet", address: ADDR, linkedAt: rail.linkedAt, links: [] };
    expect(railFromJson(railToJson(bare))).toEqual(bare);
    expect(railToJson(bare)).not.toContain("businessName");
  });

  it("rejects a bad account, version, date or link", () => {
    expect(() => validateRail({ ...rail, address: "aleo1short" })).toThrow(/valid account/);
    expect(() => validateRail({ ...rail, address: ADDR.toUpperCase() })).toThrow(/valid account/);
    expect(() => validateRail({ ...rail, version: 2 })).toThrow(/version/);
    expect(() => validateRail({ ...rail, linkedAt: "yesterday" })).toThrow(/date/);
    expect(() => validateRail({ ...rail, links: [{ ...link, address: "nope" }] })).toThrow(/valid account/);
    expect(() => validateRail({ ...rail, links: [{ ...link, workerId: "" }] })).toThrow(/team member/);
    expect(() => validateRail({ ...rail, linkProof: { message: "m" } })).toThrow(/signature/);
    expect(() => railFromJson("null")).toThrow(/object/);
  });

  it("keeps one link per team member, the later one winning", () => {
    const older = { ...link, nameHash: "1", agreementId: "aa" };
    const newer = { ...link, nameHash: "2", agreementId: "bb" };
    expect(validateRail({ ...rail, links: [older, newer] }).links).toEqual([newer]);
    expect(addLink({ ...rail, links: [older] }, newer).links).toEqual([newer]);
    expect(addLink(rail, { ...newer, workerId: "wkr-2" }).links).toHaveLength(2);
  });

  it("recognises and shortens accounts", () => {
    expect(isRailAddress(ADDR)).toBe(true);
    expect(isRailAddress(ADDR + "q")).toBe(false);
    expect(isRailAddress(42)).toBe(false);
    expect(shortAddress(ADDR)).toBe("aleo1qqqq…qqqq");
  });
});

describe("the parties key on a link", () => {
  const { partiesKey: _dropped, ...legacy } = link;

  it("is required on a new link and checked as 64 hex characters, no 0x", () => {
    expect(() => validateLink(legacy)).toThrow(/parties key/);
    expect(() => validateRail({ ...rail, links: [legacy] })).toThrow(/parties key/);
    expect(() => addLink(rail, { ...legacy, workerId: "wkr-2" })).toThrow(/parties key/);
    expect(() => validateLink({ ...link, partiesKey: "0x" + KEY })).toThrow(/64 hex/);
    expect(() => validateLink({ ...link, partiesKey: KEY.toUpperCase() })).toThrow(/64 hex/);
    expect(() => validateLink({ ...link, partiesKey: KEY.slice(2) })).toThrow(/64 hex/);
    expect(() => validateLink({ ...link, partiesKey: 7 })).toThrow(/64 hex/);
    expect(validateLink(link)).toEqual(link);
  });

  it("is allowed to be missing on a link loaded from an older file, which saves again as it was", () => {
    const text = JSON.stringify({ ...rail, links: [legacy] });
    const loaded = railFromJson(text);
    expect(loaded.links).toEqual([legacy]);
    expect(loaded.links[0]).not.toHaveProperty("partiesKey");
    expect(railFromJson(railToJson(loaded))).toEqual(loaded);
  });

  it("is filled in by importing the same team member again, in place", () => {
    const loaded = railFromJson(JSON.stringify({ ...rail, links: [legacy, { ...legacy, workerId: "wkr-2", address: ADDR }] }));
    const relinked = addLink(loaded, link);
    expect(relinked.links.map((l) => l.workerId)).toEqual(["wkr-2", "wkr-1"]);
    expect(linkFor(relinked, "wkr-1")).toEqual(link);
    expect(linkFor(relinked, "wkr-2")).not.toHaveProperty("partiesKey");
    expect(linkFor(relinked, "wkr-3")).toBeUndefined();
  });
});

describe("mailbox sequence numbers", () => {
  it("start at 0 and advance one slot at a time", () => {
    expect(nextSeq(link, "paystub")).toBe(0);
    const once = bumpSeq(rail, "wkr-1", "paystub");
    expect(nextSeq(linkFor(once, "wkr-1")!, "paystub")).toBe(1);
    expect(linkFor(once, "wkr-1")!.mailboxSeq).toEqual({ paystub: 1 });
    const twice = bumpSeq(once, "wkr-1", "paystub");
    expect(nextSeq(linkFor(twice, "wkr-1")!, "paystub")).toBe(2);
    expect(rail.links[0]!.mailboxSeq).toBeUndefined(); // pure
    expect(railFromJson(railToJson(twice))).toEqual(twice);
  });

  it("can note a specific slot as used and never move backwards", () => {
    const at5 = bumpSeq(rail, "wkr-1", "paystub", 5);
    expect(nextSeq(linkFor(at5, "wkr-1")!, "paystub")).toBe(6);
    const stale = bumpSeq(at5, "wkr-1", "paystub", 2);
    expect(nextSeq(linkFor(stale, "wkr-1")!, "paystub")).toBe(6);
    expect(() => bumpSeq(rail, "wkr-9", "paystub")).toThrow(/no account/);
    expect(() => bumpSeq(rail, "wkr-1", "paystub", -1)).toThrow(/whole number/);
    expect(() => bumpSeq(rail, "wkr-1", "paystub", 1.5)).toThrow(/whole number/);
  });

  it("are checked on load", () => {
    expect(validateLink({ ...link, mailboxSeq: { paystub: 3 } }).mailboxSeq).toEqual({ paystub: 3 });
    expect(validateLink({ ...link, mailboxSeq: {} })).not.toHaveProperty("mailboxSeq");
    expect(() => validateLink({ ...link, mailboxSeq: { paystub: -1 } })).toThrow(/whole number/);
    expect(() => validateLink({ ...link, mailboxSeq: { paystub: "3" } })).toThrow(/whole number/);
    expect(() => validateLink({ ...link, mailboxSeq: { paystub: 2 ** 32 } })).toThrow(/whole number/);
    expect(() => validateLink({ ...link, mailboxSeq: { letters: 1 } })).toThrow(/Unknown mailbox document kind/);
    expect(() => validateLink({ ...link, mailboxSeq: [1] })).toThrow(/object/);
    expect(() => validateLink({ ...link, mailboxSeq: "paystub" })).toThrow(/object/);
  });

  it("carry over when the same agreement is imported again, and start over for a new one", () => {
    const sent = bumpSeq(rail, "wkr-1", "paystub", 1);
    const same = addLink(sent, link);
    expect(linkFor(same, "wkr-1")!.mailboxSeq).toEqual({ paystub: 2 });
    const relinked = addLink(sent, { ...link, partiesKey: KEY_B });
    expect(linkFor(relinked, "wkr-1")!.partiesKey).toBe(KEY_B);
    expect(linkFor(relinked, "wkr-1")!.mailboxSeq).toBeUndefined();
  });
});
