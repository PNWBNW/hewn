import { describe, expect, it } from "vitest";
import { WalletReadyState } from "@pnw/wallet/wallet-provider";
import { isPairingCancelled, mayReconnect, notAllowedProgramHint, shieldRoute } from "./shield_route";

describe("shieldRoute", () => {
  it("uses injected Shield wherever it is found: the extension, or Shield's own browser", () => {
    expect(shieldRoute(WalletReadyState.INSTALLED, false)).toBe("injected");
    expect(shieldRoute(WalletReadyState.INSTALLED, true)).toBe("injected");
  });

  it("pairs over the relay from a plain phone browser", () => {
    expect(shieldRoute(WalletReadyState.LOADABLE, true)).toBe("relay");
  });

  it("has no way in on a computer without the extension: the app can't scan a pairing code yet", () => {
    expect(shieldRoute(WalletReadyState.LOADABLE, false)).toBe("none");
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
