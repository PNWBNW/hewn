import { describe, expect, it } from "vitest";
import { MailboxClient } from "./client";
import { MailboxError } from "./envelope";

const LOOKUP = "8a45f32884aa20563afb9535932161b51369dfddce1d952bc1e8f5341b14416e";

type Call = { url: string; init: RequestInit };

function fakeFetch(respond: (call: Call) => Response) {
  const calls: Call[] = [];
  const fetch = async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return respond({ url, init });
  };
  return { calls, fetch };
}

async function failsWith(p: Promise<unknown>, code: MailboxError["code"]) {
  await expect(p).rejects.toBeInstanceOf(MailboxError);
  await expect(p).rejects.toMatchObject({ code });
}

describe("MailboxClient", () => {
  it("puts an envelope as octet-stream to <base>/<lookup>", async () => {
    const { calls, fetch } = fakeFetch(() => new Response(null, { status: 204 }));
    const client = new MailboxClient({ fetch });
    await client.put(LOOKUP, new Uint8Array([1, 2, 3]));
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(`/api/mailbox/${LOOKUP}`);
    expect(calls[0]!.init.method).toBe("POST");
    expect(calls[0]!.init.headers).toEqual({ "Content-Type": "application/octet-stream" });
    expect(new Uint8Array(calls[0]!.init.body as Uint8Array)).toEqual(new Uint8Array([1, 2, 3]));
    expect(calls[0]!.init.cache).toBe("no-store");
    expect(calls[0]!.init.credentials).toBe("same-origin");
  });

  it("honours a custom base url, with or without a trailing slash", async () => {
    const { calls, fetch } = fakeFetch(() => new Response(null, { status: 204 }));
    await new MailboxClient({ fetch, baseUrl: "https://books.example/api/mailbox/" }).drop(LOOKUP);
    expect(calls[0]!.url).toBe(`https://books.example/api/mailbox/${LOOKUP}`);
  });

  it("gets the bytes, and null on 404", async () => {
    const { fetch } = fakeFetch(({ url }) =>
      url.endsWith(LOOKUP) ? new Response(new Uint8Array([9, 8]), { status: 200 }) : new Response(null, { status: 404 }),
    );
    const client = new MailboxClient({ fetch });
    expect(await client.get(LOOKUP)).toEqual(new Uint8Array([9, 8]));
    expect(await client.get("f".repeat(64))).toBeNull();
  });

  it("drops, and treats an already-gone envelope as done", async () => {
    const { calls, fetch } = fakeFetch(() => new Response(null, { status: 404 }));
    await new MailboxClient({ fetch }).drop(LOOKUP);
    expect(calls[0]!.init.method).toBe("DELETE");
  });

  it("validates the lookup before any request", async () => {
    const { calls, fetch } = fakeFetch(() => new Response(null, { status: 204 }));
    const client = new MailboxClient({ fetch });
    for (const bad of ["", "abc", LOOKUP.toUpperCase(), LOOKUP + "0", LOOKUP.slice(1), "../" + LOOKUP.slice(3)]) {
      await failsWith(client.put(bad, new Uint8Array(1)), "BAD_LOOKUP");
      await failsWith(client.get(bad), "BAD_LOOKUP");
      await failsWith(client.drop(bad), "BAD_LOOKUP");
    }
    expect(calls).toHaveLength(0);
  });

  it("maps 503 to NOT_CONFIGURED, 409 to CONFLICT, anything else to REQUEST_FAILED", async () => {
    const status = (s: number) => new MailboxClient({ fetch: fakeFetch(() => new Response(null, { status: s })).fetch });
    await failsWith(status(503).put(LOOKUP, new Uint8Array(1)), "NOT_CONFIGURED");
    await failsWith(status(503).get(LOOKUP), "NOT_CONFIGURED");
    await failsWith(status(409).put(LOOKUP, new Uint8Array(1)), "CONFLICT");
    await failsWith(status(500).get(LOOKUP), "REQUEST_FAILED");
    await failsWith(status(502).drop(LOOKUP), "REQUEST_FAILED");
    await failsWith(status(400).put(LOOKUP, new Uint8Array(1)), "REQUEST_FAILED");
  });
});
