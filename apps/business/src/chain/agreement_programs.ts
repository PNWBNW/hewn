// ---------------------------------------------------------------------------
// Which agreement programs the app uses (pnw_mvp_v2 src/layer1): v5, deployed
// 2026-10-24 (docs/migrations/2026-10-23-agreement-v5.md there), where every
// new offer goes since 2026-10-25, and v4, which holds the agreements made
// before and is still read. The app reads agreement records from every
// program it ever offered through, newest first.
//
// v5 carries the two P-256 public halves in its records (the employer's with
// the offer, the worker's with the acceptance), so each side seeds the
// conversation's key ring from them (books/key_ring.ts `seedPair`) and the
// first letter after acceptance is twin-curve. v5 also packs its bytes: 32
// bytes travel as `[u128; 2]` and a half as `[u128; 4]` (@pnw/records
// `packed`), where v4 took `[u8; N]`. Nothing here is logged.
// ---------------------------------------------------------------------------

import { PROGRAMS } from "@pnw/config/programs";
import { arrayFieldHex, packedWords } from "@pnw/records/packed";

export const AGREEMENT_V4: string = PROGRAMS.layer1.employer_agreement;
export const AGREEMENT_V5: string = PROGRAMS.layer1.employer_agreement_v5;

/** Where a new offer goes. */
export const OFFER_PROGRAM: string = AGREEMENT_V5;
/** Every program agreement records are read from, newest first. */
export const AGREEMENT_PROGRAMS: readonly string[] = [AGREEMENT_V5, AGREEMENT_V4];

/** Whether a program's records carry the halves and pack their bytes (v5). Absent means v4. */
export const carriesHalves = (program: string | undefined): boolean => program === AGREEMENT_V5;

const PUBLIC_KEY = /^04[0-9a-f]{128}$/;

/** A P-256 public half (`04` + x + y, hex) as the program's `[u128; 4]` input: x and y, 64 bytes packed. */
export function halfToInput(publicKey: string): string {
  if (!PUBLIC_KEY.test(publicKey)) throw new Error("That isn't a key half");
  return packedWords(publicKey.slice(2), 4);
}

/** A half as a record carries it (`[u128; 4]`: x and y) back to the public key the app uses. Null when it isn't one. */
export function halfFromRecord(hex: string | null): string | null {
  if (!hex || !/^[0-9a-f]{128}$/.test(hex)) return null;
  const key = `04${hex}`;
  return PUBLIC_KEY.test(key) ? key : null;
}

/** A record's half field (`employer_half`, `worker_half`) as the public key, or null when the record has none. */
export const halfOf = (plaintext: string, field: "employer_half" | "worker_half"): string | null => halfFromRecord(arrayFieldHex(plaintext, field, 64));
