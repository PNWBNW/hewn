import { describe, expect, it } from "vitest";
import { type ChainReads, anchorHeight, chainChecks, explorerReads, rootKey } from "./period_check";

// The root anchored by the first end-to-end payroll on testnet (2026-04-10): read from the
// explorer while writing this, `audit_event_height` gives block 15682094.
const APRIL_ROOT = "f0cb5d43137658d098270fd7153efe597df8430684c9a13ee33d18db38f964d3";
const TX = `at1${"q".repeat(58)}`;

describe("the anchor's key", () => {
  it("is the root's 32 bytes as a u8 array, encoded for the path", () => {
    const bytes = decodeURIComponent(rootKey(APRIL_ROOT)).split(",");
    expect(bytes).toHaveLength(32);
    expect(bytes.slice(0, 4)).toEqual(["[240u8", "203u8", "93u8", "67u8"]);
    expect(bytes.at(-1)).toBe("211u8]");
    expect(rootKey(APRIL_ROOT)).not.toContain(" ");
    expect(() => rootKey("nope")).toThrow();
  });

  it("reads the height, null when never anchored", async () => {
    const seen: string[] = [];
    const read = async (program: string, mapping: string, key: string) => {
      seen.push(`${program}/${mapping}`);
      return key === rootKey(APRIL_ROOT) ? "15682094u32" : null;
    };
    expect(await anchorHeight(APRIL_ROOT, read)).toBe(15682094);
    expect(await anchorHeight("00".repeat(32), read)).toBeNull();
    expect(seen[0]).toMatch(/payroll_audit_log.*\/audit_event_height$/);
    await expect(anchorHeight(APRIL_ROOT, async () => ({ odd: true }))).rejects.toThrow(/unexpected shape/);
  });
});

describe("the explorer reads", () => {
  it("asks for the mapping, the block and the transaction at the configured endpoint", async () => {
    const urls: string[] = [];
    const fake = (async (url: string) => {
      urls.push(url);
      if (url.includes("/mapping/")) return new Response(JSON.stringify("15682094u32"));
      if (url.endsWith("/block/15682094")) return new Response(JSON.stringify({ header: { metadata: { timestamp: 1775795900 } } }));
      if (url.endsWith(`/transaction/${TX}`)) return new Response("{}");
      return new Response("", { status: 404 });
    }) as typeof fetch;
    const reads = explorerReads("https://example.test/v2/testnet/", fake);
    expect(await reads.anchor(APRIL_ROOT)).toBe(15682094);
    expect((await reads.blockTime(15682094))?.toISOString()).toBe("2026-04-10T04:38:20.000Z");
    expect(await reads.txExists(TX)).toBe(true);
    expect(await reads.txExists(`at1${"x".repeat(58)}`)).toBe(false);
    expect(urls[0]).toBe(`https://example.test/v2/testnet/program/payroll_audit_log.aleo/mapping/audit_event_height/${rootKey(APRIL_ROOT)}`);
  });
});

const reads = (over: Partial<ChainReads> = {}): ChainReads => ({
  anchor: async () => 20_000_000,
  blockTime: async () => new Date("2026-11-03T18:00:00Z"),
  txExists: async () => true,
  ...over,
});
const proof = (settlements: { txId: string }[] = [{ txId: TX }]) => ({ end: "2026-10-31", settlements: settlements.map((s) => ({ ...s, entryHash: "1".repeat(64), recipient: "aleo1x", entrySalt: "", settleSalt: "" })) });

describe("the chain checks", () => {
  it("pass for a root anchored after the range, with its payments on chain", async () => {
    const c = await chainChecks(proof(), "ab".repeat(32), reads());
    expect(c.map((x) => [x.id, x.ok])).toEqual([["anchored", true], ["after", true], ["payments", true]]);
    expect(c[0]!.height).toBe(20_000_000);
  });

  it("fail, and stop, when the root was never anchored", async () => {
    const c = await chainChecks(proof(), "ab".repeat(32), reads({ anchor: async () => null }));
    expect(c).toEqual([expect.objectContaining({ id: "anchored", ok: false })]);
  });

  it("fail when the anchor came before the range ended", async () => {
    const c = await chainChecks(proof(), "ab".repeat(32), reads({ blockTime: async () => new Date("2026-10-30T12:00:00Z") }));
    expect(c.find((x) => x.id === "after")).toMatchObject({ ok: false, detail: expect.stringContaining("before the range ended") });
  });

  it("fail when a payment's transaction isn't on chain, or isn't a transaction id", async () => {
    const missing = await chainChecks(proof(), "ab".repeat(32), reads({ txExists: async () => false }));
    expect(missing.find((x) => x.id === "payments")).toMatchObject({ ok: false, detail: expect.stringContaining("not found") });
    const odd = await chainChecks(proof([{ txId: "shield_123" }]), "ab".repeat(32), reads());
    expect(odd.find((x) => x.id === "payments")).toMatchObject({ ok: false, detail: expect.stringContaining("not a transaction id") });
  });

  it("leave the payments line out of a range with no payments", async () => {
    const c = await chainChecks(proof([]), "ab".repeat(32), reads());
    expect(c.map((x) => x.id)).toEqual(["anchored", "after"]);
  });
});
