import { describe, expect, it } from "vitest";
import { type WorkWallet, executeAndWait } from "./execute";

type Sent = { program: string; function: string; inputs: string[]; fee?: number; privateFee: false };

function fakeWallet(statuses: ({ status: string; transactionId?: string; error?: string } | Error)[], result: { transactionId: string } | null = { transactionId: "shield_1" }) {
  const sent: Sent[] = [];
  const asked: string[] = [];
  let i = 0;
  const wallet: WorkWallet = {
    async executeTransaction(opts) {
      sent.push(opts);
      return result;
    },
    async transactionStatus(id) {
      asked.push(id);
      const s = statuses[Math.min(i++, statuses.length - 1)]!;
      if (s instanceof Error) throw s;
      return s;
    },
  };
  return { wallet, sent, asked };
}

const fast = { sleep: async () => {}, pollMs: 1 };
const CALL = { program: "pnw_name_registrar_v5.aleo", function: "register_worker_name", inputs: ["1field", "2u128"] };

describe("executeAndWait", () => {
  it("sends the call with privateFee false and no fee of its own, then waits for accepted", async () => {
    const { wallet, sent, asked } = fakeWallet([{ status: "pending" }, { status: "proving" }, { status: "accepted", transactionId: "at1" + "x".repeat(58) }]);
    const done = await executeAndWait(wallet, CALL, fast);
    expect(sent).toEqual([{ program: CALL.program, function: CALL.function, inputs: CALL.inputs, privateFee: false }]);
    expect(sent[0]).not.toHaveProperty("fee");
    expect(asked).toEqual(["shield_1", "shield_1", "shield_1"]);
    expect(done).toEqual({ transactionId: "at1" + "x".repeat(58) });
  });

  it("falls back to the wallet's id when no on-chain id is reported", async () => {
    const { wallet } = fakeWallet([{ status: "finalized" }]);
    expect(await executeAndWait(wallet, CALL, fast)).toEqual({ transactionId: "shield_1" });
  });

  it("fails when Shield refuses, reports a rejection, or doesn't answer in time", async () => {
    await expect(executeAndWait(fakeWallet([], null).wallet, CALL, fast)).rejects.toThrow(/didn't take/);
    await expect(executeAndWait(fakeWallet([{ status: "rejected", error: "insufficient balance" }]).wallet, CALL, fast)).rejects.toThrow(/insufficient balance/);
    await expect(executeAndWait(fakeWallet([{ status: "failed" }]).wallet, CALL, fast)).rejects.toThrow(/failed/);
    let t = 0;
    const slow = fakeWallet([new Error("not yet"), { status: "pending" }]);
    await expect(executeAndWait(slow.wallet, CALL, { ...fast, capMs: 10, now: () => (t += 4) })).rejects.toThrow(/in time/);
    expect(slow.asked.length).toBeGreaterThan(0);
  });

  it("keeps asking while the wallet doesn't know the id yet", async () => {
    const { wallet, asked } = fakeWallet([new Error("unknown"), new Error("unknown"), { status: "completed" }]);
    await executeAndWait(wallet, CALL, fast);
    expect(asked).toHaveLength(3);
  });
});
