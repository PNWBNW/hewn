// ---------------------------------------------------------------------------
// The mailbox function: the one stateless server piece (docs/INTEGRATION_AUDIT.md
// §4.4, docs/THREAT_MODEL.md "The mailbox"). It holds the pinning key, stores
// nothing, and only ever sees sealed envelopes addressed by a lookup hash.
//
//   POST   /api/mailbox/<lookup>   deliver an envelope (409 if the slot is taken)
//   GET    /api/mailbox/<lookup>   read it (404 when there is nothing there)
//   DELETE /api/mailbox/<lookup>   drop it once the receiver's vault has it
//
// A delivery may carry a keep-until day (`X-Mailbox-Keep-Until`, from
// @pnw/mailbox retention.ts); it is pinned beside the envelope, and the daily
// sweep (sweep.ts) unpins it once that day has passed. Without one, a pin
// stays until the receiver drops it.
//
// By construction it refuses anything that is not an envelope: the lookup
// must be a hash, the body must be bytes that start with the envelope version
// byte, and the size is capped. Nothing is logged: not the body, not the lookup.
// Same origin only: no CORS headers are ever set.
// ---------------------------------------------------------------------------

import { ENVELOPE_OVERHEAD, ENVELOPE_VERSION, KEEP_UNTIL_HEADER, LOOKUP_PATTERN, MAX_ENVELOPE_BYTES, checkKeepUntil } from "@pnw/mailbox";
import type { PinStore } from "./pinata";

export type Handler = (request: Request, lookup: string) => Promise<Response>;
export type MailboxHandlers = { POST: Handler; GET: Handler; DELETE: Handler };

const OCTET_STREAM = "application/octet-stream";
const NO_STORE = { "Cache-Control": "no-store" };

function problem(status: number, error: string): Response {
  return Response.json({ error }, { status, headers: NO_STORE });
}

const notConfigured = () => problem(503, "mailbox not configured");
const badLookup = () => problem(400, "bad lookup");
const unavailable = () => problem(502, "mailbox unavailable");
const empty = () => new Response(null, { status: 204, headers: NO_STORE });

/** Reads at most `max` bytes of the body; null means it was longer than that. */
async function readCapped(request: Request, max: number): Promise<Uint8Array | null> {
  const declared = Number(request.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > max) return null;
  const body = request.body;
  if (!body) return new Uint8Array(0);
  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > max) return null;
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return out;
}

export type MailboxOptions = { now?: () => Date };

/** The three handlers over a pin store; `null` means the server has no pinning key. */
export function mailboxHandlers(store: PinStore | null, options: MailboxOptions = {}): MailboxHandlers {
  const now = options.now ?? (() => new Date());
  const guard =
    (run: (store: PinStore, request: Request, lookup: string) => Promise<Response>): Handler =>
    async (request, lookup) => {
      if (!store) return notConfigured();
      if (typeof lookup !== "string" || !LOOKUP_PATTERN.test(lookup)) return badLookup();
      try {
        return await run(store, request, lookup);
      } catch {
        return unavailable();
      }
    };

  return {
    POST: guard(async (store, request, lookup) => {
      const type = (request.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
      if (type !== OCTET_STREAM) return problem(415, "send application/octet-stream");
      const bytes = await readCapped(request, MAX_ENVELOPE_BYTES);
      if (!bytes) return problem(413, `an envelope is at most ${MAX_ENVELOPE_BYTES} bytes`);
      if (bytes.length < ENVELOPE_OVERHEAD || bytes[0] !== ENVELOPE_VERSION) return problem(400, "not an envelope");
      const keepHeader = request.headers.get(KEEP_UNTIL_HEADER);
      let keepUntil: string | undefined;
      if (keepHeader !== null) {
        try {
          keepUntil = checkKeepUntil(keepHeader.trim(), now());
        } catch {
          return problem(400, "bad keep-until day");
        }
      }
      if ((await store.find(lookup)) !== null) return problem(409, "slot taken");
      await store.pin(lookup, bytes, keepUntil);
      return empty();
    }),

    GET: guard(async (store, _request, lookup) => {
      const cid = await store.find(lookup);
      if (cid === null) return problem(404, "nothing here");
      const bytes = await store.fetch(cid);
      if (bytes === null) return problem(404, "nothing here");
      return new Response(new Uint8Array(bytes), {
        status: 200,
        headers: { ...NO_STORE, "Content-Type": OCTET_STREAM, "Content-Length": String(bytes.byteLength) },
      });
    }),

    DELETE: guard(async (store, _request, lookup) => {
      const cid = await store.find(lookup);
      if (cid !== null) await store.unpin(cid);
      return empty();
    }),
  };
}
