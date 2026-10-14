import { describe, expect, it } from "vitest";
import { EXPLORER_ORIGIN, RAIL_PATHS, SECURITY_HEADERS, buildCsp, hostsRail, newNonce } from "./headers";

const directives = (csp: string) =>
  Object.fromEntries(
    csp.split("; ").map((d) => {
      const [name, ...values] = d.split(" ");
      return [name!, values];
    }),
  );

describe("content security policy", () => {
  const books = directives(buildCsp({ nonce: "abc123", path: "/transactions" }));
  const rail = directives(buildCsp({ nonce: "abc123", path: "/payroll/run" }));

  it("only runs scripts carrying this request's nonce", () => {
    expect(books["script-src"]).toEqual(["'self'", "'nonce-abc123'", "'strict-dynamic'"]);
  });

  it("never allows inline or eval'd code in production", () => {
    for (const policy of [books, rail]) {
      const all = Object.values(policy).flat();
      expect(all).not.toContain("'unsafe-inline'");
      expect(all).not.toContain("'unsafe-eval'");
    }
  });

  it("allows eval only in dev, for React's debug stacks", () => {
    expect(directives(buildCsp({ nonce: "n", dev: true, path: "/" }))["script-src"]).toContain("'unsafe-eval'");
  });

  it("keeps the books pages on the strict policy: own origin only, no WebAssembly", () => {
    expect(books["connect-src"]).toEqual(["'self'"]);
    expect(books["script-src"]).not.toContain("'wasm-unsafe-eval'");
    expect(buildCsp({ nonce: "n", path: "/" }).match(/https?:\/\/[^\s;]+/g)).toBeNull();
  });

  it("widens exactly the two rail pages: the explorer and WebAssembly compilation", () => {
    expect(RAIL_PATHS).toEqual(["/settings", "/payroll"]);
    expect(rail["connect-src"]).toEqual(["'self'", EXPLORER_ORIGIN]);
    expect(rail["script-src"]).toEqual(["'self'", "'nonce-abc123'", "'strict-dynamic'", "'wasm-unsafe-eval'"]);
    expect(rail["default-src"]).toEqual(["'self'"]);
  });

  it("matches rail pages by path segment, not prefix", () => {
    for (const p of ["/settings", "/payroll", "/payroll/run", "/settings/"]) expect(hostsRail(p)).toBe(true);
    for (const p of ["/", "/payrolls", "/settingsx", "/sales", "/transactions/new"]) expect(hostsRail(p)).toBe(false);
  });

  it("blocks plugins, framing and base-tag hijacks everywhere", () => {
    for (const policy of [books, rail]) {
      expect(policy["object-src"]).toEqual(["'none'"]);
      expect(policy["frame-src"]).toEqual(["'none'"]);
      expect(policy["frame-ancestors"]).toEqual(["'none'"]);
      expect(policy["base-uri"]).toEqual(["'none'"]);
    }
  });

  it("names the explorer once, in connect-src, and no other host anywhere", () => {
    expect(EXPLORER_ORIGIN).toMatch(/^https:\/\/[a-z.]+$/);
    expect(buildCsp({ nonce: "n", path: "/settings" }).match(/https?:\/\/[^\s;]+/g)).toEqual([EXPLORER_ORIGIN]);
  });
});

describe("nonce", () => {
  it("is 128 random bits and fresh each time", () => {
    const a = newNonce();
    expect(atob(a)).toHaveLength(16);
    expect(newNonce()).not.toBe(a);
  });
});

describe("static headers", () => {
  const h = Object.fromEntries(SECURITY_HEADERS.map(({ key, value }) => [key, value]));

  it("stop MIME sniffing, framing and referrer leaks", () => {
    expect(h["X-Content-Type-Options"]).toBe("nosniff");
    expect(h["X-Frame-Options"]).toBe("DENY");
    expect(h["Referrer-Policy"]).toBe("no-referrer");
  });

  it("turn off device APIs the app doesn't use", () => {
    for (const api of ["camera", "microphone", "geolocation", "payment"]) {
      expect(h["Permissions-Policy"]).toContain(`${api}=()`);
    }
  });
});
