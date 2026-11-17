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
// What is published: every country with at least MIN_VISITORS visitors. While
// Hewn is on testnet that is every country with one (Joshua, 2026-10-30: the
// smaller groups are worth seeing, and testnet visitors are few and known); the
// floor of 5, which keeps a country with one or two people from pointing at
// them, comes back before mainnet. The page's numbers are cached for a day, so
// watching it can't time anyone's visit.
//
// The country comes from the header Vercel sets on every request; the request's
// address is never read. Pure apart from the injected store.
// ---------------------------------------------------------------------------
import { BRAND } from "@/brand";

export const MIN_VISITORS = 1;
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

// ---------------------------------------------------------------------------
// Who may ask (docs/HOSTING.md, step 4). The website asks its own server, the
// same origin. The static bundle asks from elsewhere: from the app's address
// once that is served as plain files (GitHub Pages), and from the desktop
// app's own origins. Those, and only those, get cross-site permission; any
// other page's request is refused by its own browser, and a count it sends
// anyway is dropped here. Nothing about the asker is kept: the origin only
// decides whether to count, as before.
// ---------------------------------------------------------------------------

/** The desktop app's page origins: Tauri serves its files as tauri://localhost (macOS, Linux) or http://tauri.localhost (Windows). */
export const DESKTOP_ORIGINS = ["tauri://localhost", "http://tauri.localhost"] as const;

/** Every origin the app's pages run at, besides the counter's own. */
export const APP_ORIGINS: readonly string[] = [new URL(BRAND.appUrl).origin, ...DESKTOP_ORIGINS];

/** The request's origin when it is one of the app's own (or the counter's, asking itself); otherwise null. */
export function allowedOrigin(request: Request, origins: readonly string[] = APP_ORIGINS): string | null {
  const origin = request.headers.get("origin");
  if (!origin) return null;
  if (origins.includes(origin)) return origin;
  const host = request.headers.get("host");
  try {
    return host && new URL(origin).host === host ? origin : null;
  } catch {
    return null; // "null" (a sandboxed frame, a file) or anything unparseable
  }
}

/** The answer's cross-site permission: the asker's own origin when allowed, never a wildcard, never credentials. */
function corsHeaders(origin: string | null): Record<string, string> {
  return origin ? { "Access-Control-Allow-Origin": origin, Vary: "Origin" } : { Vary: "Origin" };
}

const NO_STORE = { "Cache-Control": "no-store" };
const done = (origin: string | null = null) => new Response(null, { status: 204, headers: { ...NO_STORE, ...corsHeaders(origin) } });

/** The one header the count may carry beyond the safe ones: its JSON body's type. */
const COUNT_HEADERS = new Set(["content-type"]);

/**
 * OPTIONS /api/count: the browser's preflight before a cross-site count (the count is JSON, so the
 * browser asks first). Permission for POST with a Content-Type header, from the app's own origins
 * only, remembered for a day; anything else gets an answer without permission, so the browser
 * never sends the count.
 */
export function countPreflightHandler(origins: readonly string[] = APP_ORIGINS) {
  return (request: Request): Response => {
    const origin = allowedOrigin(request, origins);
    const method = request.headers.get("access-control-request-method");
    const asked = (request.headers.get("access-control-request-headers") ?? "")
      .split(",")
      .map((h) => h.trim().toLowerCase())
      .filter(Boolean);
    if (!origin || method !== "POST" || !asked.every((h) => COUNT_HEADERS.has(h))) return done();
    return new Response(null, {
      status: 204,
      headers: {
        ...NO_STORE,
        ...corsHeaders(origin),
        "Access-Control-Allow-Methods": "POST",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Max-Age": "86400",
      },
    });
  };
}

/**
 * POST /api/count: `{"first": true|false}` from one of the app's pages (allowedOrigin).
 * Always answers 204, so a page never waits on it or learns anything from it.
 */
export function countHandler(store: TractionStore | null, origins: readonly string[] = APP_ORIGINS) {
  return async (request: Request): Promise<Response> => {
    const origin = allowedOrigin(request, origins);
    if (store && origin) await count(store, request);
    return done(origin);
  };
}

/** Adds the visit when the request is a well-formed count from a real place; never throws. */
async function count(store: TractionStore, request: Request): Promise<void> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (!Number.isFinite(declared) || declared > 64) return;
  let first = false;
  try {
    const body = (await request.json()) as unknown;
    if (!body || typeof body !== "object" || typeof (body as { first?: unknown }).first !== "boolean") return;
    first = (body as { first: boolean }).first;
  } catch {
    return;
  }
  const country = countryOf(request);
  if (!country) return;
  try {
    await store.add(country, first);
  } catch {
    // the count is best effort; the page never hears about it
  }
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

/**
 * GET /api/traction: the published numbers, cached for a day at the edge once they are real.
 * Readable cross-site by the app's own origins only (a plain GET, so no preflight); the edge keeps
 * one copy per asking origin (`Vary: Origin`), each cached for the day.
 */
export function tractionHandler(store: TractionStore | null, origins: readonly string[] = APP_ORIGINS) {
  return async (request?: Request): Promise<Response> => {
    const raw = store ? await store.read().catch(() => null) : null;
    const status: Published["status"] = !store ? "off" : raw ? "counting" : "unavailable";
    const body = publish(raw ?? { visits: {}, visitors: {} }, MIN_VISITORS, status);
    const cache = status === "counting" ? `public, max-age=0, s-maxage=${PUBLISH_CACHE_S}, stale-while-revalidate=3600` : "no-store";
    const origin = request ? allowedOrigin(request, origins) : null;
    return Response.json(body, { headers: { "Cache-Control": cache, ...corsHeaders(origin) } });
  };
}
