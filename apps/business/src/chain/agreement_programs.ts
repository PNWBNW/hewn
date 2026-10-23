// ---------------------------------------------------------------------------
// Which agreement programs the app uses (pnw_mvp_v2 src/layer1): v4, live,
// and v5, staged (docs/migrations/2026-10-23-agreement-v5.md there). The app
// reads agreement records from every program it ever offered through, and
// sends new offers to one. Flipping to v5 is the two constants below, in the
// same PR as pnw_mvp_v2's manifest, once it is deployed.
//
// v5 carries the two P-256 public halves in its records (the employer's with
// the offer, the worker's with the acceptance), so each side seeds the
// conversation's key ring from them (books/key_ring.ts `seedPair`) and the
// first letter after acceptance is twin-curve. Nothing here is logged.
// ---------------------------------------------------------------------------

import { PROGRAMS } from "@pnw/config/programs";

export const AGREEMENT_V4: string = PROGRAMS.layer1.employer_agreement;
export const AGREEMENT_V5: string = PROGRAMS.layer1.employer_agreement_v5;

/** Where a new offer goes. Flip to AGREEMENT_V5 once it is deployed. */
export const OFFER_PROGRAM: string = AGREEMENT_V4;
/** Every program agreement records are read from, newest first. Add AGREEMENT_V5 first with the flip above. */
export const AGREEMENT_PROGRAMS: readonly string[] = [AGREEMENT_V4];

/** Whether a program's records carry the halves (v5). Absent means v4. */
export const carriesHalves = (program: string | undefined): boolean => program === AGREEMENT_V5;

const PUBLIC_KEY = /^04[0-9a-f]{128}$/;

/** A P-256 public half (`04` + x + y, hex) as the program's `[u8; 64]` input: x and y, 64 bytes. */
export function halfToInput(publicKey: string): string {
  if (!PUBLIC_KEY.test(publicKey)) throw new Error("That isn't a key half");
  const bytes: string[] = [];
  for (let i = 2; i < publicKey.length; i += 2) bytes.push(`${parseInt(publicKey.slice(i, i + 2), 16)}u8`);
  return "[ " + bytes.join(", ") + " ]";
}

/** A half as a record carries it (128 hex characters, x and y) back to the public key the app uses. Null when it isn't one. */
export function halfFromRecord(hex: string | null): string | null {
  if (!hex || !/^[0-9a-f]{128}$/.test(hex)) return null;
  const key = `04${hex}`;
  return PUBLIC_KEY.test(key) ? key : null;
}
