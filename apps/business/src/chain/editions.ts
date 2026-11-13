// Before the app asks for a signature, the programs it relies on are still the ones it was made
// for (docs/THREAT_MODEL.md T21).
//
// A program with an `@admin` constructor can be upgraded in place by whoever holds the admin key,
// and an upgrade may change what a function does without changing its name or inputs. The wallet
// proves against the newest edition and doesn't say which. So this reads each upgradable
// program's edition from the network and refuses when one isn't an edition this version of the
// app lists (@pnw/config `EDITIONS`). It checks all of them, not only the program being called:
// a payment to a registered name relies on the registry even when the transfer itself is another
// program's. It asks each time, never from memory.
//
// The pins cover the stablecoin too, and the programs it imports: every payment runs it, and its
// issuer can upgrade it (@pnw/config `EDITIONS`, external).
//
// The answer comes from the explorer, as every read does, so its operator could make the app
// refuse (never make it sign). An unreachable or slow explorer refuses too: nothing is sent
// unchecked. What this can't see: an upgrade in the seconds between the check and the network
// accepting the transaction.

import { ENV } from "@pnw/config/env";
import { EDITIONS } from "@pnw/config/programs";

/** A program changed, or couldn't be checked. Nothing was sent. */
export class EditionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EditionError";
  }
}

/** How long one read of an edition may take before the check gives up (and nothing is sent). */
export const EDITION_READ_TIMEOUT_MS = 10_000;

type Options = { endpoint?: string; fetchImpl?: typeof fetch; editions?: Readonly<Record<string, readonly number[]>>; timeoutMs?: number };

async function read(program: string, endpoint: string, fetchImpl: typeof fetch, timeoutMs: number): Promise<number> {
  const res = await fetchImpl(`${endpoint}/program/${program}/latest_edition`, { cache: "no-store", signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`${program}: ${res.status}`);
  const edition: unknown = await res.json();
  if (typeof edition !== "number" || !Number.isInteger(edition) || edition < 0) throw new Error(`${program}: not an edition`);
  return edition;
}

/**
 * Throws unless every pinned program is at an edition this app was made for. Asks the network
 * every time, right before the wallet is asked: an answer from a moment ago could hide an upgrade
 * made in between (a worker's setup is two transactions a few minutes apart).
 */
export async function checkEditions({ endpoint = ENV.ALEO_ENDPOINT, fetchImpl = fetch, editions = EDITIONS, timeoutMs = EDITION_READ_TIMEOUT_MS }: Options = {}): Promise<void> {
  let changed: { program: string; edition: number }[];
  try {
    const found = await Promise.all(Object.keys(editions).map(async (program) => ({ program, edition: await read(program, endpoint, fetchImpl, timeoutMs) })));
    changed = found.filter((f) => !editions[f.program]!.includes(f.edition));
  } catch {
    throw new EditionError("Couldn't check the programs on the network before sending, so nothing was sent. Try again in a moment.");
  }
  if (changed.length > 0) {
    const what = changed.map((c) => `${c.program} (now edition ${c.edition})`).join(", ");
    throw new EditionError(
      `A program this app relies on was changed on the network after this version of the app was made: ${what}. Nothing was sent. Reload to get the newest version of the app. If you still see this, don't sign anything until it has been explained.`,
    );
  }
}
