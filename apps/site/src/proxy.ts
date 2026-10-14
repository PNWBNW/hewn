import { NextResponse, type NextRequest } from "next/server";
import { buildCsp, newNonce } from "@pnw/security/headers";

// Next.js reads the nonce from the request's CSP header and stamps it on the
// framework's own scripts and styles; anything without it is refused. The site
// names no extra origin: connect-src is 'self' and nothing else.
export function proxy(request: NextRequest) {
  const csp = buildCsp({ nonce: newNonce(), dev: process.env.NODE_ENV === "development" });

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
