import type { NextConfig } from "next";
import { SECURITY_HEADERS } from "./src/security/headers";

/**
 * Two builds from one app (2026-10-19):
 *
 * - The website (default): served by Next.js with the one server piece (the
 *   traction counter: the visit count and the published numbers) and the
 *   per-request security policy in `src/proxy.ts`.
 * - The static bundle (`HEWN_STATIC=1`): plain files, served from GitHub Pages
 *   on the app's domain (.github/workflows/pages.yml) or carried by the
 *   desktop app, which reach the counter by full address (`BRAND.counterUrl`,
 *   `src/api_base.ts`). Server-only files end in `.server.ts`,
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
  // The client bundle reads this to find the counter (src/api_base.ts).
  // The build's commit (Vercel's, or GitHub Actions' for Pages), shown small while the books open, so a stuck screen says which version it is.
  env: { NEXT_PUBLIC_HEWN_STATIC: STATIC ? "1" : "", NEXT_PUBLIC_HEWN_BUILD: (process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.GITHUB_SHA ?? "").slice(0, 7) },
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
