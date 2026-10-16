// ---------------------------------------------------------------------------
// The pinning service behind the mailbox, behind a four-call interface so the
// handlers can be tested with a fake and another service (or a self-hosted
// node) can swap in. Pinata only ever holds sealed envelopes, in flight, and
// the only thing it learns about one is its name: the lookup hash.
// ---------------------------------------------------------------------------

/** What the mailbox needs from a pinning service. Names are lookup hashes. */
export interface PinStore {
  /** The content id pinned under `name`, or null if there is none. */
  find(name: string): Promise<string | null>;
  /** Pins `bytes` under `name`. The name, and the keep-until day when there is one, are the only metadata. */
  pin(name: string, bytes: Uint8Array, keepUntil?: string): Promise<void>;
  /** Content ids of mailbox pins whose keep-until day is before `day` (YYYY-MM-DD), at most `limit` of them. */
  expired(day: string, limit: number): Promise<string[]>;
  /** The pinned bytes for a content id, or null if they are gone. */
  fetch(cid: string): Promise<Uint8Array | null>;
  /** Unpins a content id. Already gone is not an error. */
  unpin(cid: string): Promise<void>;
}

export type PinataOptions = {
  /** The Pinata API key (a JWT). Read from `PINATA_JWT`; never logged. */
  jwt: string;
  /** Gateway host for reads, e.g. a dedicated `*.mypinata.cloud`. Default: the public gateway. */
  gateway?: string;
  /** Injected for tests. */
  fetch?: typeof globalThis.fetch;
};

const API = "https://api.pinata.cloud";
/** The metadata key a pin's keep-until day is stored under. */
export const KEEP_UNTIL_KEY = "keepUntil";
const NAME = /^[0-9a-f]{64}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const DEFAULT_GATEWAY = "gateway.pinata.cloud";
const TIMEOUT_MS = 30_000;

export class PinStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PinStoreError";
  }
}

/** A `PinStore` over Pinata's pinning API and an IPFS gateway. */
export function pinataStore(options: PinataOptions): PinStore {
  const f = options.fetch ?? globalThis.fetch;
  const gateway = (options.gateway ?? DEFAULT_GATEWAY).replace(/^https?:\/\//, "").replace(/\/+$/, "");
  const auth = { Authorization: `Bearer ${options.jwt}` };
  const call = (url: string, init: RequestInit = {}) =>
    f(url, { ...init, headers: { ...auth, ...(init.headers ?? {}) }, signal: AbortSignal.timeout(TIMEOUT_MS) });

  return {
    async find(name) {
      const url = `${API}/data/pinList?status=pinned&pageLimit=10&metadata[name]=${encodeURIComponent(name)}`;
      const res = await call(url);
      if (!res.ok) throw new PinStoreError(`pin list failed (${res.status})`);
      const data = (await res.json()) as { rows?: Array<{ ipfs_pin_hash?: string; metadata?: { name?: string } }> };
      // The name filter is not guaranteed exact: match it ourselves.
      const row = (data.rows ?? []).find((r) => r.metadata?.name === name && typeof r.ipfs_pin_hash === "string");
      return row?.ipfs_pin_hash ?? null;
    },

    async pin(name, bytes, keepUntil) {
      const form = new FormData();
      form.append("file", new Blob([new Uint8Array(bytes)], { type: "application/octet-stream" }), name);
      form.append("pinataMetadata", JSON.stringify(keepUntil ? { name, keyvalues: { [KEEP_UNTIL_KEY]: keepUntil } } : { name }));
      form.append("pinataOptions", JSON.stringify({ cidVersion: 1 }));
      const res = await call(`${API}/pinning/pinFileToIPFS`, { method: "POST", body: form });
      if (!res.ok) throw new PinStoreError(`pin failed (${res.status})`);
    },

    async expired(day, limit) {
      const query = JSON.stringify({ [KEEP_UNTIL_KEY]: { value: day, op: "lt" } });
      const url = `${API}/data/pinList?status=pinned&pageLimit=${Math.min(1000, Math.max(1, limit))}&metadata[keyvalues]=${encodeURIComponent(query)}`;
      const res = await call(url);
      if (!res.ok) throw new PinStoreError(`pin list failed (${res.status})`);
      const data = (await res.json()) as { rows?: Array<{ ipfs_pin_hash?: string; metadata?: { name?: string; keyvalues?: Record<string, unknown> | null } }> };
      // Checked again here: only mailbox pins (named by a lookup) whose own day has passed, whatever the filter returned.
      return (data.rows ?? [])
        .filter((r) => {
          const kept = r.metadata?.keyvalues?.[KEEP_UNTIL_KEY];
          return typeof r.ipfs_pin_hash === "string" && NAME.test(r.metadata?.name ?? "") && typeof kept === "string" && DAY.test(kept) && kept < day;
        })
        .slice(0, limit)
        .map((r) => r.ipfs_pin_hash as string);
    },

    async fetch(cid) {
      // Content-addressed: the gateway can only serve the bytes that were pinned.
      const res = await f(`https://${gateway}/ipfs/${encodeURIComponent(cid)}`, {
        cache: "no-store",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (res.status === 404) return null;
      if (!res.ok) throw new PinStoreError(`gateway read failed (${res.status})`);
      return new Uint8Array(await res.arrayBuffer());
    },

    async unpin(cid) {
      const res = await call(`${API}/pinning/unpin/${encodeURIComponent(cid)}`, { method: "DELETE" });
      // 404 and Pinata's 400 "not pinned" both mean it is already gone.
      if (res.ok || res.status === 404 || res.status === 400) return;
      throw new PinStoreError(`unpin failed (${res.status})`);
    },
  };
}
