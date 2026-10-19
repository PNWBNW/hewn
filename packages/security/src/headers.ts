// ---------------------------------------------------------------------------
// Browser security policy shared by the app and the site.
//
// The CSP is the backstop for the threat model's biggest risk: injected code
// in the page. Scripts only run if served by us with this request's nonce,
// and the page may only talk to its own origin, plus whatever an app opts
// into through `connect` (the site opts into nothing). See
// docs/THREAT_MODEL.md (T3).
// ---------------------------------------------------------------------------

export type CspOptions = {
  /** This request's nonce: the website's way. Scripts and styles run only when they carry it. */
  nonce?: string;
  /**
   * The static bundle's way (no server, so no nonce): the SHA-256 digests, `sha256-…`, of the
   * inline scripts the exported page carries, so exactly those run and nothing else inline.
   * Scripts by file then come from the page's own origin alone, as there is no nonce to pass
   * trust along ('strict-dynamic' needs one).
   */
  scriptHashes?: readonly string[];
  /**
   * The policy is stamped into the page as a meta tag rather than sent as a header. Browsers
   * ignore `frame-ancestors` there (and say so on the console), so it is left out; the app's
   * pages are never framed anyway, and the website still sends it as a header.
   */
  meta?: boolean;
  /** Next.js dev mode needs eval for React's debug stacks. Never in production. */
  dev?: boolean;
  /** Origins the page may fetch from besides its own. Default: none. */
  connect?: readonly string[];
  /**
   * Let the page compile WebAssembly ('wasm-unsafe-eval'): WASM compilation only; JS eval
   * stays refused. Default: off.
   */
  wasm?: boolean;
};

export function buildCsp({ nonce, scriptHashes, meta = false, dev = false, connect = [], wasm = false }: CspOptions): string {
  if (nonce === undefined && scriptHashes === undefined) throw new Error("a policy needs a nonce or the inline script hashes");
  const inline = nonce !== undefined ? [`'nonce-${nonce}'`, "'strict-dynamic'"] : scriptHashes!.map((h) => `'${h}'`);
  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    "script-src": [
      "'self'",
      ...inline,
      ...(wasm ? ["'wasm-unsafe-eval'"] : []),
      ...(dev ? ["'unsafe-eval'"] : []),
    ],
    "style-src": ["'self'", ...(nonce !== undefined ? [`'nonce-${nonce}'`] : [])],
    "img-src": ["'self'", "blob:", "data:"],
    "font-src": ["'self'"],
    // Own origin plus what the app named: no analytics, no CDNs, nothing else.
    "connect-src": ["'self'", ...connect],
    "worker-src": ["'self'"],
    "manifest-src": ["'self'"],
    "object-src": ["'none'"],
    "frame-src": ["'none'"],
    "base-uri": ["'none'"],
    "form-action": ["'self'"],
    ...(meta ? {} : { "frame-ancestors": ["'none'"] }),
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
