// ---------------------------------------------------------------------------
// The business app's browser security policy: the shared policy from
// @pnw/security, widened on exactly four pages. Settings, Payroll, the
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

/** The pages that host the rail panels (Connect Shield, Import team, Pay now, the Mailbox's check for a reply; a worker's offers, hours, paystubs and profile). */
export const RAIL_PATHS = ["/settings", "/payroll", "/mailbox", "/work"] as const;

export type CspOptions = Pick<SharedCspOptions, "nonce" | "dev"> & {
  /** The request path; decides whether the rail allowances apply. */
  path: string;
};

export function hostsRail(path: string): boolean {
  return RAIL_PATHS.some((p) => path === p || path.startsWith(`${p}/`));
}

/**
 * On rail pages: the explorer in connect-src and 'wasm-unsafe-eval' (the rail's hashing
 * library is WebAssembly; WASM compilation only, JS eval stays refused). Elsewhere: nothing.
 */
export function buildCsp({ path, ...options }: CspOptions): string {
  const rail = hostsRail(path);
  return buildSharedCsp({ ...options, connect: rail ? [EXPLORER_ORIGIN] : [], wasm: rail });
}
