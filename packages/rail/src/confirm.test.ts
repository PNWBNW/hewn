import { describe, expect, it } from "vitest";
import { confirmTransaction, parseFeeMicrocredits, parseHeight, parseRejected } from "./confirm";
import fixture from "./fixtures/transaction.json";
import { type RailNetwork, RailNetworkError } from "./types";

const ID = "at1yphn8n9zejqnnsktuev7rl9vkv8styq00rjpffa0h7rxnccssyyqdk9ltw";

function network(routes: Record<string, unknown>): RailNetwork & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async fetchJson(path) {
      calls.push(path);
      if (!(path in routes)) throw new RailNetworkError("not found", 404);
      const v = routes[path];
      if (v instanceof Error) throw v;
      return v;
    },
  };
}

describe("fee parsing", () => {
  it("reads base + priority fee from the fee transition's u64 inputs", () => {
    expect(parseFeeMicrocredits(fixture)).toBe(51_580n);
  });

  it("adds a priority fee when there is one, and ignores the id field", () => {
    const doc = structuredClone(fixture) as typeof fixture;
    doc.fee.transition.inputs[1]!.value = "2500u64";
    expect(parseFeeMicrocredits(doc)).toBe(54_080n);
  });

  it("finds the transaction when the explorer wraps it", () => {
    expect(parseFeeMicrocredits({ status: "accepted", transaction: fixture })).toBe(51_580n);
  });

  it("handles fee_private (a record input and two public u64s)", () => {
    const doc = {
      id: ID,
      fee: { transition: { program: "credits.aleo", function: "fee_private", inputs: [{ type: "record", id: "x", tag: "y" }, { type: "public", value: "40000u64" }, { type: "public", value: "0u64" }, { type: "public", value: "1field" }] } },
    };
    expect(parseFeeMicrocredits(doc)).toBe(40_000n);
  });

  it("is undefined when there is no fee transition or no amounts in it", () => {
    expect(parseFeeMicrocredits({ id: ID, execution: {} })).toBeUndefined();
    expect(parseFeeMicrocredits({ id: ID, fee: { transition: { program: "credits.aleo", inputs: [] } } })).toBeUndefined();
    expect(parseFeeMicrocredits(null)).toBeUndefined();
    expect(parseFeeMicrocredits("nope")).toBeUndefined();
  });
});

describe("height and rejection", () => {
  it("accepts the height under the names seen in the wild", () => {
    expect(parseHeight({ block_height: 1234 })).toBe(1234);
    expect(parseHeight({ blockHeight: "77" })).toBe(77);
    expect(parseHeight({ height: 5 })).toBe(5);
    expect(parseHeight({ block: { height: 9 } })).toBe(9);
    expect(parseHeight({ header: { metadata: { height: 42 } } })).toBe(42);
    expect(parseHeight(fixture)).toBeUndefined();
    expect(parseHeight({ block_height: -1 })).toBeUndefined();
  });

  it("spots a rejected transaction", () => {
    expect(parseRejected({ status: "rejected", error: "insufficient balance" })).toBe("insufficient balance");
    expect(parseRejected({ type: "aborted" })).toMatch(/rejected/);
    expect(parseRejected(fixture)).toBeNull();
  });
});

describe("confirmTransaction", () => {
  it("returns fee and height straight from the transaction when present", async () => {
    const n = network({ [`transaction/${ID}`]: { ...fixture, block_height: 3_210_000 } });
    expect(await confirmTransaction(n, ID)).toEqual({ transactionId: ID, feeMicrocredits: 51_580n, height: 3_210_000 });
    expect(n.calls).toEqual([`transaction/${ID}`]);
  });

  it("looks the height up by block hash when the transaction doesn't carry it", async () => {
    const n = network({
      [`transaction/${ID}`]: fixture,
      [`find/blockHash/${ID}`]: "ab1blockhash",
      "block/ab1blockhash": { header: { metadata: { height: 3_210_001 } } },
    });
    expect(await confirmTransaction(n, ID)).toEqual({ transactionId: ID, feeMicrocredits: 51_580n, height: 3_210_001 });
  });

  it("settles without a height when the lookup fails, and resolves null while unindexed", async () => {
    expect(await confirmTransaction(network({ [`transaction/${ID}`]: fixture }), ID)).toEqual({ transactionId: ID, feeMicrocredits: 51_580n });
    expect(await confirmTransaction(network({}), ID)).toBeNull();
    expect(await confirmTransaction(network({ [`transaction/${ID}`]: { message: "pending" } }), ID)).toBeNull();
  });

  it("throws when the explorer reports a rejection, and passes other network errors through", async () => {
    await expect(confirmTransaction(network({ [`transaction/${ID}`]: { status: "rejected", transaction: fixture } }), ID)).rejects.toThrow(/rejected/);
    await expect(confirmTransaction(network({ [`transaction/${ID}`]: new RailNetworkError("down", 503) }), ID)).rejects.toThrow(/down/);
  });
});
