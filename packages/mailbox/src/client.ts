// ---------------------------------------------------------------------------
// The client side of the mailbox function: put, get and drop one envelope by
// its lookup id. Same origin by default (`/api/mailbox`), and the only thing
// this module ever sends is an envelope that envelope.ts sealed. The fetch
// is injectable so tests never touch the network.
// ---------------------------------------------------------------------------

import { LOOKUP_PATTERN, MailboxError } from "./envelope";

export type MailboxFetch = (input: string, init: RequestInit) => Promise<Response>;

export type MailboxClientOptions = {
  /** Where the function lives. Default: the app's own `/api/mailbox`. */
  baseUrl?: string;
  /** Injected for tests; defaults to the global fetch. */
  fetch?: MailboxFetch;
};

const OCTET_STREAM = "application/octet-stream";

function checkLookup(lookup: string): string {
  if (typeof lookup !== "string" || !LOOKUP_PATTERN.test(lookup)) {
    throw new MailboxError("BAD_LOOKUP", "A lookup id is 64 hex characters");
  }
  return lookup;
}

function failure(status: number, verb: string): MailboxError {
  if (status === 503) return new MailboxError("NOT_CONFIGURED", "The mailbox isn't set up on this server");
  if (status === 409) return new MailboxError("CONFLICT", "That mailbox slot is already taken");
  return new MailboxError("REQUEST_FAILED", `The mailbox ${verb} failed (${status})`);
}

export class MailboxClient {
  readonly #baseUrl: string;
  readonly #fetch: MailboxFetch;

  constructor(options: MailboxClientOptions = {}) {
    this.#baseUrl = (options.baseUrl ?? "/api/mailbox").replace(/\/+$/, "");
    const own: MailboxFetch | null =
      typeof globalThis.fetch === "function" ? (input, init) => globalThis.fetch(input, init) : null;
    const f = options.fetch ?? own;
    if (!f) throw new MailboxError("REQUEST_FAILED", "No fetch is available");
    this.#fetch = f;
  }

  #url(lookup: string): string {
    return `${this.#baseUrl}/${checkLookup(lookup)}`;
  }

  /** Delivers a sealed envelope. Fails with `CONFLICT` if the slot is already taken. */
  async put(lookup: string, envelope: Uint8Array): Promise<void> {
    const url = this.#url(lookup);
    const res = await this.#fetch(url, {
      method: "POST",
      headers: { "Content-Type": OCTET_STREAM },
      body: new Uint8Array(envelope),
      cache: "no-store",
      credentials: "same-origin",
    });
    if (!res.ok) throw failure(res.status, "delivery");
  }

  /** The envelope at `lookup`, or null if nothing is there (the end of a scan). */
  async get(lookup: string): Promise<Uint8Array<ArrayBuffer> | null> {
    const url = this.#url(lookup);
    const res = await this.#fetch(url, { method: "GET", cache: "no-store", credentials: "same-origin" });
    if (res.status === 404) return null;
    if (!res.ok) throw failure(res.status, "read");
    return new Uint8Array(await res.arrayBuffer());
  }

  /** Drops the envelope once it is safe in the receiver's vault. Already gone is fine. */
  async drop(lookup: string): Promise<void> {
    const url = this.#url(lookup);
    const res = await this.#fetch(url, { method: "DELETE", cache: "no-store", credentials: "same-origin" });
    if (res.status === 404) return;
    if (!res.ok) throw failure(res.status, "drop");
  }
}
