import { describe, expect, it } from "vitest";
import { EXPLORER_ORIGIN, SECURITY_HEADERS, SHIELD_RELAY_ORIGIN, buildCsp, newNonce } from "./headers";

const directives = (csp: string) =>
  Object.fromEntries(
    csp.split("; ").map((d) => {
      const [name, ...values] = d.split(" ");
      return [name!, values];
    }),
  );

describe("content security policy", () => {
  const policy = directives(buildCsp({ nonce: "abc123" }));

  it("only runs scripts carrying this request's nonce, and may compile WebAssembly", () => {
    expect(policy["script-src"]).toEqual(["'self'", "'nonce-abc123'", "'strict-dynamic'", "'wasm-unsafe-eval'"]);
  });

  it("never allows inline or eval'd code in production", () => {
    const all = Object.values(policy).flat();
    expect(all).not.toContain("'unsafe-inline'");
    expect(all).not.toContain("'unsafe-eval'");
  });

  it("allows eval only in dev, for React's debug stacks", () => {
    expect(directives(buildCsp({ nonce: "n", dev: true }))["script-src"]).toContain("'unsafe-eval'");
  });

  it("talks to its own origin, the explorer and the Shield relay, nothing else", () => {
    expect(policy["connect-src"]).toEqual(["'self'", EXPLORER_ORIGIN, SHIELD_RELAY_ORIGIN]);
    expect(policy["default-src"]).toEqual(["'self'"]);
  });

  it("blocks plugins, framing and base-tag hijacks", () => {
    expect(policy["object-src"]).toEqual(["'none'"]);
    expect(policy["frame-src"]).toEqual(["'none'"]);
    expect(policy["frame-ancestors"]).toEqual(["'none'"]);
    expect(policy["base-uri"]).toEqual(["'none'"]);
  });

  it("names the explorer and the relay once each, in connect-src, and no other host anywhere", () => {
    expect(EXPLORER_ORIGIN).toMatch(/^https:\/\/[a-z.]+$/);
    // Secure websocket only: the relay is never reached over a plain or an http(s) URL.
    expect(SHIELD_RELAY_ORIGIN).toMatch(/^wss:\/\/[a-z.]+$/);
    expect(buildCsp({ nonce: "n" }).match(/(?:https?|wss?):\/\/[^\s;]+/g)).toEqual([EXPLORER_ORIGIN, SHIELD_RELAY_ORIGIN]);
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
