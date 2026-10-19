import { describe, expect, it } from "vitest";
import { SHIELD_APP_URL, SHIELD_OPEN_URL, SHIELD_RELAY_DEFAULT, SHIELD_RELAY_ORIGIN, shieldAdapterConfig } from "./wallet-provider";

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
