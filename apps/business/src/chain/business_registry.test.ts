import { describe, expect, it } from "vitest";
import { PROGRAMS } from "@pnw/config/programs";
import { computeNameHash } from "@pnw/records/registry/name_registry";
import { isRailAddress } from "../books/rail";
import {
  APPROVAL_COMMITMENT,
  APPROVE_BUSINESS,
  REGISTER_BUSINESS,
  REGISTRY_AUTHORITY,
  type RegistryReads,
  accountStatus,
  approveInputs,
  checkName,
  isRegistryAuthority,
  registerBusinessInputs,
} from "./business_registry";

const ME = "aleo1kypwp5m7qtk9mwazgcpg0tq8aal23mnrvwfvug65qgcg9xvsrqgspyjm6n";
const OTHER = "aleo1rhgdu77hgyqd3xjj8ucu3jj9r2krwz6mnzyd80gncr5fxcwlh5rsvzp9px";

const reads = (over: Partial<RegistryReads> = {}): RegistryReads => ({
  nameOwner: async () => null,
  workerName: async () => null,
  employerName: async () => null,
  verified: async () => true,
  ...over,
});

describe("register_employer_name inputs", () => {
  it("are the name hash, the name as a big-endian u128 and the industry, in that order", () => {
    const { nameHash, inputs } = registerBusinessInputs("dayco", 9);
    expect(nameHash).toBe(computeNameHash("dayco"));
    // "dayco" = 0x6461 7963 6f
    expect(inputs).toEqual([`${nameHash}field`, `${BigInt("0x6461796" + "36f")}u128`, "9u8"]);
  });

  it("go to the registrar v5 program and the v5 signature (three inputs, no count, no fee)", () => {
    expect(REGISTER_BUSINESS).toEqual({ program: PROGRAMS.layer1.pnw_name_registrar, function: "register_employer_name" });
    expect(REGISTER_BUSINESS.program).toBe("pnw_name_registrar_v5.aleo");
    expect(registerBusinessInputs("dayco", 1).inputs).toHaveLength(3);
  });

  it("refuse names the registry would reject, and industries outside 1 to 40", () => {
    for (const bad of ["ab", "UPPER", "has space", "a".repeat(17), "dash-ed", ""]) {
      expect(() => registerBusinessInputs(bad, 1)).toThrow(/A name is/);
    }
    for (const code of [0, 41, -1, 1.5, Number.NaN]) expect(() => registerBusinessInputs("dayco", code)).toThrow(/industry/);
    expect(() => registerBusinessInputs("abc", 40)).not.toThrow();
    expect(() => registerBusinessInputs("a_1", 1)).not.toThrow();
  });
});

describe("set_verified inputs", () => {
  it("are the account, a fixed placeholder commitment and the flag", () => {
    expect(APPROVE_BUSINESS).toEqual({ program: PROGRAMS.layer1.employer_license_registry, function: "set_verified" });
    expect(approveInputs(ME, true)).toEqual([ME, APPROVAL_COMMITMENT, "true"]);
    expect(approveInputs(ME, false)[2]).toBe("false");
    expect(APPROVAL_COMMITMENT).toBe("1field");
  });

  it("refuse an incomplete account", () => {
    expect(() => approveInputs("aleo1short", true)).toThrow(/63 characters/);
    expect(() => approveInputs("", true)).toThrow(/63 characters/);
  });
});

describe("the registry authority", () => {
  it("is the account the immutable license registry names, and nobody else", () => {
    expect(isRailAddress(REGISTRY_AUTHORITY)).toBe(true);
    expect(isRegistryAuthority(REGISTRY_AUTHORITY)).toBe(true);
    expect(isRegistryAuthority(ME)).toBe(false);
    expect(isRegistryAuthority(null)).toBe(false);
    expect(isRegistryAuthority(undefined)).toBe(false);
  });
});

describe("accountStatus", () => {
  it("keeps a business name the account already holds, even with the field suffix", async () => {
    expect(await accountStatus(ME, reads({ employerName: async () => "123field" }))).toEqual({ kind: "has-name", nameHash: "123" });
  });

  it("says a worker's account can't take a business name", async () => {
    expect(await accountStatus(ME, reads({ workerName: async () => "7field" }))).toEqual({ kind: "worker-name" });
  });

  it("needs approval until the authority has approved the account", async () => {
    expect(await accountStatus(ME, reads({ verified: async () => false }))).toEqual({ kind: "needs-approval" });
    expect(await accountStatus(ME, reads())).toEqual({ kind: "ready" });
  });

  it("checks an existing name before approval (a named account never reads as needing approval)", async () => {
    expect((await accountStatus(ME, reads({ employerName: async () => "5", verified: async () => false }))).kind).toBe("has-name");
  });

  it("lets a failed read through for the caller to show", async () => {
    await expect(accountStatus(ME, reads({ verified: async () => Promise.reject(new Error("offline")) }))).rejects.toThrow("offline");
  });
});

describe("checkName", () => {
  it("finds a free name and a taken one", async () => {
    expect(await checkName("dayco", { nameOwner: async () => null })).toEqual({ kind: "available", nameHash: computeNameHash("dayco") });
    expect((await checkName("dayco", { nameOwner: async () => OTHER })).kind).toBe("taken");
  });

  it("refuses a name that isn't valid before asking the registry", async () => {
    let asked = false;
    await expect(checkName("No", { nameOwner: async () => ((asked = true), null) })).rejects.toThrow(/A name is/);
    expect(asked).toBe(false);
  });
});
