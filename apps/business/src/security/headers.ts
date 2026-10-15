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

export type CspOptions = Pick<SharedCspOptions, "nonce" | "dev">;

/**
 * The explorer in connect-src, and 'wasm-unsafe-eval' (the Shield code's hashing and decryption
 * libraries are WebAssembly; this allows compiling WebAssembly only, JS eval stays refused).
 */
export function buildCsp(options: CspOptions): string {
  return buildSharedCsp({ ...options, connect: [EXPLORER_ORIGIN], wasm: true });
}
