// The wallet useShield() returns asks Shield to sign only after the programs' editions check out
// (./editions.ts): a refused check means the adapter is never asked.

import { beforeEach, describe, expect, it, vi } from "vitest";

// The edition check, answered here: `refuse` makes the next checks throw, as ./editions.ts does
// when a program changed or the explorer didn't answer.
const editions = vi.hoisted(() => ({ checks: 0, refuse: null as string | null }));
vi.mock("./editions", () => ({
  checkEditions: async () => {
    editions.checks += 1;
    if (editions.refuse) throw new Error(editions.refuse);
  },
}));

import { checkedSend } from "./shield";

const CALL = { program: "one_program.aleo", function: "go", inputs: ["1u64"], privateFee: false };

function fakeAdaptor() {
  const calls: unknown[] = [];
  return {
    calls,
    executeTransaction: async (opts: unknown) => {
      calls.push(opts);
      return { transactionId: "at1fake" };
    },
  };
}

describe("checkedSend", () => {
  beforeEach(() => {
    editions.checks = 0;
    editions.refuse = null;
  });

  it("never asks the adapter when the edition check refuses", async () => {
    editions.refuse = "one_program.aleo (now edition 2)";
    const adaptor = fakeAdaptor();
    await expect(checkedSend(adaptor)(CALL)).rejects.toThrow(/now edition 2/);
    expect(editions.checks).toBe(1);
    expect(adaptor.calls).toEqual([]);
  });

  it("asks the adapter once the check passes, with the fee mode applied", async () => {
    const adaptor = fakeAdaptor();
    await expect(checkedSend(adaptor)({ ...CALL, feeMode: "private" })).resolves.toEqual({ transactionId: "at1fake" });
    expect(editions.checks).toBe(1);
    expect(adaptor.calls).toEqual([{ ...CALL, privateFee: true }]);
  });

  it("checks again at every send", async () => {
    const adaptor = fakeAdaptor();
    const send = checkedSend(adaptor);
    await send(CALL);
    editions.refuse = "the explorer didn't answer";
    await expect(send(CALL)).rejects.toThrow(/didn't answer/);
    expect(editions.checks).toBe(2);
    expect(adaptor.calls).toHaveLength(1);
  });
});
