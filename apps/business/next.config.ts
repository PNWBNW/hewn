import type { NextConfig } from "next";
import { SECURITY_HEADERS } from "./src/security/headers";

const nextConfig: NextConfig = {
  transpilePackages: ["@pnw/ui", "@pnw/ledger", "@pnw/vault", "@pnw/payroll", "@pnw/sales", "@pnw/tax-engine"],
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
};

export default nextConfig;
