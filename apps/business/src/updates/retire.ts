// Retiring a bad release (README.md beside this file). A retirement is the release key's Ed25519
// signature of `release-retire:v1:<digest>` (the ASCII text, 82 bytes, so never the 32 digest bytes
// a release signature covers). The host publishes the list as release-retired.json at the bundle's
// root; the update worker drops a retired release and never takes it again. Signing happens on the
// operator's machine (scripts/retire_release.mjs); this file only shapes and merges the list.
//
// Imports nothing, so plain Node runs it from the script as it is.

/** What a retirement signs, before the digest. The worker (worker.js) uses the same text. */
export const RETIRE_TAG = "release-retire:v1:";

/** The name the host serves the list under, at the bundle's root. */
export const RETIRED_FILE = "release-retired.json";

export type Retirement = { readonly digest: string; readonly key: string; readonly sig: string };
export type RetiredList = { readonly retired: readonly Retirement[] };

const HEX64 = /^[0-9a-f]{64}$/;
const KEY_ID = /^[0-9a-f]{16}$/;

/** The bytes a retirement of `digest` signs. */
export function retireMessage(digest: string): Uint8Array {
  if (!HEX64.test(digest)) throw new Error("a release digest is 64 lowercase hex characters");
  return new TextEncoder().encode(RETIRE_TAG + digest);
}

/** Reads a release-retired.json, keeping only entries of the right shape (the worker checks each signature itself). */
export function parseRetired(text: string | null): Retirement[] {
  if (!text) return [];
  const list = (JSON.parse(text) as Partial<RetiredList>)?.retired;
  if (!Array.isArray(list)) throw new Error(`${RETIRED_FILE} has no "retired" list`);
  return list.filter((r): r is Retirement => HEX64.test(r?.digest ?? "") && KEY_ID.test(r?.key ?? "") && typeof r?.sig === "string");
}

/** The list with `entry` added (one entry per digest and key), sorted, as the file is written. */
export function addRetirement(list: readonly Retirement[], entry: Retirement): string {
  const all = [...list.filter((r) => !(r.digest === entry.digest && r.key === entry.key)), entry];
  all.sort((a, b) => (a.digest + a.key < b.digest + b.key ? -1 : 1));
  return JSON.stringify({ retired: all.map(({ digest, key, sig }) => ({ digest, key, sig })) }, null, 2) + "\n";
}
