// ---------------------------------------------------------------------------
// The traction counter (Joshua, 2026-10-19; docs/THREAT_MODEL.md "Traction
// counts"): during testnet, how many people have opened Hewn, by country,
// since launch. Nothing else.
//
// What is stored: two numbers per country, visits and visitors, as totals
// since launch. No dates, no addresses, no ids, nothing per person. A visit
// is a browser session; a visitor is a device's first visit ever, decided on
// the device itself (it remembers it was counted), so the server never has to
// recognise anyone.
//
// What is published: only countries with at least MIN_VISITORS visitors, so a
// country with one or two people never points at them; the page's numbers are
// cached for a day, so watching it can't time anyone's visit.
//
// The country comes from the header Vercel sets on every request; the request's
// address is never read. Pure apart from the injected store.
// ---------------------------------------------------------------------------

export const MIN_VISITORS = 5;
export const VISITS_KEY = "hewn:traction:visits";
export const VISITORS_KEY = "hewn:traction:visitors";
export const COUNTRY_HEADER = "x-vercel-ip-country";
/** A day, in seconds: how long the published numbers are cached. */
export const PUBLISH_CACHE_S = 86_400;

const COUNTRY = /^[A-Z]{2}$/;
/** Codes that aren't a place: unknown, Tor, anonymous proxies. */
const NOT_A_PLACE = new Set(["XX", "T1", "A1", "A2", "EU", "AP"]);

/** The two-letter country from the request, or null when there isn't a real one. */
export function countryOf(request: Request): string | null {
  const raw = (request.headers.get(COUNTRY_HEADER) ?? "").trim().toUpperCase();
  return COUNTRY.test(raw) && !NOT_A_PLACE.has(raw) ? raw : null;
}

/** The store: two hashes of counters. Upstash in production (store.ts), a Map in tests. */
export type TractionStore = {
  add(country: string, firstVisit: boolean): Promise<void>;
  read(): Promise<{ visits: Record<string, number>; visitors: Record<string, number> }>;
};

const NO_STORE = { "Cache-Control": "no-store" };
const done = () => new Response(null, { status: 204, headers: NO_STORE });

/**
 * POST /api/count: `{"first": true|false}` from the page, same origin only.
 * Always answers 204, so a page never waits on it or learns anything from it.
 */
export function countHandler(store: TractionStore | null) {
  return async (request: Request): Promise<Response> => {
    if (!store) return done();
    const origin = request.headers.get("origin");
    const host = request.headers.get("host");
    if (!origin || !host || new URL(origin).host !== host) return done();
    const declared = Number(request.headers.get("content-length") ?? "0");
    if (!Number.isFinite(declared) || declared > 64) return done();
    let first = false;
    try {
      const body = (await request.json()) as unknown;
      if (!body || typeof body !== "object" || typeof (body as { first?: unknown }).first !== "boolean") return done();
      first = (body as { first: boolean }).first;
    } catch {
      return done();
    }
    const country = countryOf(request);
    if (!country) return done();
    try {
      await store.add(country, first);
    } catch {
      // the count is best effort; the page never hears about it
    }
    return done();
  };
}

export type Published = {
  /**
   * Whether the numbers are real: "counting" (read from the store), "off" (no store connected, so
   * nothing has been counted) or "unavailable" (the store didn't answer). Only real numbers are
   * cached for a day; the others aren't cached, so the page shows the counts as soon as they exist.
   */
  status: "counting" | "off" | "unavailable";
  /** Countries at or above the floor, most visitors first. */
  countries: { country: string; visitors: number; visits: number }[];
  /** Totals over every country, the ones below the floor included. */
  visitors: number;
  visits: number;
  /** How many countries are counted but not shown yet. */
  hidden: number;
  minVisitors: number;
};

/** What the public page may show. */
export function publish(
  raw: { visits: Record<string, number>; visitors: Record<string, number> },
  min = MIN_VISITORS,
  status: Published["status"] = "counting",
): Published {
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);
  const codes = new Set([...Object.keys(raw.visits), ...Object.keys(raw.visitors)].filter((c) => COUNTRY.test(c)));
  const all = [...codes].map((country) => ({ country, visitors: num(raw.visitors[country]), visits: num(raw.visits[country]) }));
  const shown = all.filter((c) => c.visitors >= min).sort((a, b) => b.visitors - a.visitors || b.visits - a.visits || a.country.localeCompare(b.country));
  return {
    status,
    countries: shown,
    visitors: all.reduce((n, c) => n + c.visitors, 0),
    visits: all.reduce((n, c) => n + c.visits, 0),
    hidden: all.filter((c) => c.visitors > 0 && c.visitors < min).length,
    minVisitors: min,
  };
}

/** GET /api/traction: the published numbers, cached for a day at the edge once they are real. */
export function tractionHandler(store: TractionStore | null) {
  return async (): Promise<Response> => {
    const raw = store ? await store.read().catch(() => null) : null;
    const status: Published["status"] = !store ? "off" : raw ? "counting" : "unavailable";
    const body = publish(raw ?? { visits: {}, visitors: {} }, MIN_VISITORS, status);
    const cache = status === "counting" ? `public, max-age=0, s-maxage=${PUBLISH_CACHE_S}, stale-while-revalidate=3600` : "no-store";
    return Response.json(body, { headers: { "Cache-Control": cache } });
  };
}
