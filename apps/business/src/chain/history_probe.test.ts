import { describe, expect, it } from "vitest";
import { CREDITS_PROGRAM, USDCX_PROGRAM } from "./balances";
import { type ProbeDeps, dateOf, newestFirst, reportText, runProbe, summariseOpened, transactionIdOf, transitionsOf } from "./history_probe";

const OWNER = "aleo1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqsx3wr5q";
const tx = (n: number) => `at1${String(n).padStart(58, "x")}`;

const transferDoc = {
  type: "execute",
  execution: {
    transitions: [{ program: USDCX_PROGRAM, function: "transfer_private", inputs: [{ type: "private", value: "ciphertext1abc" }], outputs: [{ type: "record", value: "record1abc" }] }],
  },
  fee: { transition: { program: "credits.aleo", function: "fee_public", inputs: [{ type: "public", value: "1000u64" }], outputs: [] } },
};

function fakeDeps(over: Partial<ProbeDeps["wallet"]> = {}): ProbeDeps & { opened: string[] } {
  const opened: string[] = [];
  return {
    opened,
    wallet: {
      requestRecords: async (program) =>
        program === USDCX_PROGRAM
          ? [
              { recordName: "Token", spent: true, transactionId: tx(1), recordPlaintext: `{ owner: ${OWNER}.private, amount: 5u128.private }` },
              { recordName: "Token", spent: false, transactionId: tx(9), recordPlaintext: `{ owner: ${OWNER}.private, amount: 7u128.private }` },
            ]
          : [{ recordName: "credits", spent: false }],
      requestTransactionHistory: async (program) => ({
        transactions:
          program === USDCX_PROGRAM
            ? [
                { id: "w1", transactionId: tx(1), blockNumber: 100, blockTimestamp: 1_760_400_000, functionId: "mint_public", transactionStatus: "Accepted" },
                { id: "w2", transactionId: tx(2), blockNumber: 200, blockTimestamp: 1_760_500_000, functionId: "transfer_public", transactionStatus: "Accepted" },
              ]
            : [],
      }),
      transitionViewKeys: async (id) => (id === tx(9) ? [] : ["1field", "2field"]),
      ...over,
    },
    fetchTransaction: async () => transferDoc,
    open: async (t, tvk) => {
      opened.push(tvk);
      if (tvk === "1field") throw new Error("wrong key");
      return { inputs: 1, inputsRead: 1, outputs: 1, outputsRead: 0, amountFound: (t as { function: string }).function === "transfer_private" };
    },
  };
}

describe("history probe", () => {
  it("counts records and history per program, and finds received payments the history leaves out", async () => {
    const r = await runProbe(fakeDeps());
    expect(r.records[USDCX_PROGRAM]).toEqual({
      ok: true,
      value: { count: 2, spent: 1, fields: ["recordName", "recordPlaintext", "spent", "transactionId"], withTransactionId: 2 },
    });
    expect(r.history[USDCX_PROGRAM]).toEqual({
      ok: true,
      value: {
        count: 2,
        fields: ["blockNumber", "blockTimestamp", "functionId", "id", "transactionId", "transactionStatus"],
        newest: [
          { date: "2025-10-15", fn: "transfer_public", status: "Accepted" },
          { date: "2025-10-14", fn: "mint_public", status: "Accepted" },
        ],
      },
    });
    expect(r.history[CREDITS_PROGRAM]).toEqual({ ok: true, value: { count: 0, fields: [], newest: [] } });
    expect(r.recordsNotInHistory).toBe(1);
  });

  it("opens the newest sent transfers first, then one received, trying each view key in turn", async () => {
    const deps = fakeDeps();
    const seen: string[] = [];
    const fetchTransaction = deps.fetchTransaction;
    deps.fetchTransaction = async (id) => (seen.push(id), fetchTransaction(id));
    const r = await runProbe(deps);
    expect(r.samples.map((s) => s.from)).toEqual(["history", "history", "record"]);
    expect(seen).toEqual([tx(2), tx(1), tx(9)]);
    expect(r.samples[0]!.viewKeys).toEqual({ ok: true, value: 2 });
    expect(r.samples[0]!.explorer).toEqual({ ok: true, value: { transitions: [`${USDCX_PROGRAM}/transfer_private`, "credits.aleo/fee_public"] } });
    expect(r.samples[0]!.opened[0]!.result).toEqual({ ok: true, value: { inputs: 1, inputsRead: 1, outputs: 1, outputsRead: 0, amountFound: true } });
    expect(deps.opened.slice(0, 2)).toEqual(["1field", "2field"]);
    expect(r.samples[2]!.opened[0]!.result).toEqual({ ok: false, error: "no view keys" });
  });

  it("reports a failing wallet call instead of stopping", async () => {
    const r = await runProbe(
      fakeDeps({
        requestTransactionHistory: async () => {
          throw new Error("not supported");
        },
      }),
    );
    expect(r.history[USDCX_PROGRAM]).toEqual({ ok: false, error: "not supported" });
    expect(r.recordsNotInHistory).toBeNull();
    expect(r.samples).toHaveLength(1);
  });

  it("writes a report with no address, amount or transaction id in it", async () => {
    const text = reportText(await runProbe(fakeDeps()), "2026-10-15");
    expect(text).toContain("Shield history check, 2026-10-15");
    expect(text).toContain("records: 2 (1 spent, 2 with a transaction id)");
    expect(text).toContain("Received but not in history: 1");
    expect(text).toContain("inputs 1/1 read, outputs 0/1 read, amount readable");
    expect(text).toContain("    2025-10-15 transfer_public (Accepted)\n    2025-10-14 mint_public (Accepted)");
    expect(text).not.toMatch(/aleo1|at1|\d+u128|\d+u64/);
  });

  it("reads transaction ids and transitions in the shapes the explorer and wallet use", () => {
    expect(transactionIdOf({ transactionId: tx(3) })).toBe(tx(3));
    expect(transactionIdOf(tx(4))).toBe(tx(4));
    expect(transactionIdOf({ id: "wallet-id" })).toBeNull();
    expect(transitionsOf({ transaction: transferDoc }).map((t) => t.function)).toEqual(["transfer_private", "fee_public"]);
    expect(transitionsOf(null)).toEqual([]);
  });

  it("counts what a decrypted transition reveals; records and ciphertext don't count", () => {
    expect(
      summariseOpened({
        inputs: [
          { type: "private", value: `${OWNER}` },
          { type: "private", value: "100u128" },
          { type: "record", value: "record1qq" },
        ],
        outputs: [{ type: "record", value: "record1zz" }, { type: "private", value: "ciphertext1zz" }],
      }),
    ).toEqual({ inputs: 3, inputsRead: 2, outputs: 2, outputsRead: 0, amountFound: true });
    expect(summariseOpened("nonsense")).toEqual({ inputs: 0, inputsRead: 0, outputs: 0, outputsRead: 0, amountFound: false });
  });

  it("puts entries newest first by block, then by time, and reads timestamps in seconds or milliseconds", () => {
    const items = [{ n: "a" }, { n: "b", blockNumber: 5 }, { n: "c", blockNumber: "9" }, { n: "d", blockTimestamp: 2 }, { n: "e", blockHeight: 9, blockTimestamp: 5 }];
    expect(newestFirst(items).map((x) => x.n)).toEqual(["e", "c", "b", "d", "a"]);
    expect(dateOf(1_760_486_400)).toBe("2025-10-15");
    expect(dateOf(1_760_486_400_000)).toBe("2025-10-15");
    expect(dateOf("2026-10-15T03:00:00Z")).toBe("2026-10-15");
    expect(dateOf(undefined)).toBe("?");
  });
});
