import { describe, expect, it } from "vitest";
import { BRAND } from "@/brand";
import { APP_ORIGINS, DESKTOP_ORIGINS, type TractionStore, countHandler, countPreflightHandler, countryOf, publish, tractionHandler } from "./counts";
import { storeSettings, upstashStore } from "./store";

const memory = (): TractionStore & { visits: Record<string, number>; visitors: Record<string, number> } => {
  const visits: Record<string, number> = {};
  const visitors: Record<string, number> = {};
  return {
    visits,
    visitors,
    async add(c, first) {
      visits[c] = (visits[c] ?? 0) + 1;
      if (first) visitors[c] = (visitors[c] ?? 0) + 1;
    },
    async read() {
      return { visits: { ...visits }, visitors: { ...visitors } };
    },
  };
};
const req = (body: unknown, headers: Record<string, string> = {}) =>
  new Request("https://hewn.test/api/count", {
    method: "POST",
    headers: { origin: "https://hewn.test", host: "hewn.test", "x-vercel-ip-country": "NG", "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

describe("the country", () => {
  it("comes only from Vercel's header, and only when it is a real place", () => {
    expect(countryOf(new Request("https://x", { headers: { "x-vercel-ip-country": "ng" } }))).toBe("NG");
    expect(countryOf(new Request("https://x", { headers: { "x-vercel-ip-country": "XX" } }))).toBeNull();
    expect(countryOf(new Request("https://x", { headers: { "x-vercel-ip-country": "T1" } }))).toBeNull();
    expect(countryOf(new Request("https://x", { headers: { "x-vercel-ip-country": "USA" } }))).toBeNull();
    expect(countryOf(new Request("https://x"))).toBeNull();
  });
});

describe("counting a visit", () => {
  it("adds a visit, and a visitor only on a device's first visit", async () => {
    const store = memory();
    const count = countHandler(store);
    expect((await count(req({ first: true }))).status).toBe(204);
    await count(req({ first: false }));
    await count(req({ first: true }, { "x-vercel-ip-country": "US" }));
    expect(store.visits).toEqual({ NG: 2, US: 1 });
    expect(store.visitors).toEqual({ NG: 1, US: 1 });
  });
  it("counts nothing from another site, a bad body, an unknown place or an oversized request, and always answers 204", async () => {
    const store = memory();
    const count = countHandler(store);
    for (const r of [
      req({ first: true }, { origin: "https://evil.test" }),
      req("not json"),
      req({ first: "yes" }),
      req({ first: true }, { "x-vercel-ip-country": "XX" }),
      req({ first: true }, { "content-length": "5000" }),
    ]) {
      expect((await count(r)).status).toBe(204);
    }
    expect(store.visits).toEqual({});
    expect((await countHandler(null)(req({ first: true }))).status).toBe(204);
  });
  it("never fails the page when the store does", async () => {
    const broken: TractionStore = { add: async () => Promise.reject(new Error("down")), read: async () => Promise.reject(new Error("down")) };
    expect((await countHandler(broken)(req({ first: true }))).status).toBe(204);
    const res = await tractionHandler(broken)();
    expect(await res.json()).toMatchObject({ countries: [], visitors: 0, visits: 0 });
  });
});

describe("asking from the app's other origins (the static bundle, the desktop app)", () => {
  const app = new URL(BRAND.appUrl).origin;
  // The counter on an address of its own, asked by the app's pages from elsewhere.
  const crossSite = (origin: string, body: unknown = { first: true }) => req(body, { origin, host: "count.hewn.test" });
  const preflight = (origin: string | null, method = "POST", headers: string | null = "content-type") =>
    new Request("https://count.hewn.test/api/count", {
      method: "OPTIONS",
      headers: {
        host: "count.hewn.test",
        ...(origin ? { origin } : {}),
        ...(method ? { "access-control-request-method": method } : {}),
        ...(headers !== null ? { "access-control-request-headers": headers } : {}),
      },
    });
  const traction = (origin: string | null) =>
    new Request("https://count.hewn.test/api/traction", { headers: { host: "count.hewn.test", ...(origin ? { origin } : {}) } });

  it("knows the app's own origins: its address and the desktop app's two, nothing else", () => {
    expect(APP_ORIGINS).toEqual([app, "tauri://localhost", "http://tauri.localhost"]);
    expect(DESKTOP_ORIGINS).toEqual(["tauri://localhost", "http://tauri.localhost"]);
    expect(app).toMatch(/^https:\/\//);
  });

  it("counts a visit from each of them, and answers with permission for that origin alone", async () => {
    for (const origin of APP_ORIGINS) {
      const store = memory();
      const res = await countHandler(store)(crossSite(origin));
      expect(res.status).toBe(204);
      expect(res.headers.get("access-control-allow-origin")).toBe(origin);
      expect(res.headers.get("vary")).toBe("Origin");
      expect(res.headers.get("access-control-allow-credentials")).toBeNull();
      expect(store.visits).toEqual({ NG: 1 });
    }
  });

  it("still counts the website asking itself", async () => {
    const store = memory();
    const res = await countHandler(store)(req({ first: false }));
    expect(res.headers.get("access-control-allow-origin")).toBe("https://hewn.test");
    expect(store.visits).toEqual({ NG: 1 });
  });

  it("counts nothing and gives no permission to any other origin, a lookalike, a sandboxed frame or a missing origin", async () => {
    const store = memory();
    for (const origin of ["https://evil.test", `${app}.evil.test`, app.replace("https://", "http://"), "https://tauri.localhost", "tauri://evil", "null"]) {
      const res = await countHandler(store)(crossSite(origin));
      expect(res.status).toBe(204);
      expect(res.headers.get("access-control-allow-origin")).toBeNull();
    }
    const bare = new Request("https://count.hewn.test/api/count", { method: "POST", headers: { host: "count.hewn.test", "x-vercel-ip-country": "NG" }, body: '{"first":true}' });
    expect((await countHandler(store)(bare)).headers.get("access-control-allow-origin")).toBeNull();
    expect(store.visits).toEqual({});
  });

  it("sends only yes or no and stores only the two counts, whoever asks (INV-05)", async () => {
    const store = memory();
    await countHandler(store)(crossSite("tauri://localhost", { first: true, name: "someone", id: "x" }));
    await countHandler(store)(crossSite("tauri://localhost", { first: "yes" }));
    expect(store.visits).toEqual({ NG: 1 });
    expect(store.visitors).toEqual({ NG: 1 });
  });

  it("answers the browser's preflight for a POST with a JSON body, from the app's origins only", async () => {
    const preflightFor = countPreflightHandler();
    for (const origin of APP_ORIGINS) {
      const res = preflightFor(preflight(origin));
      expect(res.status).toBe(204);
      expect(res.headers.get("access-control-allow-origin")).toBe(origin);
      expect(res.headers.get("access-control-allow-methods")).toBe("POST");
      expect(res.headers.get("access-control-allow-headers")).toBe("Content-Type");
      expect(res.headers.get("access-control-max-age")).toBe("86400");
      expect(res.headers.get("vary")).toBe("Origin");
      expect(res.headers.get("access-control-allow-credentials")).toBeNull();
    }
    // Without a header list (a plain POST) is fine too, and header names are case-insensitive.
    expect(preflightFor(preflight(app, "POST", null)).headers.get("access-control-allow-origin")).toBe(app);
    expect(preflightFor(preflight(app, "POST", "Content-Type")).headers.get("access-control-allow-origin")).toBe(app);
  });

  it("refuses a preflight from elsewhere, for another method or for any other header", () => {
    const preflightFor = countPreflightHandler();
    for (const r of [
      preflight("https://evil.test"),
      preflight(null),
      preflight("null"),
      preflight(app, "PUT"),
      preflight(app, "GET"),
      preflight(app, ""),
      preflight(app, "POST", "content-type, authorization"),
      preflight(app, "POST", "x-anything"),
    ]) {
      const res = preflightFor(r);
      expect(res.status).toBe(204);
      expect(res.headers.get("access-control-allow-origin")).toBeNull();
      expect(res.headers.get("access-control-allow-methods")).toBeNull();
    }
  });

  it("lets the app's origins read the published numbers, keeps the day's cache, and gives no one else permission", async () => {
    const store = memory();
    await store.add("NG", true);
    for (const origin of APP_ORIGINS) {
      const res = await tractionHandler(store)(traction(origin));
      expect(res.headers.get("access-control-allow-origin")).toBe(origin);
      expect(res.headers.get("vary")).toBe("Origin");
      expect(res.headers.get("cache-control")).toContain("s-maxage=86400");
    }
    for (const origin of ["https://evil.test", null]) {
      const res = await tractionHandler(store)(traction(origin));
      expect(res.headers.get("access-control-allow-origin")).toBeNull();
      expect(res.headers.get("vary")).toBe("Origin");
    }
  });
});

describe("what is published", () => {
  it("names every country with a visitor while on testnet, and nothing that isn't a country", () => {
    const p = publish({ visits: { US: 40, NG: 9, DE: 6, FR: 3, GB: 2 }, visitors: { US: 12, NG: 5, DE: 4, FR: 1, GB: 0 } });
    expect(p.countries.map((c) => c.country)).toEqual(["US", "NG", "DE", "FR"]);
    expect(p).toMatchObject({ visitors: 22, visits: 60, hidden: 0, minVisitors: 1 });
    expect(publish({ visits: { "<b>": 9 }, visitors: { "<b>": 9, US: -3 } }).countries).toEqual([]);
  });
  it("with a floor (5 before mainnet), names only countries at or above it, totals everything, and counts the rest as hidden", () => {
    const p = publish({ visits: { US: 40, NG: 9, DE: 6, FR: 3 }, visitors: { US: 12, NG: 5, DE: 4, FR: 1 } }, 5);
    expect(p.countries).toEqual([
      { country: "US", visitors: 12, visits: 40 },
      { country: "NG", visitors: 5, visits: 9 },
    ]);
    expect(p).toMatchObject({ visitors: 22, visits: 58, hidden: 2, minVisitors: 5 });
    expect(publish({ visits: { "<b>": 9 }, visitors: { "<b>": 9, US: -3 } }).countries).toEqual([]);
  });
  it("is cached for a day at the edge, and carries no dates", async () => {
    const store = memory();
    for (let i = 0; i < 6; i++) await store.add("NG", true);
    const res = await tractionHandler(store)();
    expect(res.headers.get("cache-control")).toContain("s-maxage=86400");
    const body = await res.json();
    expect(JSON.stringify(body)).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(body.countries).toEqual([{ country: "NG", visitors: 6, visits: 6 }]);
    expect(body.status).toBe("counting");
  });

  it("says when counting is off or the store didn't answer, and never caches that", async () => {
    const off = await tractionHandler(null)();
    expect(off.headers.get("cache-control")).toBe("no-store");
    expect(await off.json()).toMatchObject({ status: "off", visitors: 0, visits: 0 });
    const broken: TractionStore = { add: async () => {}, read: async () => Promise.reject(new Error("down")) };
    const down = await tractionHandler(broken)();
    expect(down.headers.get("cache-control")).toBe("no-store");
    expect(await down.json()).toMatchObject({ status: "unavailable", visitors: 0 });
  });
});

describe("the Upstash store", () => {
  it("finds its settings under the usual names or one prefix Vercel was given", () => {
    expect(storeSettings({ KV_REST_API_URL: "https://a", KV_REST_API_TOKEN: "t" })).toEqual({ url: "https://a", key: "t" });
    expect(storeSettings({ UPSTASH_REDIS_REST_URL: "https://b", UPSTASH_REDIS_REST_TOKEN: "u" })).toEqual({ url: "https://b", key: "u" });
    expect(storeSettings({ STORAGE_KV_REST_API_URL: "https://c", STORAGE_KV_REST_API_TOKEN: "v" })).toEqual({ url: "https://c", key: "v" });
    expect(storeSettings({ HEWN_REST_API_URL: "https://d", HEWN_REST_API_TOKEN: "w" })).toEqual({ url: "https://d", key: "w" });
    // A URL without its own token (or a token from another prefix) isn't a pair.
    expect(storeSettings({ A_KV_REST_API_URL: "https://e", B_KV_REST_API_TOKEN: "x" })).toBeNull();
    expect(storeSettings({ KV_REST_API_URL: "https://f" })).toBeNull();
  });

  it("is off without its settings, and sends two counters per first visit and one otherwise", async () => {
    expect(upstashStore({})).toBeNull();
    const sent: unknown[] = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      sent.push({ url, auth: (init.headers as Record<string, string>).Authorization, body: JSON.parse(String(init.body)) });
      return new Response(JSON.stringify([{ result: ["NG", "3"] }, { result: ["NG", "2"] }]));
    }) as unknown as typeof fetch;
    const store = upstashStore({ KV_REST_API_URL: "https://kv.test/", KV_REST_API_TOKEN: "t" }, fetchImpl)!;
    await store.add("NG", true);
    await store.add("NG", false);
    expect(sent).toEqual([
      { url: "https://kv.test/pipeline", auth: "Bearer t", body: [["HINCRBY", "hewn:traction:visits", "NG", 1], ["HINCRBY", "hewn:traction:visitors", "NG", 1]] },
      { url: "https://kv.test/pipeline", auth: "Bearer t", body: [["HINCRBY", "hewn:traction:visits", "NG", 1]] },
    ]);
    expect(await store.read()).toEqual({ visits: { NG: 3 }, visitors: { NG: 2 } });
  });
});
