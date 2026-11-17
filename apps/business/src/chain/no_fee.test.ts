// No call the app makes to Shield names a fee amount: the wallet charges its own estimate, and the
// person sees it in the wallet's prompt. Each way a transaction leaves the app is run here through
// a wallet that keeps exactly what it was handed: one transition and its wait (work/execute.ts,
// which letters, names, cards and the rest go through), sending an offer and withdrawing one
// (offer.ts), and the last step before the adaptor, where the fee mode is applied
// (@pnw/wallet/fee-mode). The pay queue's transfers are checked beside its other tests
// (packages/rail/src/queue.test.ts).
import { describe, expect, it } from "vitest";
import { withFeeMode } from "@pnw/wallet/fee-mode";
import { AGREEMENT_V4, AGREEMENT_V5 } from "./agreement_programs";
import { type SendOfferInput, sendOffer, withdrawOffer } from "./offer";
import { executeAndWait } from "./work/execute";

const EMPLOYER = "aleo1kypwp5m7qtk9mwazgcpg0tq8aal23mnrvwfvug65qgcg9xvsrqgspyjm6n";
const WORKER = "aleo1rhgdu77hgyqd3xjj8ucu3jj9r2krwz6mnzyd80gncr5fxcwlh5rsvzp9px";
const TX = "at1yphn8n9zejqnnsktuev7rl9vkv8styq00rjpffa0h7rxnccssyyqdk9ltw";

/** A wallet that keeps every request exactly as it arrived and accepts it at once. */
function keepingWallet() {
  const asked: Record<string, unknown>[] = [];
  return {
    asked,
    async executeTransaction(opts: Record<string, unknown>) {
      asked.push(opts);
      return { transactionId: "shield_1" };
    },
    async transactionStatus() {
      return { status: "accepted", transactionId: TX };
    },
  };
}

let tick = 0;
const instant = { clock: { now: () => (tick += 1000) }, sleep: async () => {} };

function offer(over: Partial<SendOfferInput>): SendOfferInput {
  return {
    employerAddress: EMPLOYER,
    employerNameHash: "123456789012345678901234567890",
    businessName: "dayco",
    worker: { id: "wkr-1", payType: "hourly", rate: 3000n, frequency: "biweekly" },
    workerAddress: WORKER,
    workerNameHash: "987654321098765432109876543210field",
    industryCode: 9,
    termsText: "Carpenter, 40 hours a week.",
    startDate: "2026-11-02",
    reviewDate: "2027-01-31",
    endDate: "",
    currentHeight: 4_210_000,
    client: { put: async () => {} },
    wallet: keepingWallet(),
    now: () => new Date("2026-10-14T15:04:05.000Z"),
    ...instant,
    ...over,
  };
}

describe("no call to Shield names a fee", () => {
  it("one transition and its wait", async () => {
    const wallet = keepingWallet();
    await executeAndWait(wallet, { program: "pnw_name_registrar_v5.aleo", function: "register_worker_name", inputs: ["1field"] }, { sleep: async () => {}, pollMs: 1 });
    await executeAndWait(wallet, { program: "pnw_name_registrar_v5.aleo", function: "register_worker_name", inputs: ["1field"], feeMode: "private" }, { sleep: async () => {}, pollMs: 1 });
    expect(wallet.asked).toHaveLength(2);
    for (const call of wallet.asked) expect(call).not.toHaveProperty("fee");
  });

  it("an offer, to either agreement program, and its withdrawal", async () => {
    const wallet = keepingWallet();
    const v4 = await sendOffer(offer({ wallet, program: AGREEMENT_V4 }));
    await sendOffer(offer({ wallet, program: AGREEMENT_V5, feeMode: "private" }));
    await withdrawOffer({ link: v4.link, employerNameHash: "123456789012345678901234567890", wallet, ...instant });
    expect(wallet.asked.map((c) => c.program)).toEqual([AGREEMENT_V4, AGREEMENT_V5, AGREEMENT_V4]);
    for (const call of wallet.asked) {
      expect(call).not.toHaveProperty("fee");
      expect(call.privateFee).toBe(false);
    }
  });

  it("the fee mode decides how the fee is paid, never how much", () => {
    const call: { program: string; function: string; inputs: string[]; privateFee?: boolean } = { program: "p.aleo", function: "f", inputs: ["1field"] };
    for (const mode of ["public", "private"] as const) {
      const sent = withFeeMode(call, mode);
      expect(sent).toEqual({ ...call, privateFee: mode === "private" });
      expect(sent).not.toHaveProperty("fee");
    }
  });
});
