import { describe, expect, it } from "vitest";
import { EXPLORER_ORIGIN, SECURITY_HEADERS, buildCsp, newNonce } from "./headers";

const directives = (csp: string) =>
  Object.fromEntries(
    csp.split("; ").map((d) => {
      const [name, ...values] = d.split(" ");
      return [name!, values];
    }),
  );

describe("content security policy", () => {
  const prod = directives(buildCsp({ nonce: "abc123" }));

  it("only runs scripts carrying this request's nonce", () => {
    expect(prod["script-src"]).toEqual(["'self'", "'nonce-abc123'", "'strict-dynamic'", "'wasm-unsafe-eval'"]);
  });

  it("never allows inline or eval'd code in production", () => {
    const all = Object.values(prod).flat();
    expect(all).not.toContain("'unsafe-inline'");
    expect(all).not.toContain("'unsafe-eval'");
  });

  it("allows eval only in dev, for React's debug stacks", () => {
    expect(directives(buildCsp({ nonce: "n", dev: true }))["script-src"]).toContain("'unsafe-eval'");
  });

  it("lets the page talk to its own origin and the explorer, nothing else", () => {
    expect(prod["connect-src"]).toEqual(["'self'", EXPLORER_ORIGIN]);
    expect(prod["default-src"]).toEqual(["'self'"]);
  });

  it("blocks plugins, framing and base-tag hijacks", () => {
    expect(prod["object-src"]).toEqual(["'none'"]);
    expect(prod["frame-src"]).toEqual(["'none'"]);
    expect(prod["frame-ancestors"]).toEqual(["'none'"]);
    expect(prod["base-uri"]).toEqual(["'none'"]);
  });

  it("names the explorer once, in connect-src, and no other host anywhere", () => {
    expect(EXPLORER_ORIGIN).toMatch(/^https:\/\/[a-z.]+$/);
    expect(buildCsp({ nonce: "n" }).match(/https?:\/\/[^\s;]+/g)).toEqual([EXPLORER_ORIGIN]);
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
