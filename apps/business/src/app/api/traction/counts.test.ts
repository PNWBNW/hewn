import { describe, expect, it } from "vitest";
import { type TractionStore, countHandler, countryOf, publish, tractionHandler } from "./counts";
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

describe("what is published", () => {
  it("names only countries with at least five visitors, totals everything, and counts the rest as hidden", () => {
    const p = publish({ visits: { US: 40, NG: 9, DE: 6, FR: 3 }, visitors: { US: 12, NG: 5, DE: 4, FR: 1 } });
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
