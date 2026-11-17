import { describe, expect, it } from "vitest";
import { BRAND } from "@/brand";
import { DESKTOP_ORIGINS } from "@/desktop";
import { registerUpdateWorker, shouldRegister, WORKER_URL, type Container, type Registration } from "./register";

const at = (url: string) => {
  const u = new URL(url);
  return { protocol: u.protocol, hostname: u.hostname, port: u.port };
};
const browser = { serviceWorker: {} };

describe("shouldRegister", () => {
  it("only in the static bundle on the web", () => {
    expect(shouldRegister("1", at(BRAND.appUrl), browser)).toBe(true);
    // The website build (Vercel) serves no worker.
    expect(shouldRegister("", at(BRAND.appUrl), browser)).toBe(false);
    expect(shouldRegister(undefined, at(BRAND.appUrl), browser)).toBe(false);
    // The desktop app updates itself under its own key.
    for (const origin of DESKTOP_ORIGINS) expect(shouldRegister("1", at(`${origin}/`), browser)).toBe(false);
    // A browser without workers.
    expect(shouldRegister("1", at(BRAND.appUrl), {})).toBe(false);
  });

  it("not where the tests run (no page)", () => {
    expect(shouldRegister()).toBe(false);
  });
});

/** A worker container that hands back one registration whose state the test sets. */
function fake({ controller = null as unknown, installing = null as unknown, waiting = null as unknown, active = null as unknown } = {}) {
  const listeners: Record<string, () => void> = {};
  const reg = {
    installing,
    waiting,
    active,
    addEventListener: (type: string, fn: () => void) => {
      listeners[type] = fn;
    },
  } as unknown as Registration & { installing: unknown; active: unknown };
  const calls: [string, RegistrationOptions][] = [];
  const container: Container = {
    controller,
    register: async (url, options) => {
      calls.push([url, options]);
      return reg;
    },
  };
  return { reg, container, calls, fire: (type: string) => listeners[type]?.() };
}

describe("registerUpdateWorker", () => {
  it("registers the bundle's worker for the whole app, never from the HTTP cache", async () => {
    const f = fake();
    await registerUpdateWorker(f.container, () => undefined);
    expect(f.calls).toEqual([[WORKER_URL, { scope: "/", updateViaCache: "none" }]]);
  });

  it("says nothing when the first worker installs", async () => {
    const f = fake({ installing: {} });
    let said = 0;
    await registerUpdateWorker(f.container, () => said++);
    f.fire("updatefound");
    expect(said).toBe(0);
  });

  it("speaks up when another worker starts installing over the one running", async () => {
    const f = fake({ controller: {}, active: {} });
    let said = 0;
    await registerUpdateWorker(f.container, () => said++);
    expect(said).toBe(0);
    f.fire("updatefound");
    expect(said).toBe(1);
  });

  it("speaks up at once when one is already installing or waiting to take over", async () => {
    for (const state of [{ installing: {} }, { waiting: {} }]) {
      const f = fake({ controller: {}, active: {}, ...state });
      let said = 0;
      await registerUpdateWorker(f.container, () => said++);
      expect(said).toBe(1);
    }
  });
});
