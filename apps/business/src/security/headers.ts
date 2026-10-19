// ---------------------------------------------------------------------------
// The business app's browser security policy: the shared policy from
// @pnw/security, widened the same way on every page of the app. See
// docs/THREAT_MODEL.md (T3).
//
// One policy for the whole app (Joshua, 2026-10-15). A page's policy is fixed
// when the document loads, and moving between pages inside the app keeps it,
// so a per-page policy really meant "whichever page was opened first". Opened
// at the dashboard and then tapping to Settings, the Shield code was blocked.
// A fresh load would apply the right one but locks the books (the unlocked
// session lives in memory only). So every page carries the same two
// allowances; everything else stays as strict as the marketing site.
// ---------------------------------------------------------------------------
import { buildCsp as buildSharedCsp, type CspOptions as SharedCspOptions } from "@pnw/security/headers";

export { SECURITY_HEADERS, newNonce } from "@pnw/security/headers";

/**
 * The public ledger explorer the app reads from (registered names, balances, team agreements,
 * transfer confirmations, past transactions). Read-only, and the one host named in the policy.
 */
export const EXPLORER_ORIGIN = "https://api.explorer.provable.com";

/**
 * Shield's relay: how a plain phone browser reaches the Shield app (2026-10-19). The page and the
 * app exchange sealed messages through it; the relay forwards ciphertext and sees the page's
 * origin and timing, nothing inside. The chain code pins the same origin where it sets the Shield
 * adapter up (`SHIELD_RELAY_ORIGIN` in its provider module), so it can only ever dial what this
 * policy allows.
 */
export const SHIELD_RELAY_ORIGIN = "wss://relay.shield.app";

export type CspOptions = { nonce: string } & Pick<SharedCspOptions, "dev">;

const CONNECT = [EXPLORER_ORIGIN, SHIELD_RELAY_ORIGIN];

/**
 * The website's policy, one per request: the explorer and the Shield relay in connect-src, and
 * 'wasm-unsafe-eval' (the Shield code's hashing and decryption libraries are WebAssembly; this
 * allows compiling WebAssembly only, JS eval stays refused).
 */
export function buildCsp(options: CspOptions): string {
  return buildSharedCsp({ ...options, connect: CONNECT, wasm: true });
}

/**
 * The static bundle's policy, one per exported page (`scripts/static_csp.ts` stamps it in as a
 * meta tag): the same allowances, with the page's inline scripts named by hash instead of a
 * nonce, plus the website itself, where the bundle reaches the server pieces (src/api_base.ts).
 */
export function buildStaticCsp({ scriptHashes, apiOrigin }: { scriptHashes: readonly string[]; apiOrigin: string }): string {
  return buildSharedCsp({ scriptHashes, meta: true, connect: [apiOrigin, ...CONNECT], wasm: true });
}
