// The wallet useShield() returns asks Shield to sign only after the programs' editions check out
// (./editions.ts): a refused check means the adapter is never asked. checkedSend is tested on its
// own, and useShield() is called once with React's hooks and the wallet provider stood in for, so
// the wallet it hands every panel is shown to send through the same check.

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

// useShield() outside a render: state keeps its first value, effects don't run, an external
// store (the desktop app's address, ../desktop.ts) reads as on the server, and the provider's
// useWallet() hands back whatever adapter the test put in `provider.adaptor`.
const provider = vi.hoisted(() => ({ adaptor: null as unknown }));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useState: <T,>(first: T | (() => T)) => [typeof first === "function" ? (first as () => T)() : first, () => undefined],
  useEffect: () => undefined,
  useSyncExternalStore: <T,>(_subscribe: unknown, snapshot: () => T, server?: () => T) => (server ?? snapshot)(),
}));
vi.mock("@pnw/wallet/wallet-provider", async (original) => ({
  ...(await original<typeof import("@pnw/wallet/wallet-provider")>()),
  useWallet: () => provider.adaptor,
}));

import { checkedSend, useShield } from "./shield";

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

describe("useShield", () => {
  beforeEach(() => {
    editions.checks = 0;
    editions.refuse = null;
  });

  function connectedAdaptor() {
    const fake = fakeAdaptor();
    return { ...fake, wallets: [], wallet: null, connected: true, connecting: false, disconnecting: false, address: "aleo1fake" };
  }

  it("hands panels a wallet whose send never reaches the adapter when the edition check refuses", async () => {
    const adaptor = connectedAdaptor();
    provider.adaptor = adaptor;
    const { wallet } = useShield();
    expect(wallet.executeTransaction).not.toBe(adaptor.executeTransaction);
    editions.refuse = "one_program.aleo (now edition 2)";
    await expect(wallet.executeTransaction(CALL)).rejects.toThrow(/now edition 2/);
    expect(editions.checks).toBe(1);
    expect(adaptor.calls).toEqual([]);
  });

  it("hands panels a wallet that sends once the check passes, with the fee mode applied", async () => {
    const adaptor = connectedAdaptor();
    provider.adaptor = adaptor;
    const { wallet } = useShield();
    await wallet.executeTransaction({ ...CALL, feeMode: "private" });
    expect(editions.checks).toBe(1);
    expect(adaptor.calls).toEqual([{ ...CALL, privateFee: true }]);
  });
});
