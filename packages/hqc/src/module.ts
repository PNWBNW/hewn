// The WebAssembly module (dist/hqc5.wasm, carried in ./hqc5_wasm as base64): instantiated once from
// those bytes, never fetched, with an empty import object (it imports nothing, and would fail to
// instantiate if it did). Each call fills the module's buffers, runs one operation, copies out what
// it made, and then zeroes every buffer and the whole stack, whatever happened.
import { HQC5_WASM_BASE64, HQC5_WASM_BYTES } from "./hqc5_wasm";

export type Bytes = Uint8Array<ArrayBuffer>;

export const PUBLIC_KEY_BYTES = 7237;
export const SECRET_KEY_BYTES = 32;
export const CIPHERTEXT_BYTES = 14421;
export const SHARED_SECRET_BYTES = 32;
export const ENCAPSULATION_RANDOM_BYTES = 48;

export class HqcError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "HqcError";
  }
}

type Exports = {
  memory: WebAssembly.Memory;
  hqc5_layout(): number;
  hqc5_keygen(): number;
  hqc5_encaps(): number;
  hqc5_decaps(): number;
};

/** Where the module keeps each buffer and its stack (wasm/hqc5.c, `hqc5_layout`). */
export type Hqc5Module = {
  exports: Exports;
  pk: number;
  ct: number;
  sk: number;
  ss: number;
  rnd: number;
  stackLow: number;
  stackHigh: number;
};

const REGIONS = [
  ["pk", PUBLIC_KEY_BYTES],
  ["ct", CIPHERTEXT_BYTES],
  ["sk", SECRET_KEY_BYTES],
  ["ss", SHARED_SECRET_BYTES],
  ["rnd", ENCAPSULATION_RANDOM_BYTES],
] as const;

function wasmBytes(): Bytes {
  const text = atob(HQC5_WASM_BASE64);
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i);
  if (out.length !== HQC5_WASM_BYTES) throw new HqcError("The HQC-5 module's bytes are damaged");
  return out;
}

async function instantiate(): Promise<Hqc5Module> {
  const { instance } = await WebAssembly.instantiate(wasmBytes(), {});
  const x = instance.exports as unknown as Exports;
  if (!(x.memory instanceof WebAssembly.Memory) || ["hqc5_layout", "hqc5_keygen", "hqc5_encaps", "hqc5_decaps"].some((f) => typeof x[f as keyof Exports] !== "function")) {
    throw new HqcError("The HQC-5 module doesn't export what this package calls");
  }
  const at = x.hqc5_layout();
  const size = x.memory.buffer.byteLength;
  if (at % 4 !== 0 || at + 28 > size) throw new HqcError("The HQC-5 module's layout is out of bounds");
  const [pk, ct, sk, ss, rnd, stackLow, stackHigh] = Array.from(new Uint32Array(x.memory.buffer, at, 7));
  const m = { exports: x, pk: pk!, ct: ct!, sk: sk!, ss: ss!, rnd: rnd!, stackLow: stackLow!, stackHigh: stackHigh! };
  const spans: [number, number][] = [[m.stackLow, m.stackHigh], ...REGIONS.map(([k, n]): [number, number] => [m[k], m[k] + n])];
  const sorted = [...spans].sort((a, b) => a[0] - b[0]);
  sorted.forEach(([lo, hi], i) => {
    if (!(lo < hi && hi <= size) || (i > 0 && lo < sorted[i - 1]![1])) throw new HqcError("The HQC-5 module's layout is out of bounds");
  });
  return m;
}

let loading: Promise<Hqc5Module> | undefined;

/** The one instance, made on first use. A failed instantiation is retried on the next call. */
export function hqc5(): Promise<Hqc5Module> {
  loading ??= instantiate().catch((e: unknown) => {
    loading = undefined;
    throw e instanceof HqcError ? e : new HqcError("The HQC-5 module can't be instantiated", { cause: e });
  });
  return loading;
}

const memory = (m: Hqc5Module): Bytes => new Uint8Array(m.exports.memory.buffer);

/** Zeroes every buffer and the whole stack: between calls nothing of a key or a secret stays in the module. */
export function scrub(m: Hqc5Module): void {
  const mem = memory(m);
  mem.fill(0, m.stackLow, m.stackHigh);
  for (const [k, n] of REGIONS) mem.fill(0, m[k], m[k] + n);
}

export type Operation = "keygen" | "encaps" | "decaps";

/**
 * Runs one operation: `fill` writes its inputs into the module's memory, `read` copies its outputs
 * out. The module is scrubbed afterwards whether the operation succeeded, failed or trapped; after
 * a trap (its stack pointer is then left where the trap was) the instance is dropped and the next
 * call makes a new one.
 */
export function run<T>(m: Hqc5Module, op: Operation, fill: (mem: Bytes, m: Hqc5Module) => void, read: (mem: Bytes, m: Hqc5Module) => T): T {
  try {
    fill(memory(m), m);
    const code = op === "keygen" ? m.exports.hqc5_keygen() : op === "encaps" ? m.exports.hqc5_encaps() : m.exports.hqc5_decaps();
    if (code !== 0) throw new HqcError(`HQC-5 ${op} failed (code ${code})`);
    return read(memory(m), m);
  } catch (e) {
    if (e instanceof HqcError) throw e;
    loading = undefined;
    throw new HqcError(`HQC-5 ${op} stopped in the module`, { cause: e });
  } finally {
    scrub(m);
  }
}
