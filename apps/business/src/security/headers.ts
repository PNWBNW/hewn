// ---------------------------------------------------------------------------
// The business app's browser security policy: the shared policy from
// @pnw/security, plus the one origin this app may talk to and WebAssembly
// for the rail's hashing library. See docs/THREAT_MODEL.md (T3).
// ---------------------------------------------------------------------------
import { buildCsp as buildSharedCsp, type CspOptions as SharedCspOptions } from "@pnw/security/headers";

export { SECURITY_HEADERS, newNonce } from "@pnw/security/headers";

/**
 * The public ledger explorer the rail reads from (registered names, team
 * agreements). The default mode never calls it: the only requests that go
 * there are lookups the user starts from Settings after linking an account.
 * It is the one host named in the policy.
 */
export const EXPLORER_ORIGIN = "https://api.explorer.provable.com";

export type CspOptions = Pick<SharedCspOptions, "nonce" | "dev">;

/**
 * 'wasm-unsafe-eval' lets the page compile WebAssembly (the rail's hashing library, loaded only
 * from the opt-in chain chunk) and nothing else: JS eval stays refused in production.
 */
export function buildCsp(options: CspOptions): string {
  return buildSharedCsp({ ...options, connect: [EXPLORER_ORIGIN], wasm: true });
}
