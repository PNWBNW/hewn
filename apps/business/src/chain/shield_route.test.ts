import { describe, expect, it } from "vitest";
import { stoppedBeforeWallet } from "@pnw/rail";
import { WalletReadyState } from "@pnw/wallet/wallet-provider";
import { isPairingCancelled, mayReconnect, notAllowedProgramHint, overRelay, rethrowSendError, shieldRoute } from "./shield_route";

describe("shieldRoute", () => {
  it("uses injected Shield wherever it is found: the extension, or Shield's own browser", () => {
    expect(shieldRoute(WalletReadyState.INSTALLED, false)).toBe("injected");
    expect(shieldRoute(WalletReadyState.INSTALLED, true)).toBe("injected");
  });

  it("pairs over the relay from a plain phone browser", () => {
    expect(shieldRoute(WalletReadyState.LOADABLE, true)).toBe("relay");
  });

  it("shows a pairing code on a computer without the extension, for the phone's camera", () => {
    expect(shieldRoute(WalletReadyState.LOADABLE, false)).toBe("pair");
  });

  it("counts both relay routes as over the relay, and nothing else", () => {
    expect(overRelay("relay")).toBe(true);
    expect(overRelay("pair")).toBe(true);
    expect(overRelay("injected")).toBe(false);
    expect(overRelay("none")).toBe(false);
  });

  it("pairs the desktop app with the phone, its one way in, and offers nothing where the relay can't run", () => {
    expect(shieldRoute(WalletReadyState.LOADABLE, false, true)).toBe("pair");
    // Never a phone's relay route, whatever the web view's user agent says.
    expect(shieldRoute(WalletReadyState.LOADABLE, true, true)).toBe("pair");
    // No extension runs inside it, so nothing it reports as installed is taken at its word.
    expect(shieldRoute(WalletReadyState.INSTALLED, false, true)).toBe("none");
    expect(shieldRoute(WalletReadyState.NOT_DETECTED, false, true)).toBe("none");
    expect(shieldRoute(undefined, false, true)).toBe("none");
  });

  it("has no way in when the adapter found nothing", () => {
    expect(shieldRoute(WalletReadyState.NOT_DETECTED, true)).toBe("none");
    expect(shieldRoute(WalletReadyState.UNSUPPORTED, true)).toBe("none");
    expect(shieldRoute(undefined, true)).toBe("none");
  });
});

describe("isPairingCancelled", () => {
  it("knows the adapter's word for a pairing this page tore down, and nothing else", () => {
    expect(isPairingCancelled("Shield pairing was cancelled")).toBe(true);
    expect(isPairingCancelled("timed out waiting for the Shield app to pair")).toBe(false);
    expect(isPairingCancelled("could not reach the Shield relay")).toBe(false);
  });
});

describe("notAllowedProgramHint", () => {
  it("tells the person to connect again when Shield was never asked for the program", () => {
    // Shield's own words, seen 2026-11-14 on the card step of setup.
    const hint = notAllowedProgramHint("hewn_cards_v1.aleo is not in the allowed programs, request it when connect");
    expect(hint).toMatch(/disconnect this site, then connect again/);
    expect(hint).toMatch(/Nothing was sent/);
    // Chain vocabulary stays out of what the person reads.
    expect(hint).not.toMatch(/\.aleo/);
  });

  it("leaves every other error alone", () => {
    expect(notAllowedProgramHint("User rejected the request")).toBeNull();
    expect(notAllowedProgramHint("Shield pairing was cancelled")).toBeNull();
    expect(notAllowedProgramHint("")).toBeNull();
  });
});

describe("rethrowSendError", () => {
  const NOTHING = Symbol("nothing thrown");
  const thrownBy = (e: unknown): unknown => {
    try {
      rethrowSendError(e);
    } catch (thrown) {
      return thrown;
    }
    return NOTHING;
  };

  it("rethrows Shield's refusal as the hint, keeping Shield's error as its cause", () => {
    const refused = new Error("hewn_cards_v1.aleo is not in the allowed programs, request it when connect");
    const thrown = thrownBy(refused);
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toBe(notAllowedProgramHint(refused.message));
    expect((thrown as Error).cause).toBe(refused);
    // Nothing was sent: a payment refused this way fails with its record kept, never "not confirmed".
    expect(stoppedBeforeWallet(thrown)).toBe(true);
  });

  it("rethrows any other error as the same object", () => {
    // Only an Error's message is read: anything else thrown passes through untouched.
    for (const other of [new Error("User rejected the request"), "not in the allowed programs", undefined]) {
      expect(thrownBy(other)).toBe(other);
    }
    expect(stoppedBeforeWallet(thrownBy(new Error("User rejected the request")))).toBe(false);
  });
});

describe("mayReconnect", () => {
  const gone = { pending: true, selected: false, connected: false, connecting: false, disconnecting: false };
  it("asks for the fresh connect only once the old pairing is gone from the provider", () => {
    expect(mayReconnect(gone)).toBe(true);
    expect(mayReconnect({ ...gone, pending: false })).toBe(false); // nothing asked
    expect(mayReconnect({ ...gone, disconnecting: true })).toBe(false); // still going
    expect(mayReconnect({ ...gone, selected: true, connected: true })).toBe(false); // the provider still shows it: the race of 2026-11-08
    expect(mayReconnect({ ...gone, selected: true })).toBe(false); // the wallet not yet forgotten
    expect(mayReconnect({ ...gone, connecting: true })).toBe(false);
  });
});
