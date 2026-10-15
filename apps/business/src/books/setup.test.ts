import { describe, expect, it } from "vitest";
import type { Rail } from "./rail";
import { SETUP_PATH, SETUP_STEPS, setupRedirect, setupStep } from "./setup";
import type { Work } from "./work";

const rail = (over: Partial<Rail> = {}): Rail => ({
  version: 1,
  network: "testnet",
  address: "aleo1kypwp5m7qtk9mwazgcpg0tq8aal23mnrvwfvug65qgcg9xvsrqgspyjm6n",
  linkedAt: "2026-10-15T00:00:00.000Z",
  links: [],
  ...over,
});
const work = (profile?: Work["profile"]): Work => ({ ...({} as Work), ...(profile ? { profile } : {}) });
const PROFILE = { nameHash: "7", name: "ana", profileAnchored: true, registeredAt: "2026-10-15T00:00:00.000Z" };

describe("setup steps", () => {
  it("starts every account by linking Shield", () => {
    expect(setupStep({ role: "business", rail: null, work: null })).toBe("link");
    expect(setupStep({ role: "worker", rail: undefined, work: work(PROFILE) })).toBe("link");
  });

  it("asks a business for its name, then is done", () => {
    expect(setupStep({ role: "business", rail: rail(), work: null })).toBe("name");
    expect(setupStep({ role: "business", rail: rail({ businessNameHash: "123", businessName: "dayco" }), work: null })).toBe("done");
  });

  it("asks a worker for a name, then the profile behind it", () => {
    expect(setupStep({ role: "worker", rail: rail(), work: work() })).toBe("name");
    expect(setupStep({ role: "worker", rail: rail(), work: null })).toBe("name");
    expect(setupStep({ role: "worker", rail: rail(), work: work({ ...PROFILE, profileAnchored: false }) })).toBe("profile");
    expect(setupStep({ role: "worker", rail: rail(), work: work(PROFILE) })).toBe("done");
  });

  it("doesn't take a business name as a worker's, or the reverse", () => {
    expect(setupStep({ role: "worker", rail: rail({ businessNameHash: "123" }), work: work() })).toBe("name");
    expect(setupStep({ role: "business", rail: rail(), work: work(PROFILE) })).toBe("name");
  });

  it("lists the steps each role goes through", () => {
    expect(SETUP_STEPS.business).toEqual(["link", "name"]);
    expect(SETUP_STEPS.worker).toEqual(["link", "name", "profile"]);
  });
});

describe("setup redirect", () => {
  it("keeps an unfinished account on the setup page, wherever it tries to go", () => {
    for (const path of ["/", "/payroll", "/work", "/settings", "/mailbox"]) expect(setupRedirect("link", path)).toBe(SETUP_PATH);
    expect(setupRedirect("name", SETUP_PATH)).toBeNull();
    expect(setupRedirect("profile", "/work/profile")).toBe(SETUP_PATH);
  });

  it("lets a finished account go anywhere, the setup page included", () => {
    expect(setupRedirect("done", "/payroll")).toBeNull();
    expect(setupRedirect("done", SETUP_PATH)).toBeNull();
  });
});
