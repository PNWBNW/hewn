// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { DELETE, GET, POST } from "./[lookup]/route";

const LOOKUP = "8a45f32884aa20563afb9535932161b51369dfddce1d952bc1e8f5341b14416e";
const context = (lookup: string) => ({ params: Promise.resolve({ lookup }) });
const url = (lookup: string) => `http://books.local/api/mailbox/${lookup}`;

const saved = process.env.PINATA_JWT;
afterEach(() => {
  if (saved === undefined) delete process.env.PINATA_JWT;
  else process.env.PINATA_JWT = saved;
});

describe("mailbox route", () => {
  it("answers 503 JSON on every method when PINATA_JWT is unset", async () => {
    delete process.env.PINATA_JWT;
    const responses = [
      await POST(new Request(url(LOOKUP), { method: "POST", body: new Uint8Array([1]), headers: { "Content-Type": "application/octet-stream" } }), context(LOOKUP)),
      await GET(new Request(url(LOOKUP)), context(LOOKUP)),
      await DELETE(new Request(url(LOOKUP), { method: "DELETE" }), context(LOOKUP)),
    ];
    for (const res of responses) {
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({ error: "mailbox not configured" });
    }
  });

  it("answers 400 to a bad lookup before touching the pinning service", async () => {
    process.env.PINATA_JWT = "set-but-never-used";
    const res = await GET(new Request(url("nope")), context("nope"));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "bad lookup" });
  });
});
