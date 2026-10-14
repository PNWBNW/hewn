// The one network door: GET against the explorer. The business app's CSP
// allows exactly this origin, and only the rail code ever uses it.

import { ENV } from "@pnw/config/env";
import { type RailNetwork, RailNetworkError } from "./types";

const TIMEOUT_MS = 15_000;

/** A RailNetwork over `fetch` against `ENV.ALEO_ENDPOINT` (or the endpoint given). */
export function explorerNetwork(endpoint: string = ENV.ALEO_ENDPOINT, fetchImpl: typeof fetch = fetch): RailNetwork {
  const base = endpoint.replace(/\/+$/, "");
  return {
    async fetchJson(path: string): Promise<unknown> {
      const response = await fetchImpl(`${base}/${path.replace(/^\/+/, "")}`, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!response.ok) throw new RailNetworkError(`The network answered ${response.status}`, response.status);
      // Mapping values come back as a bare JSON string ("12u32"), transactions as objects.
      return response.json();
    },
  };
}

/** True when the failure was the explorer saying "no such thing" (a missing mapping key, an unindexed transaction). */
export const isNotFound = (e: unknown): boolean => e instanceof RailNetworkError && e.status === 404;
