// The traction store on Upstash Redis (added through the Vercel marketplace),
// over its REST API with fetch: no client library. Two hashes, one field per
// country (counts.ts). The URL and key come from the environment, under
// either name the Vercel integration uses.

import { type TractionStore, VISITORS_KEY, VISITS_KEY } from "./counts";

type Env = Record<string, string | undefined>;

export function upstashStore(env: Env = process.env, fetchImpl: typeof fetch = fetch): TractionStore | null {
  const url = env.KV_REST_API_URL ?? env.UPSTASH_REDIS_REST_URL;
  const key = env.KV_REST_API_TOKEN ?? env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !key) return null;
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
