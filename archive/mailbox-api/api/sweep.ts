// ---------------------------------------------------------------------------
// The daily sweep: unpins every mailbox pin whose keep-until day has passed
// (@pnw/mailbox retention.ts). Run by the host's scheduler (vercel.json
// `crons`), which calls it with `Authorization: Bearer <CRON_SECRET>`; without
// that secret set, or with the wrong one, it does nothing. It learns and
// reports only a count: a pin's name is a hash and its day is a date.
// Pins without a keep-until day are never touched.
// ---------------------------------------------------------------------------

import { utcDay } from "@pnw/mailbox";
import type { PinStore } from "./pinata";

/** The most pins one run unpins; the next day's run takes the rest. */
export const SWEEP_LIMIT = 500;

const NO_STORE = { "Cache-Control": "no-store" };

/** Compares two strings in time that depends only on their lengths. */
function sameSecret(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export type SweepOptions = { now?: () => Date; limit?: number };

/** GET handler: `store` null means no pinning key; `secret` null means no CRON_SECRET. */
export function sweepHandler(store: PinStore | null, secret: string | null, options: SweepOptions = {}) {
  const now = options.now ?? (() => new Date());
  const limit = options.limit ?? SWEEP_LIMIT;
  return async (request: Request): Promise<Response> => {
    if (!store || !secret) return Response.json({ error: "sweep not configured" }, { status: 503, headers: NO_STORE });
    const auth = request.headers.get("authorization") ?? "";
    if (!sameSecret(auth, `Bearer ${secret}`)) return Response.json({ error: "unauthorized" }, { status: 401, headers: NO_STORE });
    try {
      const cids = await store.expired(utcDay(now()), limit);
      let swept = 0;
      for (const cid of cids) {
        await store.unpin(cid);
        swept++;
      }
      return Response.json({ swept }, { headers: NO_STORE });
    } catch {
      return Response.json({ error: "mailbox unavailable" }, { status: 502, headers: NO_STORE });
    }
  };
}
