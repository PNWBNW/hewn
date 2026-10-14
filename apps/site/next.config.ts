import type { NextConfig } from "next";
import { SECURITY_HEADERS } from "@pnw/security/headers";

const nextConfig: NextConfig = {
  transpilePackages: ["@pnw/brand", "@pnw/security", "@pnw/ui"],
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
};

export default nextConfig;
