import { afterEach, describe, expect, it, vi } from "vitest";
import { computeNameHash, nameMatchesHash, queryNamePlaintext } from "./name_registry";

/** A name as the registrar stores it: its bytes, big-endian, as a u128. */
const encoded = (name: string) => `${[...new TextEncoder().encode(name)].reduce((v, b) => (v << 8n) | BigInt(b), 0n)}u128`;

describe("a registered name's text", () => {
  it("counts only when it hashes back to the hash it's filed under, and is a plain name", () => {
    const dayco = computeNameHash("dayco");
    expect(nameMatchesHash("dayco", dayco)).toBe(true);
    expect(nameMatchesHash("dayco", `${dayco}field`)).toBe(true);
    expect(nameMatchesHash("acme", dayco)).toBe(false); // "acme" filed against someone else's hash
    expect(nameMatchesHash("Dayco", computeNameHash("Dayco"))).toBe(false); // not a plain name
    expect(nameMatchesHash("аcme", computeNameHash("аcme"))).toBe(false); // a Cyrillic look-alike, even with its own hash
    expect(nameMatchesHash("dayco", "not a field")).toBe(false);
  });
});

describe("reading a name from the registrar", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("returns the text only when it's the name the hash was made from", async () => {
    const answer = (text: string) => vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(encoded(text)), { status: 200 })));
    answer("acme");
    expect(await queryNamePlaintext(computeNameHash("acme"))).toBe("acme");
    answer("acme");
    expect(await queryNamePlaintext(computeNameHash("scam123"))).toBeNull(); // someone posing as acme
  });
});
