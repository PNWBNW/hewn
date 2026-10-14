// @vitest-environment node
import { ENVELOPE_VERSION, MAX_ENVELOPE_BYTES } from "@pnw/mailbox";
import { describe, expect, it } from "vitest";
import { mailboxHandlers } from "./handlers";
import type { PinStore } from "./pinata";

const LOOKUP = "8a45f32884aa20563afb9535932161b51369dfddce1d952bc1e8f5341b14416e";
const URL_ = `http://books.local/api/mailbox/${LOOKUP}`;

/** An in-memory pin store that records every call. */
function fakeStore(initial: Record<string, Uint8Array> = {}) {
  const pins = new Map<string, Uint8Array>(Object.entries(initial));
  const calls: string[] = [];
  const cidOf = (name: string) => `cid-${name.slice(0, 8)}`;
  const store: PinStore = {
    async find(name) {
      calls.push(`find ${name}`);
      return pins.has(name) ? cidOf(name) : null;
    },
    async pin(name, bytes) {
      calls.push(`pin ${name} ${bytes.length}`);
      pins.set(name, bytes);
    },
    async fetch(cid) {
      calls.push(`fetch ${cid}`);
      for (const [name, bytes] of pins) if (cidOf(name) === cid) return bytes;
      return null;
    },
    async unpin(cid) {
      calls.push(`unpin ${cid}`);
      for (const name of [...pins.keys()]) if (cidOf(name) === cid) pins.delete(name);
    },
  };
  return { store, pins, calls };
}

const envelope = (n = 40) => {
  const bytes = new Uint8Array(n).map((_, i) => (i * 13) & 0xff);
  bytes[0] = ENVELOPE_VERSION;
  return bytes;
};

const post = (body: BodyInit | null, headers: Record<string, string> = { "Content-Type": "application/octet-stream" }) =>
  new Request(URL_, { method: "POST", body, headers });

describe("mailbox function", () => {
  it("answers 503 to everything when there is no pinning key", async () => {
    const h = mailboxHandlers(null);
    for (const res of [
      await h.POST(post(envelope()), LOOKUP),
      await h.GET(new Request(URL_), LOOKUP),
      await h.DELETE(new Request(URL_, { method: "DELETE" }), LOOKUP),
    ]) {
      expect(res.status).toBe(503);
      expect(res.headers.get("content-type")).toContain("application/json");
      expect(await res.json()).toEqual({ error: "mailbox not configured" });
    }
  });

  it("answers 400 to a lookup that is not 64 lower-case hex", async () => {
    const { store, calls } = fakeStore();
    const h = mailboxHandlers(store);
    for (const bad of ["", "abc", LOOKUP.toUpperCase(), LOOKUP + "0", LOOKUP.slice(1), "../etc/passwd"]) {
      expect((await h.POST(post(envelope()), bad)).status).toBe(400);
      expect((await h.GET(new Request(URL_), bad)).status).toBe(400);
      expect((await h.DELETE(new Request(URL_, { method: "DELETE" }), bad)).status).toBe(400);
    }
    expect(calls).toEqual([]);
  });

  describe("POST", () => {
    it("pins an envelope under its lookup and answers 204", async () => {
      const { store, pins, calls } = fakeStore();
      const res = await mailboxHandlers(store).POST(post(envelope()), LOOKUP);
      expect(res.status).toBe(204);
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(res.headers.get("access-control-allow-origin")).toBeNull();
      expect(pins.get(LOOKUP)).toEqual(envelope());
      expect(calls).toEqual([`find ${LOOKUP}`, `pin ${LOOKUP} 40`]);
    });

    it("answers 409 when the slot is already taken, and pins nothing", async () => {
      const { store, calls } = fakeStore({ [LOOKUP]: envelope() });
      const res = await mailboxHandlers(store).POST(post(envelope(50)), LOOKUP);
      expect(res.status).toBe(409);
      expect(calls).toEqual([`find ${LOOKUP}`]);
    });

    it("answers 415 unless the body is application/octet-stream", async () => {
      const { store, calls } = fakeStore();
      const h = mailboxHandlers(store);
      expect((await h.POST(post(envelope(), { "Content-Type": "application/json" }), LOOKUP)).status).toBe(415);
      expect((await h.POST(post(envelope(), {}), LOOKUP)).status).toBe(415);
      expect((await h.POST(post(envelope(), { "Content-Type": "application/octet-stream; charset=x" }), LOOKUP)).status).toBe(204);
      expect(calls).toHaveLength(2);
    });

    it("answers 400 unless the first byte is the envelope version", async () => {
      const { store, calls } = fakeStore();
      const h = mailboxHandlers(store);
      const wrong = envelope();
      wrong[0] = 0x02;
      expect((await h.POST(post(wrong), LOOKUP)).status).toBe(400);
      expect((await h.POST(post(new TextEncoder().encode('{"hello":"world"}')), LOOKUP)).status).toBe(400);
      expect((await h.POST(post(new Uint8Array([ENVELOPE_VERSION, 1, 2])), LOOKUP)).status).toBe(400); // too short
      expect((await h.POST(post(null), LOOKUP)).status).toBe(400);
      expect(calls).toEqual([]);
    });

    it("answers 413 over the size cap, by declared length or by actual bytes", async () => {
      const { store, calls } = fakeStore();
      const h = mailboxHandlers(store);
      const declared = post(envelope(), { "Content-Type": "application/octet-stream", "Content-Length": String(MAX_ENVELOPE_BYTES + 1) });
      expect((await h.POST(declared, LOOKUP)).status).toBe(413);
      const stream = new ReadableStream<Uint8Array>({
        start(c) {
          c.enqueue(envelope(MAX_ENVELOPE_BYTES));
          c.enqueue(new Uint8Array(1));
          c.close();
        },
      });
      const streamed = new Request(URL_, {
        method: "POST",
        body: stream,
        headers: { "Content-Type": "application/octet-stream" },
        // @ts-expect-error Node needs this for a streaming body
        duplex: "half",
      });
      expect((await h.POST(streamed, LOOKUP)).status).toBe(413);
      expect((await h.POST(post(envelope(MAX_ENVELOPE_BYTES)), LOOKUP)).status).toBe(204);
      expect(calls).toEqual([`find ${LOOKUP}`, `pin ${LOOKUP} ${MAX_ENVELOPE_BYTES}`]);
    });
  });

  describe("GET", () => {
    it("streams the pinned bytes with no caching", async () => {
      const { store } = fakeStore({ [LOOKUP]: envelope() });
      const res = await mailboxHandlers(store).GET(new Request(URL_), LOOKUP);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("application/octet-stream");
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(res.headers.get("content-length")).toBe("40");
      expect(res.headers.get("access-control-allow-origin")).toBeNull();
      expect(new Uint8Array(await res.arrayBuffer())).toEqual(envelope());
    });

    it("answers 404 when nothing is there", async () => {
      const { store } = fakeStore();
      const res = await mailboxHandlers(store).GET(new Request(URL_), LOOKUP);
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: "nothing here" });
    });

    it("answers 404 when the pin is named but its bytes are gone", async () => {
      const { store } = fakeStore({ [LOOKUP]: envelope() });
      store.fetch = async () => null;
      expect((await mailboxHandlers(store).GET(new Request(URL_), LOOKUP)).status).toBe(404);
    });
  });

  describe("DELETE", () => {
    it("unpins and answers 204, and 204 again when it is already gone", async () => {
      const { store, pins, calls } = fakeStore({ [LOOKUP]: envelope() });
      const h = mailboxHandlers(store);
      expect((await h.DELETE(new Request(URL_, { method: "DELETE" }), LOOKUP)).status).toBe(204);
      expect(pins.size).toBe(0);
      expect((await h.DELETE(new Request(URL_, { method: "DELETE" }), LOOKUP)).status).toBe(204);
      expect(calls).toEqual([`find ${LOOKUP}`, `unpin cid-${LOOKUP.slice(0, 8)}`, `find ${LOOKUP}`]);
    });
  });

  it("answers 502 when the pinning service fails, without details", async () => {
    const { store } = fakeStore();
    store.find = async () => {
      throw new Error("Bearer secret leaked?");
    };
    const h = mailboxHandlers(store);
    for (const res of [
      await h.POST(post(envelope()), LOOKUP),
      await h.GET(new Request(URL_), LOOKUP),
      await h.DELETE(new Request(URL_, { method: "DELETE" }), LOOKUP),
    ]) {
      expect(res.status).toBe(502);
      expect(await res.text()).toBe(JSON.stringify({ error: "mailbox unavailable" }));
    }
  });
});
