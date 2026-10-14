// ---------------------------------------------------------------------------
// The employer's stablecoin records, as the wallet reports them.
//
// A `Token` record is owner + amount (u128, six decimals: 1 USDCx is
// 1,000,000 minor units). The wallet hands back each record's plaintext,
// which is what a transition takes as input; the queue keeps the plaintext
// opaque and only reads the amount out of it.
// ---------------------------------------------------------------------------

import { PROGRAMS } from "@pnw/config/programs";
import type { RailWallet } from "./types";

export const USDCX_PROGRAM = PROGRAMS.external.usdcx;

/** Minor units per cent: cents × 10,000 = USDCx minor units. */
export const MINOR_PER_CENT = 10_000n;

export const centsToMinor = (cents: bigint): bigint => cents * MINOR_PER_CENT;

export type TokenRecord = {
  /** The record exactly as the wallet gave it, passed back as a transition input. */
  plaintext: string;
  /** USDCx minor units. */
  amount: bigint;
};

const AMOUNT = /\bamount:\s*(\d+)u128\b/;

/** Reads the amount out of a Token record's plaintext, or null when it isn't one. */
export function parseTokenPlaintext(plaintext: string): TokenRecord | null {
  const m = AMOUNT.exec(plaintext);
  if (!m?.[1]) return null;
  return { plaintext, amount: BigInt(m[1]) };
}

/** The unspent Token records among whatever the wallet returned. Unknown shapes are skipped. */
export function parseTokenRecords(raw: unknown[]): TokenRecord[] {
  const out: TokenRecord[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const rec = r as Record<string, unknown>;
    if (rec.spent === true) continue;
    if (rec.recordName !== undefined && rec.recordName !== "Token") continue;
    if (typeof rec.recordPlaintext !== "string") continue;
    const parsed = parseTokenPlaintext(rec.recordPlaintext);
    if (parsed) out.push(parsed);
  }
  return out;
}

/** Every unspent stablecoin record the connected account owns. */
export async function fetchTokenRecords(wallet: RailWallet): Promise<TokenRecord[]> {
  return parseTokenRecords(await wallet.requestRecords(USDCX_PROGRAM, true));
}

export const totalBalance = (records: readonly TokenRecord[]): bigint => records.reduce((sum, r) => sum + r.amount, 0n);

/** "1,234.56" from minor units, two decimals, for a balance line. */
export function formatMinorAsDollars(minor: bigint): string {
  const cents = minor / MINOR_PER_CENT;
  const whole = cents / 100n;
  const frac = (cents % 100n).toString().padStart(2, "0");
  return `${whole.toLocaleString("en-US")}.${frac}`;
}
