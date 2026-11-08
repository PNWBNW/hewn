import { describe, expect, it } from "vitest";
import { WalletReadyState } from "@pnw/wallet/wallet-provider";
import { WAKE_DELAY_MS, isPairingCancelled, openShield, shieldRoute } from "./shield_route";

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

describe("openShield", () => {
  it("opens the Shield app with the link it is given, a moment after the tap so the request leaves first", () => {
    const calls: { url?: string; ms?: number } = {};
    openShield("shield://wake?channelId=abc", {
      navigate: (url) => {
        calls.url = url;
      },
      after: (fn, ms) => {
        calls.ms = ms;
        fn();
      },
    });
    expect(calls).toEqual({ url: "shield://wake?channelId=abc", ms: WAKE_DELAY_MS });
  });
});

describe("isPairingCancelled", () => {
  it("knows the adapter's word for a pairing this page tore down, and nothing else", () => {
    expect(isPairingCancelled("Shield pairing was cancelled")).toBe(true);
    expect(isPairingCancelled("timed out waiting for the Shield app to pair")).toBe(false);
    expect(isPairingCancelled("could not reach the Shield relay")).toBe(false);
  });
});
