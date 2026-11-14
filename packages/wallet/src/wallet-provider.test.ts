import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { PROGRAMS } from "@pnw/config/programs";
import {
  SHIELD_APP_URL,
  SHIELD_OPEN_URL,
  SHIELD_RELAY_DEFAULT,
  SHIELD_RELAY_ORIGIN,
  WALLET_PROGRAMS,
  shieldAdapterConfig,
  shieldWakeUrl,
} from "./wallet-provider";

describe("WALLET_PROGRAMS, the programs Shield is asked to allow at connect", () => {
  it("asks for every program in the config but the legacy registry", () => {
    // Shield refuses a call to a program it was not asked for at connect ("... is not in the
    // allowed programs"), so a program added to the config and not to this list breaks the page
    // that calls it. The legacy registry is only read through the explorer, never through Shield.
    const { network: _network, legacy: _legacy, ...groups } = PROGRAMS;
    const wanted = new Set<string>(["credits.aleo"]);
    for (const group of Object.values(groups)) for (const id of Object.values(group)) wanted.add(id);
    expect([...WALLET_PROGRAMS].sort()).toEqual([...wanted].sort());
  });

  it("lists each program once", () => {
    expect(new Set(WALLET_PROGRAMS).size).toBe(WALLET_PROGRAMS.length);
  });

  it("lists a program after the programs it imports", () => {
    const at = (id: string) => WALLET_PROGRAMS.indexOf(id);
    const { layer1, external, cards, credentials } = PROGRAMS;
    expect(at(external.merkle_tree)).toBeLessThan(at(external.usdcx_freezelist));
    expect(at(external.usdcx_multisig_core)).toBeLessThan(at(external.usdcx_freezelist));
    expect(at(external.usdcx_freezelist)).toBeLessThan(at(external.usdcx));
    expect(at(layer1.pnw_name_registry)).toBeLessThan(at(cards.hewn_cards));
    expect(at(layer1.employer_agreement_v5)).toBeLessThan(at(credentials.hewn_credentials));
  });

  it("is the same array on every import, so the provider never sees the list change", async () => {
    // The React provider disconnects whenever its `programs` array changes identity.
    const again = await import("./wallet-provider");
    expect(again.WALLET_PROGRAMS).toBe(WALLET_PROGRAMS);
  });
});

describe("Shield adapter configuration", () => {
  it("pins the relay the adapter dials to the origin the app's security policy allows", () => {
    // apps/business/src/security/headers.ts names the same origin in connect-src. If the adapter's
    // default ever moves, this fails rather than the policy silently blocking the relay.
    expect(SHIELD_RELAY_ORIGIN).toBe("wss://relay.shield.app");
    expect(SHIELD_RELAY_DEFAULT).toBe(SHIELD_RELAY_ORIGIN);
    expect(shieldAdapterConfig().remote).toEqual({ relayUrl: SHIELD_RELAY_ORIGIN });
  });

  it("tells Shield's approval screen who is asking, with an https icon", () => {
    const config = shieldAdapterConfig();
    expect(config.appName).toBe("Hewn");
    expect(config.appIconUrl).toMatch(/^https:\/\/.+\/brand\/hewn-icon-512\.png$/);
    expect(config.appName!.length).toBeLessThanOrEqual(64);
  });

  it("opens the app with its own scheme and points at its site for the download", () => {
    expect(SHIELD_OPEN_URL).toBe("shield://wake");
    expect(SHIELD_APP_URL).toBe("https://www.shield.app/");
  });
});

describe("shieldWakeUrl", () => {
  it("names this site's relay channel, as the adapter's own wake link does", () => {
    expect(shieldWakeUrl({ _shieldWallet: { channelId: "6f1c-2a/b" } })).toBe("shield://wake?channelId=6f1c-2a%2Fb");
  });

  it("falls back to the bare link with no relay pairing (the extension, Shield's browser, not connected)", () => {
    expect(shieldWakeUrl({ _shieldWallet: {} })).toBe(SHIELD_OPEN_URL);
    expect(shieldWakeUrl({ _shieldWallet: { channelId: "" } })).toBe(SHIELD_OPEN_URL);
    expect(shieldWakeUrl({})).toBe(SHIELD_OPEN_URL);
    expect(shieldWakeUrl(undefined)).toBe(SHIELD_OPEN_URL);
  });

  it("reads names the installed adapter still has: a version that moves them fails here", () => {
    // The adapter exposes no accessor for its relay channel; shieldWakeUrl reads its internals.
    // This pins them to the installed source, so a bump that renames them is caught in review
    // rather than by Shield saying "Connection expired" on someone's phone.
    const source = readFileSync(createRequire(import.meta.url).resolve("@provablehq/aleo-wallet-adapter-shield"), "utf8");
    expect(source).toContain("this._shieldWallet = wallet;");
    expect(source).toContain("this.channelId = channelIdOf(url);");
    expect(source).toContain("return `${base.protocol}//wake?channelId=${encodeURIComponent(channelId)}`;");
  });
});
