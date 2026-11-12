// Before the app asks for a signature, the programs it relies on are still the ones it was made
// for (docs/THREAT_MODEL.md T21).
//
// A program with an `@admin` constructor can be upgraded in place by whoever holds the admin key,
// and an upgrade may change what a function does without changing its name or inputs. The wallet
// proves against the newest edition and doesn't say which. So this reads each upgradable
// program's edition from the network and refuses when one isn't an edition this version of the
// app lists (@pnw/config `EDITIONS`). It checks all of them, not only the program being called:
// a payment to a registered name relies on the registry even when the transfer itself is another
// program's.
//
// The answer comes from the explorer, as every read does, so its operator could make the app
// refuse (never make it sign). An unreachable explorer refuses too: nothing is sent unchecked.

import { ENV } from "@pnw/config/env";
import { EDITIONS } from "@pnw/config/programs";

/** A program changed, or couldn't be checked. Nothing was sent. */
export class EditionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EditionError";
  }
}

/** How long an answer is trusted before it is asked for again. */
export const EDITIONS_FRESH_MS = 10 * 60 * 1000;

type Checked = { at: number; changed: { program: string; edition: number }[] };
let last: Checked | null = null;
let pending: Promise<Checked> | null = null;

type Options = { endpoint?: string; fetchImpl?: typeof fetch; now?: () => number; editions?: Readonly<Record<string, readonly number[]>> };

async function read(program: string, endpoint: string, fetchImpl: typeof fetch): Promise<number> {
  const res = await fetchImpl(`${endpoint}/program/${program}/latest_edition`, { cache: "no-store" });
  if (!res.ok) throw new Error(`${program}: ${res.status}`);
  const edition: unknown = await res.json();
  if (typeof edition !== "number" || !Number.isInteger(edition) || edition < 0) throw new Error(`${program}: not an edition`);
  return edition;
}

async function readAll({ endpoint = ENV.ALEO_ENDPOINT, fetchImpl = fetch, now = Date.now, editions = EDITIONS }: Options): Promise<Checked> {
  const found = await Promise.all(Object.keys(editions).map(async (program) => ({ program, edition: await read(program, endpoint, fetchImpl) })));
  return { at: now(), changed: found.filter((f) => !editions[f.program]!.includes(f.edition)) };
}

/**
 * Throws unless every upgradable program is at an edition this app was made for. Asks the
 * network at most once per EDITIONS_FRESH_MS; a wrong answer is never kept, so the next try asks
 * again.
 */
export async function checkEditions(options: Options = {}): Promise<void> {
  const now = options.now ?? Date.now;
  if (!last || last.changed.length > 0 || now() - last.at >= EDITIONS_FRESH_MS) {
    pending ??= readAll(options).finally(() => {
      pending = null;
    });
    try {
      last = await pending;
    } catch {
      last = null;
      throw new EditionError("Couldn't check the programs on the network before sending, so nothing was sent. Try again in a moment.");
    }
  }
  if (last.changed.length > 0) {
    const what = last.changed.map((c) => `${c.program} (now edition ${c.edition})`).join(", ");
    throw new EditionError(
      `A program this app relies on was changed on the network after this version of the app was made: ${what}. Nothing was sent. Reload to get the newest version of the app. If you still see this, don't sign anything until it has been explained.`,
    );
  }
}

/** Asks ahead of time, so the check at the moment of sending is already answered. Never throws. */
export function warmEditions(options: Options = {}): void {
  void checkEditions(options).catch(() => {});
}

/** For tests: forget what was read. */
export function forgetEditions(): void {
  last = null;
  pending = null;
}
