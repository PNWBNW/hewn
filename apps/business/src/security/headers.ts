// ---------------------------------------------------------------------------
// The business app's browser security policy: the shared policy from
// @pnw/security, widened on exactly four pages (and, for the explorer alone, three more). Settings, Payroll, the
// Mailbox and the worker's /work pages are where the opt-in rail code is
// loaded, so only they may talk to the explorer and compile WebAssembly; every other page
// keeps the strict policy the site uses. See docs/THREAT_MODEL.md (T3).
// ---------------------------------------------------------------------------
import { buildCsp as buildSharedCsp, type CspOptions as SharedCspOptions } from "@pnw/security/headers";

export { SECURITY_HEADERS, newNonce } from "@pnw/security/headers";

/**
 * The public ledger explorer the rail reads from (registered names, team
 * agreements, transfer confirmations). The default mode never calls it: the
 * only requests that go there are ones the user starts from Settings or
 * Payroll after linking an account. It is the one host named in the policy.
 */
export const EXPLORER_ORIGIN = "https://api.explorer.provable.com";

/**
 * The pages that only read public data from the explorer: a registered name looked up on a
 * customer's or a vendor's form, and the dashboard's balances of the linked account (its public
 * balances from the explorer; the private ones come through Shield, which needs no allowance).
 * These pages may talk to the explorer, and nothing more: no WebAssembly. `/` is the dashboard
 * alone; no other page matches it.
 */
export const LOOKUP_PATHS = ["/", "/sales", "/expenses"] as const;

/** The pages that host the rail panels (Connect Shield, Import team, Pay now, the Mailbox's check for a reply; a worker's offers, hours, paystubs and profile). */
export const RAIL_PATHS = ["/settings", "/payroll", "/mailbox", "/work"] as const;

export type CspOptions = Pick<SharedCspOptions, "nonce" | "dev"> & {
  /** The request path; decides whether the rail allowances apply. */
  path: string;
};

const under = (paths: readonly string[], path: string) => paths.some((p) => path === p || path.startsWith(`${p}/`));

export function hostsRail(path: string): boolean {
  return under(RAIL_PATHS, path);
}

export function hostsLookup(path: string): boolean {
  return under(LOOKUP_PATHS, path);
}

/**
 * On rail pages: the explorer in connect-src and 'wasm-unsafe-eval' (the rail's hashing
 * library is WebAssembly; WASM compilation only, JS eval stays refused). On lookup pages: the
 * explorer alone. Elsewhere: nothing.
 */
export function buildCsp({ path, ...options }: CspOptions): string {
  const rail = hostsRail(path);
  return buildSharedCsp({ ...options, connect: rail || hostsLookup(path) ? [EXPLORER_ORIGIN] : [], wasm: rail });
}
