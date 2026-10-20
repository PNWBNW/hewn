// The traction store on Upstash ("Upstash for Redis" from the Vercel marketplace,
// not the Redis Cloud listing, which has no REST API),
// over its REST API with fetch: no client library. Two hashes, one field per
// country (counts.ts). The URL and key come from the environment, under
// either name the Vercel integration uses, or with the prefix Vercel lets you
// choose when connecting a store (`STORAGE_KV_REST_API_URL`, say).

import { type TractionStore, VISITORS_KEY, VISITS_KEY } from "./counts";

type Env = Record<string, string | undefined>;

/** The store's address and key: the usual names first, else one prefixed pair (the same prefix on both). */
export function storeSettings(env: Env): { url: string; key: string } | null {
  const url = env.KV_REST_API_URL ?? env.UPSTASH_REDIS_REST_URL;
  const key = env.KV_REST_API_TOKEN ?? env.UPSTASH_REDIS_REST_TOKEN;
  if (url && key) return { url, key };
  for (const [name, value] of Object.entries(env)) {
    const m = /^(.+_)(KV_REST_API|REST_API|UPSTASH_REDIS_REST)_URL$/.exec(name);
    const secret = m ? env[`${m[1]}${m[2]}_TOKEN`] : undefined;
    if (value && secret) return { url: value, key: secret };
  }
  return null;
}

export function upstashStore(env: Env = process.env, fetchImpl: typeof fetch = fetch): TractionStore | null {
  const settings = storeSettings(env);
  if (!settings) return null;
  const { url, key } = settings;
  const call = async (path: string, body: unknown): Promise<unknown> => {
    const res = await fetchImpl(`${url.replace(/\/$/, "")}${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5_000),
      cache: "no-store",
    });
    if (!res.ok) throw new Error("traction store unavailable");
    return res.json();
  };
  const toCounts = (flat: unknown): Record<string, number> => {
    const out: Record<string, number> = {};
    if (Array.isArray(flat)) for (let i = 0; i + 1 < flat.length; i += 2) out[String(flat[i])] = Number(flat[i + 1]);
    return out;
  };
  return {
    async add(country, firstVisit) {
      const cmds: unknown[][] = [["HINCRBY", VISITS_KEY, country, 1]];
      if (firstVisit) cmds.push(["HINCRBY", VISITORS_KEY, country, 1]);
      await call("/pipeline", cmds);
    },
    async read() {
      const out = (await call("/pipeline", [["HGETALL", VISITS_KEY], ["HGETALL", VISITORS_KEY]])) as { result?: unknown }[];
      return { visits: toCounts(out[0]?.result), visitors: toCounts(out[1]?.result) };
    },
  };
}
