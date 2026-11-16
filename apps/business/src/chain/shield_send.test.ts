// The wallet useShield() hands every panel: when Shield refuses a send because it was never asked
// to allow the program at connect, the panel gets what to do (rethrowSendError, ./shield_route.ts);
// any other error reaches it as Shield's adapter threw it. useShield() is called once with React's
// hooks, the edition check and the wallet provider stood in for.

import { describe, expect, it, vi } from "vitest";

vi.mock("./editions", () => ({ checkEditions: async () => undefined }));

// useShield() outside a render: state keeps its first value, effects don't run, and the
// provider's useWallet() hands back whatever adapter the test put in `provider.adaptor`.
const provider = vi.hoisted(() => ({ adaptor: null as unknown }));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useState: <T,>(first: T | (() => T)) => [typeof first === "function" ? (first as () => T)() : first, () => undefined],
  useEffect: () => undefined,
}));
vi.mock("@pnw/wallet/wallet-provider", async (original) => ({
  ...(await original<typeof import("@pnw/wallet/wallet-provider")>()),
  useWallet: () => provider.adaptor,
}));

import { useShield } from "./shield";
import { notAllowedProgramHint } from "./shield_route";

const CALL = { program: "hewn_cards_v1.aleo", function: "issue", inputs: ["1u64"], privateFee: false };

/** A connected adapter whose send fails with `error`. */
function refusingAdaptor(error: unknown) {
  return {
    wallets: [],
    wallet: null,
    connected: true,
    connecting: false,
    disconnecting: false,
    address: "aleo1fake",
    executeTransaction: async () => {
      throw error;
    },
  };
}

describe("useShield's send", () => {
  it("turns Shield's refusal of a program it was never asked to allow into what to do", async () => {
    // Shield's own words, seen 2026-11-14 on the card step of setup.
    const refused = new Error("hewn_cards_v1.aleo is not in the allowed programs, request it when connect");
    provider.adaptor = refusingAdaptor(refused);
    const { wallet } = useShield();
    const thrown = await wallet.executeTransaction(CALL).then(
      () => null,
      (e: unknown) => e,
    );
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toBe(notAllowedProgramHint(refused.message));
    expect((thrown as Error).cause).toBe(refused);
  });

  it("passes every other error through as the same object", async () => {
    const declined = new Error("User rejected the request");
    provider.adaptor = refusingAdaptor(declined);
    const { wallet } = useShield();
    await expect(wallet.executeTransaction(CALL)).rejects.toBe(declined);
  });
});
