import type { NextConfig } from "next";
import { SECURITY_HEADERS } from "./src/security/headers";

/**
 * Two builds from one app (2026-10-19):
 *
 * - The website (default): served by Next.js with the server pieces (the
 *   mailbox courier, the visit counter, the traction feed) and the per-request
 *   security policy in `src/proxy.ts`.
 * - The static bundle (`HEWN_STATIC=1`): plain files for the installable app,
 *   which carries the screens and reaches the server pieces on the website by
 *   full address (`src/api_base.ts`). Server-only files end in `.server.ts`,
 *   an extension only the website build looks at, so the static build never
 *   sees a route handler or the proxy; its security policy is stamped into
 *   each page after the export (`scripts/static_csp.ts`).
 */
const STATIC = process.env.HEWN_STATIC === "1";

const nextConfig: NextConfig = {
  transpilePackages: [
    "@pnw/brand", "@pnw/security", "@pnw/ui", "@pnw/ledger", "@pnw/vault", "@pnw/payroll", "@pnw/sales", "@pnw/tax-engine", "@pnw/mailbox",
    // Opt-in rail adaptor, reached only from src/chain.
    "@pnw/wallet", "@pnw/records", "@pnw/rail", "@pnw/config", "@pnw/commitments", "@pnw/handshake",
  ],
  poweredByHeader: false,
  // The client bundle reads this to find the server pieces (src/api_base.ts).
  env: { NEXT_PUBLIC_HEWN_STATIC: STATIC ? "1" : "" },
  pageExtensions: STATIC ? ["tsx", "ts"] : ["server.tsx", "server.ts", "tsx", "ts"],
  ...(STATIC
    ? {
        output: "export",
        // Every page is a folder with an index.html, so a plain file server (the app's) finds it.
        trailingSlash: true,
        images: { unoptimized: true },
      }
    : {
        async headers() {
          return [{ source: "/:path*", headers: SECURITY_HEADERS }];
        },
      }),
};

export default nextConfig;
