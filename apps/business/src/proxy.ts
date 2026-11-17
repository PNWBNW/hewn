import { NextResponse, type NextRequest } from "next/server";
import { offCounterPath } from "@/security/counter_host";
import { buildCsp, newNonce } from "@/security/headers";

// Next.js reads the nonce from the request's CSP header and stamps it on the
// framework's own scripts and styles; anything without it is refused.
export function proxy(request: NextRequest) {
  // On the traction counter's own address, only the counter answers (security/counter_host.ts).
  if (offCounterPath(request.headers.get("host"), request.nextUrl.pathname)) {
    return new NextResponse(null, { status: 404, headers: { "Cache-Control": "no-store" } });
  }

  const csp = buildCsp({
    nonce: newNonce(),
    dev: process.env.NODE_ENV === "development",
  });

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("Content-Security-Policy", csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: [
    {
      source: "/((?!_next/static|_next/image|favicon.ico).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
