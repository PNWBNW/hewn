// ---------------------------------------------------------------------------
// Browser security policy for the business app.
//
// The CSP is the backstop for the threat model's biggest risk: injected code
// in the page. Scripts only run if served by us with this request's nonce,
// and the page may only talk to its own origin. In the default mode there is no
// legitimate third-party endpoint, so a compromise has nowhere to send data.
// See docs/THREAT_MODEL.md (T3).
// ---------------------------------------------------------------------------

/**
 * The public ledger explorer the rail reads from (registered names, team
 * agreements). The default mode never calls it: the only requests that go
 * there are lookups the user starts from Settings after linking an account.
 * It is the one host named in the policy.
 */
export const EXPLORER_ORIGIN = "https://api.explorer.provable.com";

export type CspOptions = {
  nonce: string;
  /** Next.js dev mode needs eval for React's debug stacks. Never in production. */
  dev?: boolean;
};

export function buildCsp({ nonce, dev = false }: CspOptions): string {
  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    "script-src": ["'self'", `'nonce-${nonce}'`, "'strict-dynamic'", ...(dev ? ["'unsafe-eval'"] : [])],
    "style-src": ["'self'", `'nonce-${nonce}'`],
    "img-src": ["'self'", "blob:", "data:"],
    "font-src": ["'self'"],
    // Own origin plus the explorer: no analytics, no CDNs, nothing else.
    "connect-src": ["'self'", EXPLORER_ORIGIN],
    "worker-src": ["'self'"],
    "manifest-src": ["'self'"],
    "object-src": ["'none'"],
    "frame-src": ["'none'"],
    "base-uri": ["'none'"],
    "form-action": ["'self'"],
    "frame-ancestors": ["'none'"],
  };
  const policy = Object.entries(directives).map(([k, v]) => `${k} ${v.join(" ")}`);
  if (!dev) policy.push("upgrade-insecure-requests");
  return policy.join("; ");
}

/** Static headers for every response, including assets. */
export const SECURITY_HEADERS: { key: string; value: string }[] = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  {
    key: "Permissions-Policy",
    value: [
      "camera=()", "microphone=()", "geolocation=()", "payment=()", "usb=()",
      "serial=()", "bluetooth=()", "hid=()", "interest-cohort=()",
    ].join(", "),
  },
];

/** 128 random bits, base64. Fresh for every request. */
export function newNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}
