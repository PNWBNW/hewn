import { describe, expect, it } from "vitest";
import type { Rail } from "./rail";
import { SETUP_PATH, SETUP_STEPS, cardStepApplies, setupRedirect, setupStep, setupSteps } from "./setup";
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
const CARD = { issuedAt: 20801930, shown: true, since: "2026-10-25T00:08:18.000Z" };

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

  it("ends a new account's setup with its card, after the name or the profile", () => {
    const fresh = rail({ linkedAt: "2026-10-25T01:00:00.000Z" });
    expect(setupStep({ role: "business", rail: fresh, work: null })).toBe("name");
    expect(setupStep({ role: "business", rail: { ...fresh, businessNameHash: "123", businessName: "dayco" }, work: null })).toBe("card");
    expect(setupStep({ role: "business", rail: { ...fresh, businessNameHash: "123", businessName: "dayco", card: CARD }, work: null })).toBe("done");
    expect(setupStep({ role: "worker", rail: fresh, work: work({ ...PROFILE, profileAnchored: false }) })).toBe("profile");
    expect(setupStep({ role: "worker", rail: fresh, work: work(PROFILE) })).toBe("card");
    expect(setupStep({ role: "worker", rail: fresh, work: work({ ...PROFILE, card: CARD }) })).toBe("done");
  });

  it("lets an account from before the cards in without one: it claims its card from Settings", () => {
    const before = rail({ linkedAt: "2026-10-24T23:00:00.000Z", businessNameHash: "123", businessName: "dayco" });
    expect(setupStep({ role: "business", rail: before, work: null })).toBe("done");
    expect(setupStep({ role: "worker", rail: rail({ linkedAt: "2026-10-24T23:00:00.000Z" }), work: work(PROFILE) })).toBe("done");
    expect(cardStepApplies(before)).toBe(false);
    expect(cardStepApplies(rail({ linkedAt: "2026-10-25T00:08:18.000Z" }))).toBe(true);
    expect(cardStepApplies(null)).toBe(true);
  });

  it("asks a customer only for Shield and a name: no profile, no card yet", () => {
    const name = { name: "rowan", nameHash: "42", registeredAt: "2026-10-26T00:00:00.000Z" };
    const fresh = rail({ linkedAt: "2026-10-26T01:00:00.000Z" });
    expect(setupStep({ role: "customer", rail: null, work: null, customer: { version: 1 } })).toBe("link");
    expect(setupStep({ role: "customer", rail: fresh, work: null, customer: { version: 1 } })).toBe("name");
    expect(setupStep({ role: "customer", rail: fresh, work: null, customer: null })).toBe("name");
    expect(setupStep({ role: "customer", rail: fresh, work: null, customer: { version: 1, name } })).toBe("done");
    // A worker's profile or a business's name on the same vault doesn't count for a customer.
    expect(setupStep({ role: "customer", rail: { ...fresh, businessNameHash: "1" }, work: work(PROFILE), customer: { version: 1 } })).toBe("name");
    expect(setupSteps("customer", fresh)).toEqual(["link", "name"]);
  });

  it("lists the steps each role goes through", () => {
    expect(SETUP_STEPS.business).toEqual(["link", "name", "card"]);
    expect(SETUP_STEPS.worker).toEqual(["link", "name", "profile", "card"]);
    expect(setupSteps("business", null)).toEqual(["link", "name", "card"]);
    expect(setupSteps("worker", rail({ linkedAt: "2026-10-25T01:00:00.000Z" }))).toEqual(["link", "name", "profile", "card"]);
    expect(setupSteps("business", rail())).toEqual(["link", "name"]);
    expect(setupSteps("worker", rail())).toEqual(["link", "name", "profile"]);
  });
});

describe("setup redirect", () => {
  it("keeps an unfinished account on the setup page, wherever it tries to go", () => {
    for (const path of ["/", "/payroll", "/work", "/settings", "/mailbox"]) expect(setupRedirect("link", path)).toBe(SETUP_PATH);
    expect(setupRedirect("name", SETUP_PATH)).toBeNull();
    expect(setupRedirect("profile", "/work/profile")).toBe(SETUP_PATH);
    expect(setupRedirect("card", "/settings")).toBe(SETUP_PATH);
  });

  it("lets a finished account go anywhere, the setup page included", () => {
    expect(setupRedirect("done", "/payroll")).toBeNull();
    expect(setupRedirect("done", SETUP_PATH)).toBeNull();
  });
});
