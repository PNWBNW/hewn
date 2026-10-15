import { describe, expect, it } from "vitest";
import { PROGRAMS } from "@pnw/config/programs";
import { computeNameHash } from "@pnw/records/registry/name_registry";
import { REGISTER_BUSINESS, type RegistryReads, accountStatus, checkName, registerBusinessInputs } from "./business_registry";

const ME = "aleo1kypwp5m7qtk9mwazgcpg0tq8aal23mnrvwfvug65qgcg9xvsrqgspyjm6n";
const OTHER = "aleo1rhgdu77hgyqd3xjj8ucu3jj9r2krwz6mnzyd80gncr5fxcwlh5rsvzp9px";

const reads = (over: Partial<RegistryReads> = {}): RegistryReads => ({
  nameOwner: async () => null,
  workerName: async () => null,
  employerName: async () => null,
  ...over,
});

describe("register_employer_free inputs", () => {
  it("are the name hash, the name as a big-endian u128 and the industry, in that order", () => {
    const { nameHash, inputs } = registerBusinessInputs("dayco", 9);
    expect(nameHash).toBe(computeNameHash("dayco"));
    // "dayco" = 0x6461 7963 6f
    expect(inputs).toEqual([`${nameHash}field`, `${BigInt("0x6461796" + "36f")}u128`, "9u8"]);
  });

  it("go to the registrar's free function (edition 1): three inputs, no fee, no approval", () => {
    expect(REGISTER_BUSINESS).toEqual({ program: PROGRAMS.layer1.pnw_name_registrar, function: "register_employer_free" });
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

describe("accountStatus", () => {
  it("keeps a business name the account already holds, even with the field suffix", async () => {
    expect(await accountStatus(ME, reads({ employerName: async () => "123field" }))).toEqual({ kind: "has-name", nameHash: "123" });
  });

  it("says a worker's account can't take a business name", async () => {
    expect(await accountStatus(ME, reads({ workerName: async () => "7field" }))).toEqual({ kind: "worker-name" });
  });

  it("is ready for any account with no name: registration needs no approval", async () => {
    expect(await accountStatus(ME, reads())).toEqual({ kind: "ready" });
  });

  it("lets a failed read through for the caller to show", async () => {
    await expect(accountStatus(ME, reads({ workerName: async () => Promise.reject(new Error("offline")) }))).rejects.toThrow("offline");
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
