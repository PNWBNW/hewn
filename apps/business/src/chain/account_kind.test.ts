import { describe, expect, it } from "vitest";
import { type MappingRead, assertKindFree, kindConflict, registryRead } from "./account_kind";

const ADDR = "aleo1" + "q".repeat(58);
const holding = (mappings: Record<string, string>): MappingRead => async (mapping) => mappings[mapping] ?? null;

describe("one kind of account per Shield account", () => {
  it("lets a business link a wallet with no worker name, and refuses one that has it", async () => {
    expect(await kindConflict("business", ADDR, holding({}))).toBeNull();
    expect(await kindConflict("business", ADDR, holding({ employer_primary_name_of: "1field" }))).toBeNull(); // its own kind is fine
    expect(await kindConflict("business", ADDR, holding({ worker_primary_name_of: "7field" }))).toMatch(/already holds a worker's name.*same username/);
  });

  it("does the same for a worker and a business's name", async () => {
    expect(await kindConflict("worker", ADDR, holding({ worker_primary_name_of: "7field" }))).toBeNull();
    await expect(assertKindFree("worker", ADDR, holding({ employer_primary_name_of: "1field" }))).rejects.toThrow(/already holds a business's name/);
  });

  it("refuses when the registry can't be read, rather than letting it through", async () => {
    const down = registryRead("https://example.test", (async () => {
      throw new TypeError("offline");
    }) as unknown as typeof fetch);
    await expect(kindConflict("business", ADDR, down)).rejects.toThrow(/Couldn't reach the registry/);
    const failing = registryRead("https://example.test", (async () => new Response("", { status: 500 })) as unknown as typeof fetch);
    await expect(kindConflict("business", ADDR, failing)).rejects.toThrow(/answered 500/);
  });

  it("reads a missing entry, null or 0field as no name, and asks the right mapping", async () => {
    const urls: string[] = [];
    const answer = (status: number, body: string) =>
      registryRead("https://example.test/v2/testnet", (async (url: string) => (urls.push(url), new Response(body, { status }))) as unknown as typeof fetch);
    expect(await answer(404, "")("worker_primary_name_of", ADDR)).toBeNull();
    expect(await answer(200, "null")("worker_primary_name_of", ADDR)).toBeNull();
    expect(await answer(200, '"0field"')("worker_primary_name_of", ADDR)).toBeNull();
    expect(await answer(200, '"123field.public"')("worker_primary_name_of", ADDR)).toBe("123field");
    expect(urls[0]).toMatch(/^https:\/\/example\.test\/v2\/testnet\/program\/[a-z0-9_]+\.aleo\/mapping\/worker_primary_name_of\/aleo1q+$/);
  });
});
