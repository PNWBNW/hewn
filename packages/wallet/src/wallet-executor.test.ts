import { describe, expect, it } from "vitest";
import { PermanentError, TransientError, type WalletExecuteFn, executeAleoTransaction, executeAndConfirm } from "./wallet-executor";

const CALL = ["pnw_name_registrar_v5.aleo", "register_worker_name", ["1field", "2u128"]] as const;

/** An execute function that keeps exactly what it was handed. */
function recorder(result: string | Error = "shield_1") {
  const asked: unknown[] = [];
  const execute: WalletExecuteFn = async (params) => {
    asked.push(params);
    if (result instanceof Error) throw result;
    return result;
  };
  return { asked, execute };
}

describe("executeAleoTransaction", () => {
  it("executeAleoTransaction has no fee parameter", async () => {
    const { asked, execute } = recorder();
    // A fifth argument, as an older caller would have passed it, changes nothing: there is no fee to set.
    const loose = executeAleoTransaction as (...args: unknown[]) => Promise<string>;
    expect(await loose(execute, CALL[0], CALL[1], [...CALL[2]], 500_000)).toBe("shield_1");
    expect(await executeAleoTransaction(execute, CALL[0], CALL[1], [...CALL[2]])).toBe("shield_1");
    // The wallet is handed the program, the function and the inputs, and nothing else: the fee is Shield's own estimate.
    for (const params of asked) {
      expect(params).toEqual({ program: CALL[0], function: CALL[1], inputs: CALL[2] });
      expect(params).not.toHaveProperty("fee");
    }
    expect(asked).toHaveLength(2);
  });

  it("sorts what the wallet throws into what may be tried again and what may not", async () => {
    await expect(executeAleoTransaction(recorder(new Error("User rejected the request")).execute, CALL[0], CALL[1], [...CALL[2]])).rejects.toBeInstanceOf(PermanentError);
    await expect(executeAleoTransaction(recorder(new Error("network timeout")).execute, CALL[0], CALL[1], [...CALL[2]])).rejects.toBeInstanceOf(TransientError);
  });
});

describe("executeAndConfirm", () => {
  it("passes no fee either, and leaves a wallet's own id to the wallet's status", async () => {
    const { asked, execute } = recorder("shield_7");
    const seen: string[] = [];
    const result = await executeAndConfirm(execute, CALL[0], CALL[1], [...CALL[2]], (s) => seen.push(s));
    expect(asked).toEqual([{ program: CALL[0], function: CALL[1], inputs: CALL[2] }]);
    expect(asked[0]).not.toHaveProperty("fee");
    expect(result).toMatchObject({ txId: "shield_7", status: "pending" });
    expect(seen).toEqual(["pending"]);
  });
});
