// The generated bindings stay what the generator makes from the program's own ABI, and the ABI
// stays what is deployed (README.md here, docs/VEIL.md step 2).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { generate } from "@provablehq/veil-codegen";
import { parseAbi } from "@provablehq/veil-core";
import { PROGRAMS } from "@pnw/config/programs";
import { PROGRAM_ID as AGREEMENT_V4_ID } from "./employer_agreement_v4";
import { PROGRAM_ID as AGREEMENT_V5_ID } from "./employer_agreement_v5";
import { PROGRAM_ID as LETTERS_ID } from "./hewn_letters_v2";

const here = (file: string) => readFileSync(new URL(file, import.meta.url), "utf8");

/** Each generated program: its id in @pnw/config, the id the bindings carry, and its records as deployed. */
const PROGRAMS_GENERATED = [
  { file: "hewn_letters_v2", config: PROGRAMS.letters.hewn_letters, id: LETTERS_ID, records: ["Letter", "Page", "SentLetter"] },
  { file: "employer_agreement_v5", config: PROGRAMS.layer1.employer_agreement_v5, id: AGREEMENT_V5_ID, records: ["AgreementEnd", "FinalAgreement", "PendingAgreement", "SentOffer"] },
  { file: "employer_agreement_v4", config: PROGRAMS.layer1.employer_agreement, id: AGREEMENT_V4_ID, records: ["FinalAgreement", "PendingAgreement"] },
] as const;

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

describe.each(PROGRAMS_GENERATED)("the generated bindings for $file", ({ file, config, id, records }) => {
  const abi = JSON.parse(here(`./${file}.abi.json`));
  /** The deployed bytecode, read from the explorer (test/devnode/programs, checksums in its README). */
  const deployed = here(`../../../test/devnode/programs/${file}.aleo`);

  it("are exactly what veil-codegen makes from the checked-in ABI (regenerate with `pnpm codegen`, never edit)", () => {
    expect(here(`./${file}.ts`)).toBe(generate({ abi: parseAbi(abi), programId: `${file}.aleo` }));
  });

  it("name the program @pnw/config names", () => {
    expect(id).toBe(config);
    expect(abi.program).toBe(config);
  });

  it("come from an ABI whose records are the deployed program's, field for field", () => {
    const fromBytecode = bytecodeRecords(deployed);
    expect(Object.keys(fromBytecode).sort()).toEqual([...records]);
    expect(abiRecords(abi)).toEqual(fromBytecode);
  });
});
