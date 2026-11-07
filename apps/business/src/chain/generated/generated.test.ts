// The generated bindings stay what the generator makes from the program's own ABI, and the ABI
// stays what is deployed (README.md here, docs/VEIL.md step 2).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { generate } from "@provablehq/veil-codegen";
import { parseAbi } from "@provablehq/veil-core";
import { PROGRAMS } from "@pnw/config/programs";
import { PROGRAM_ID } from "./hewn_letters_v2";

const here = (file: string) => readFileSync(new URL(file, import.meta.url), "utf8");
const ABI_JSON = JSON.parse(here("./hewn_letters_v2.abi.json"));
/** The deployed bytecode, read from the explorer (the devnode tests deploy the same file). */
const DEPLOYED = here("../../../test/devnode/programs/hewn_letters_v2.aleo");

/** Each record in Aleo bytecode as `name: [field type, …]`, e.g. `Letter: ["lookup [u128; 2]", …]`. */
function bytecodeRecords(bytecode: string): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const m of bytecode.matchAll(/^record (\w+):\n((?: {4}.+\n)+)/gm)) {
    out[m[1]!] = [...m[2]!.matchAll(/^ {4}(\w+) as (.+?)\.(?:private|public);$/gm)]
      .filter((f) => f[1] !== "owner")
      .map((f) => `${f[1]} ${f[2]!.replace(/u32\]/g, "]")}`);
  }
  return out;
}

/** The ABI's records in the same shape, from Leo's JSON. */
function abiRecords(abi: { records: { path: string[]; fields: { name: string; ty: unknown }[] }[] }): Record<string, string[]> {
  const type = (ty: unknown): string => {
    const t = ty as Record<string, unknown>;
    if ("Array" in t) {
      const a = t.Array as { element: unknown; length: number };
      return `[${type(a.element)}; ${a.length}]`;
    }
    const p = (t as { Primitive: unknown }).Primitive;
    if (typeof p === "string") return p.toLowerCase();
    const [kind, width] = Object.entries(p as Record<string, string>)[0]!;
    return kind === "UInt" ? width.toLowerCase() : width.toLowerCase();
  };
  return Object.fromEntries(abi.records.map((r) => [r.path.at(-1)!, r.fields.filter((f) => f.name !== "owner").map((f) => `${f.name} ${type(f.ty)}`)]));
}

describe("the generated bindings for hewn_letters_v2", () => {
  it("are exactly what veil-codegen makes from the checked-in ABI (regenerate with `pnpm codegen`, never edit)", () => {
    expect(here("./hewn_letters_v2.ts")).toBe(generate({ abi: parseAbi(ABI_JSON), programId: "hewn_letters_v2.aleo" }));
  });

  it("name the program @pnw/config names", () => {
    expect(PROGRAM_ID).toBe(PROGRAMS.letters.hewn_letters);
    expect(ABI_JSON.program).toBe(PROGRAMS.letters.hewn_letters);
  });

  it("come from an ABI whose records are the deployed program's, field for field", () => {
    const deployed = bytecodeRecords(DEPLOYED);
    expect(Object.keys(deployed).sort()).toEqual(["Letter", "Page", "SentLetter"]);
    expect(abiRecords(ABI_JSON)).toEqual(deployed);
    expect(deployed.Letter).toEqual(["lookup [u128; 2]", "parcel [field; 34]"]);
  });
});
