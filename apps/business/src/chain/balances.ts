// ---------------------------------------------------------------------------
// What the linked account holds, read rather than typed in: ALEO credits and
// USDCx, each as a private part (the account's unspent records, which only
// Shield can read) and a public part (the programs' public balance mappings,
// which anyone can read from the explorer).
//
// Display only: nothing here posts to the books.
//
// Pure apart from the injected reads: no React, no storage, nothing logged.
// Deliberately free of @pnw/rail, whose index pulls in the prover's
// WebAssembly; the dashboard only needs the explorer.
// ---------------------------------------------------------------------------

import { ENV } from "@pnw/config/env";
import { PROGRAMS } from "@pnw/config/programs";

export const CREDITS_PROGRAM = "credits.aleo";
export const USDCX_PROGRAM = PROGRAMS.external.usdcx;

/** Both coins use six decimals: 1 ALEO is 1,000,000 microcredits, 1 USDCx is 1,000,000 minor units. */
export const MINOR_PER_UNIT = 1_000_000n;

/**
 * The stablecoin's public balance mapping. The deployed program's name isn't
 * pinned here (our local stub calls it `account`), so both are tried in turn.
 */
export const USDCX_PUBLIC_MAPPINGS = ["balances", "account"] as const;

/** One coin's balance; null is "not read" (Shield not connected, or the read failed). */
export type CoinBalance = { private: bigint | null; public: bigint | null };
export type AccountBalances = { aleo: CoinBalance; usdcx: CoinBalance };

const MICROCREDITS = /\bmicrocredits:\s*(\d+)u64\b/;
const AMOUNT = /\bamount:\s*(\d+)u128\b/;

/** Sums one field across the unspent records the wallet returned. Unknown shapes are skipped. */
function sumRecords(raw: readonly unknown[], recordName: string, pattern: RegExp): bigint {
  let total = 0n;
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const rec = r as Record<string, unknown>;
    if (rec.spent === true) continue;
    if (rec.recordName !== undefined && rec.recordName !== recordName) continue;
    if (typeof rec.recordPlaintext !== "string") continue;
    const m = pattern.exec(rec.recordPlaintext);
    if (m?.[1]) total += BigInt(m[1]);
  }
  return total;
}

/** Private ALEO: the microcredits across unspent `credits` records. */
export const privateCredits = (raw: readonly unknown[]): bigint => sumRecords(raw, "credits", MICROCREDITS);

/** Private USDCx: the amount across unspent `Token` records. */
export const privateTokens = (raw: readonly unknown[]): bigint => sumRecords(raw, "Token", AMOUNT);

/** A mapping value as the explorer returns it (`"1500000u64"`), or null when there is no entry. Throws on anything else. */
export function parseMappingAmount(value: unknown, type: "u64" | "u128"): bigint | null {
  if (value === null || value === undefined) return null;
  const m = typeof value === "string" ? new RegExp(`^\\s*(\\d+)${type}(?:\\.public)?\\s*$`).exec(value) : null;
  if (!m?.[1]) throw new Error("The network sent a balance in an unexpected shape");
  return BigInt(m[1]);
}

/** GET one mapping entry: the parsed JSON, or null when the explorer has no such entry (404). */
export type MappingRead = (program: string, mapping: string, key: string) => Promise<unknown>;

export function explorerMappingRead(endpoint: string = ENV.ALEO_ENDPOINT, fetchImpl: typeof fetch = fetch): MappingRead {
  const base = endpoint.replace(/\/+$/, "");
  return async (program, mapping, key) => {
    const res = await fetchImpl(`${base}/program/${program}/mapping/${mapping}/${key}`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(15_000),
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`The network answered ${res.status}`);
    return res.json();
  };
}

/** Public ALEO: `credits.aleo/account[address]`, zero when the account has never held any. */
export async function publicCredits(address: string, read: MappingRead): Promise<bigint> {
  return parseMappingAmount(await read(CREDITS_PROGRAM, "account", address), "u64") ?? 0n;
}

/** Public USDCx: the first stablecoin mapping with an entry for the address, zero when none has one. */
export async function publicTokens(address: string, read: MappingRead): Promise<bigint> {
  let failure: unknown = null;
  let answered = false;
  for (const mapping of USDCX_PUBLIC_MAPPINGS) {
    try {
      const amount = parseMappingAmount(await read(USDCX_PROGRAM, mapping, address), "u128");
      answered = true;
      if (amount !== null) return amount;
    } catch (e) {
      failure = e;
    }
  }
  if (!answered) throw failure;
  return 0n;
}

/**
 * Six-decimal minor units as a figure: grouped thousands, at least `min`
 * decimals, trailing zeros past that dropped. `1500000n` → "1.50".
 */
export function formatSixDecimals(minor: bigint, min = 2): string {
  const negative = minor < 0n;
  const abs = negative ? -minor : minor;
  const whole = (abs / MINOR_PER_UNIT).toLocaleString("en-US");
  let frac = (abs % MINOR_PER_UNIT).toString().padStart(6, "0");
  while (frac.length > min && frac.endsWith("0")) frac = frac.slice(0, -1);
  return `${negative ? "-" : ""}${whole}${frac ? `.${frac}` : ""}`;
}

/** A coin's total, or null while either part is unread. */
export const totalOf = (b: CoinBalance): bigint | null => (b.private === null || b.public === null ? null : b.private + b.public);
