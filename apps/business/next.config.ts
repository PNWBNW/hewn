import type { NextConfig } from "next";
import { SECURITY_HEADERS } from "./src/security/headers";

const nextConfig: NextConfig = {
  transpilePackages: [
    "@pnw/brand", "@pnw/security", "@pnw/ui", "@pnw/ledger", "@pnw/vault", "@pnw/payroll", "@pnw/sales", "@pnw/tax-engine", "@pnw/mailbox",
    // Opt-in rail adaptor, reached only from src/chain.
    "@pnw/wallet", "@pnw/records", "@pnw/rail", "@pnw/config", "@pnw/commitments",
  ],
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
};

export default nextConfig;
