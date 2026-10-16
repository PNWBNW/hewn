import { describe, expect, it } from "vitest";
import { letterCheckReport, runLetterCheck } from "./letter_check";
import { LETTERS_PROGRAM, type LetterWallet, SEND_FUNCTION } from "./letters";

const ME = "aleo1rhgdu77hgyqd3xjj8ucu3jj9r2krwz6mnzyd80gncr5fxcwlh5rsvzp9px";
const TX = "at1" + "p".repeat(58);

/** What the chain makes of a `send` call: the two records, in snarkVM's plaintext format. */
function recordsFrom(inputs: string[], sender?: string, fn = "send") {
  const halves = [...inputs[1]!.matchAll(/(\d+)u128/g)].map((m) => m[1]);
  const fields = [...inputs[2]!.matchAll(/(\d+)field/g)].map((m) => m[1]);
  if (fn === "send_page") {
    const page = `{\n  owner: ${inputs[0]}.private,\n  lookup: [\n    ${halves[0]}u128.private,\n    ${halves[1]}u128.private\n  ],\n  page: [\n${fields.map((f) => `    ${f}field.private`).join(",\n")}\n  ],\n  _nonce: 1group.public,\n  _version: 1u8.public\n}`;
    return [{ recordName: "Page", recordPlaintext: page, spent: false }];
  }
  const body = `  lookup: [\n    ${halves[0]}u128.private,\n    ${halves[1]}u128.private\n  ],\n  parcel: [\n${fields.map((f) => `    ${f}field.private`).join(",\n")}\n  ],\n  _nonce: 1group.public,\n  _version: 1u8.public\n}`;
  return [
    { recordName: "Letter", recordPlaintext: `{\n  owner: ${inputs[0]}.private,\n${body}`, spent: false, ...(sender ? { sender } : {}) },
    { recordName: "SentLetter", recordPlaintext: `{\n  owner: ${ME}.private,\n${body}`, spent: false },
  ];
}

/** A letter's transaction as the explorer returns it (the shape of packages/rail's fixture). */
function letterTx(fee: "fee_private" | "fee_public") {
  return {
    type: "execute",
    id: TX,
    execution: {
      transitions: [
        {
          id: "au1x",
          program: LETTERS_PROGRAM,
          function: "send",
          inputs: [
            { type: "private", id: "1field", value: "ciphertext1" },
            { type: "private", id: "2field", value: "ciphertext2" },
            { type: "private", id: "3field", value: "ciphertext3" },
          ],
          outputs: [
            { type: "record", id: "4field", checksum: "5field", value: "record1qyqs" + "a".repeat(300), sender_ciphertext: "6field" },
            { type: "record", id: "7field", checksum: "8field", value: "record1qyqs" + "b".repeat(300) },
          ],
        },
      ],
    },
    fee: {
      transition: {
        program: "credits.aleo",
        function: fee,
        inputs:
          fee === "fee_private"
            ? [{ type: "record", id: "9field", tag: "10field" }, { type: "public", value: "6578u64" }, { type: "public", value: "0u64" }]
            : [{ type: "public", value: "6578u64" }, { type: "public", value: "0u64" }, { type: "public", value: "11field" }],
      },
    },
  };
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
      return recordsFrom(sent[0]!.inputs, opts.sender, sent[0]!.function);
    },
  };
  return {
    sent,
    deps: {
      wallet,
      address: ME,
      fetchTransaction: async (id: string) => (id === TX ? letterTx(opts.fee ?? "fee_private") : null),
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
    // What anyone can see: the call, its kinds of inputs and outputs, nothing readable, and a private fee.
    expect(text).toContain(`Call: ${LETTERS_PROGRAM}/send`);
    expect(text).toContain("Inputs: 3 private (encrypted, unreadable)");
    expect(text).toContain("Outputs: 2 record (encrypted to its owner)");
    expect(text).toContain("Record ciphertext: 311 + 311 characters");
    expect(text).toContain("Sender ciphertext (only the owner can open it): on 1 record");
    expect(text).toContain("Readable values in this call: none");
    expect(text).toContain("Who paid: not shown");
    expect(text).toContain(`https://testnet.explorer.provable.com/transaction/${TX}`);
  });

  it("says when the fee names the payer, and never prints an account in readable values", async () => {
    const { describeBroadcast } = await import("./letter_check");
    const lines = describeBroadcast(letterTx("fee_public"));
    expect(lines.join("\n")).toContain("Who paid: shown (fee_public names the paying account)");
    const leaky = { execution: { transitions: [{ program: "x.aleo", function: "f", inputs: [{ type: "public", value: ME }], outputs: [] }] } };
    expect(describeBroadcast(leaky).join("\n")).toContain("Readable values in this call: an account");
    expect(describeBroadcast(null)).toEqual(["The explorer's copy couldn't be read"]);
  });

  it("carries a message of your own, and a long one as a page", async () => {
    const { messageFit, LETTER_TEXT_BYTES, PAGE_TEXT_BYTES } = await import("./letter_check");
    const short = setup({ listAfter: 1 });
    const r1 = await runLetterCheck({ ...short.deps, message: "Hello from Morgan 👋" });
    expect([r1.sentAs, r1.opened, r1.readBack]).toEqual(["letter", true, "Hello from Morgan 👋"]);
    const text = letterCheckReport(r1, "2026-10-16");
    expect(text).not.toContain("Hello from Morgan"); // the words stay on screen, not in the report
    expect(text).toContain("Message: 22 bytes");

    const long = "x".repeat(LETTER_TEXT_BYTES + 1);
    const paged = setup({ listAfter: 1 });
    const r2 = await runLetterCheck({ ...paged.deps, message: long });
    expect(paged.sent[0]!.function).toBe("send_page");
    expect([r2.sentAs, r2.opened, r2.letterFound, r2.copyFound]).toEqual(["page", true, true, false]);
    expect(r2.foundMs).toBeDefined(); // a page has no sender's copy to wait for
    expect(letterCheckReport(r2, "2026-10-16")).not.toContain("sender's copy");

    expect(messageFit("  ").as).toBe("empty");
    expect(messageFit("x".repeat(PAGE_TEXT_BYTES + 1)).as).toBe("too_long");
    await expect(runLetterCheck({ ...setup().deps, message: "x".repeat(PAGE_TEXT_BYTES + 1) })).rejects.toThrow(/too long/);
    await expect(runLetterCheck({ ...setup().deps, message: "" })).rejects.toThrow(/Write something/);
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
