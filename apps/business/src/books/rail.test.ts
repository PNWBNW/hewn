import { describe, expect, it } from "vitest";
import { type Rail, addLink, isRailAddress, railFromJson, railToJson, shortAddress, validateRail } from "./rail";

const ADDR = "aleo1" + "q".repeat(58);
const ADDR_B = "aleo1" + "z".repeat(58);

const rail: Rail = {
  version: 1,
  network: "testnet",
  address: ADDR,
  linkedAt: "2026-10-14T18:00:00.000Z",
  businessNameHash: "123",
  businessName: "brothers",
  linkProof: { message: "hewn:link:v1\ndefault\n" + ADDR + "\n2026-10-14T18:00:00.000Z", signature: "ab".repeat(32) },
  links: [{ workerId: "wkr-1", address: ADDR_B, nameHash: "456", agreementId: "01".repeat(32) }],
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
    expect(() => validateRail({ ...rail, links: [{ ...rail.links[0], address: "nope" }] })).toThrow(/valid account/);
    expect(() => validateRail({ ...rail, links: [{ ...rail.links[0], workerId: "" }] })).toThrow(/team member/);
    expect(() => validateRail({ ...rail, linkProof: { message: "m" } })).toThrow(/signature/);
    expect(() => railFromJson("null")).toThrow(/object/);
  });

  it("keeps one link per team member, the later one winning", () => {
    const older = { workerId: "wkr-1", address: ADDR_B, nameHash: "1", agreementId: "aa" };
    const newer = { workerId: "wkr-1", address: ADDR_B, nameHash: "2", agreementId: "bb" };
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
