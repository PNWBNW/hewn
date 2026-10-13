// ---------------------------------------------------------------------------
// Money is an integer number of cents (bigint). Never a float: 0.1 + 0.2 is
// not 0.3 in floating point, and books must tie to the penny forever.
// ---------------------------------------------------------------------------

import { fail } from "./errors";

export type Cents = bigint;

const AMOUNT = /^(-)?(\d{1,15})(?:\.(\d{1,2}))?$/;

/** "1,234.5" → 123450n. Rejects floats, more than 2 decimals, and junk. */
export function parseCents(text: string): Cents {
  const clean = text.trim().replace(/,/g, "").replace(/^\$/, "");
  const m = AMOUNT.exec(clean);
  if (!m) fail("BAD_AMOUNT", `Not a money amount: "${text}"`);
  const [, sign, whole, frac = ""] = m;
  const cents = BigInt(whole!) * 100n + BigInt(frac.padEnd(2, "0"));
  return sign ? -cents : cents;
}

/** 123450n → "1,234.50"; -500n → "-5.00". */
export function formatCents(cents: Cents): string {
  const neg = cents < 0n;
  const abs = neg ? -cents : cents;
  const whole = (abs / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const frac = (abs % 100n).toString().padStart(2, "0");
  return `${neg ? "-" : ""}${whole}.${frac}`;
}

export function sumCents(values: Iterable<Cents>): Cents {
  let total = 0n;
  for (const v of values) total += v;
  return total;
}
