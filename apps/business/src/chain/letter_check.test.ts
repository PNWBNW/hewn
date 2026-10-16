import { describe, expect, it } from "vitest";
import { letterCheckReport, runLetterCheck } from "./letter_check";
import { LETTERS_PROGRAM, type LetterWallet, SEND_FUNCTION } from "./letters";

const ME = "aleo1rhgdu77hgyqd3xjj8ucu3jj9r2krwz6mnzyd80gncr5fxcwlh5rsvzp9px";
const TX = "at1" + "p".repeat(58);

/** What the chain makes of a `send` call: the two records, in snarkVM's plaintext format. */
function recordsFrom(inputs: string[], sender?: string) {
  const halves = [...inputs[1]!.matchAll(/(\d+)u128/g)].map((m) => m[1]);
  const fields = [...inputs[2]!.matchAll(/(\d+)field/g)].map((m) => m[1]);
  const body = `  lookup: [\n    ${halves[0]}u128.private,\n    ${halves[1]}u128.private\n  ],\n  parcel: [\n${fields.map((f) => `    ${f}field.private`).join(",\n")}\n  ],\n  _nonce: 1group.public,\n  _version: 1u8.public\n}`;
  return [
    { recordName: "Letter", recordPlaintext: `{\n  owner: ${inputs[0]}.private,\n${body}`, spent: false, ...(sender ? { sender } : {}) },
    { recordName: "SentLetter", recordPlaintext: `{\n  owner: ${ME}.private,\n${body}`, spent: false },
  ];
}

function setup(opts: { listAfter?: number; fee?: "fee_private" | "fee_public"; sender?: string } = {}) {
  let t = 0;
  const sent: { function: string; inputs: string[] }[] = [];
  let reads = 0;
  const wallet: LetterWallet = {
    async executeTransaction(o) {
      sent.push(o);
      return { transactionId: "shield_1" };
    },
    async transactionStatus() {
      return { status: "accepted", transactionId: TX };
    },
    async requestRecords(program) {
      reads++;
      if (program !== LETTERS_PROGRAM || sent.length === 0 || reads <= (opts.listAfter ?? 0)) return [];
      return recordsFrom(sent[0]!.inputs, opts.sender);
    },
  };
  return {
    sent,
    deps: {
      wallet,
      address: ME,
      fetchTransaction: async (id: string) => (id === TX ? { id, fee: { transition: { program: "credits.aleo", function: opts.fee ?? "fee_private", inputs: [{ type: "public", value: "6578u64" }, { type: "public", value: "0u64" }] } } } : null),
      now: () => t,
      sleep: async (ms: number) => void (t += ms),
      waitMs: 60_000,
      pollMs: 5_000,
    },
  };
}

describe("the test letter", () => {
  it("sends one letter to this account and reports the fee, how it was paid, and that it opened", async () => {
    const { deps, sent } = setup({ listAfter: 2, sender: ME });
    const r = await runLetterCheck(deps);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.function).toBe(SEND_FUNCTION);
    expect(sent[0]!.inputs[0]).toBe(ME);
    expect(r).toMatchObject({ transactionId: TX, feeMicrocredits: 6578n, feeKind: "private", letterFound: true, copyFound: true, senderShown: true, opened: true });
    expect(r.foundMs).toBe(10_000); // listed on the third read, two polls later
    const text = letterCheckReport(r, "2026-10-16");
    expect(text).toContain("Fee: 0.006578 ALEO (6,578 microcredits)");
    expect(text).toContain("Fee paid: privately (no account shown)");
    expect(text).toContain("It opened and read back: yes");
    expect(text).not.toContain(ME); // no account in the report
  });

  it("says so when the fee was public and Shield never lists the letter", async () => {
    const { deps } = setup({ listAfter: 1_000, fee: "fee_public" });
    const r = await runLetterCheck(deps);
    expect(r).toMatchObject({ feeKind: "public", letterFound: false, copyFound: false, opened: false });
    expect(r.foundMs).toBeUndefined();
    const text = letterCheckReport(r, "2026-10-16");
    expect(text).toContain("publicly (shows this account)");
    expect(text).toContain("didn't within the wait");
  });
});
