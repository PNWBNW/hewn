import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { inlineScriptHashes, stampStaticCsp } from "./static_csp";
import { EXPLORER_ORIGIN, SHIELD_RELAY_ORIGIN, buildStaticCsp } from "./headers";

const page = (head: string, body: string) => `<!DOCTYPE html><html lang="en"><head>${head}</head><body>${body}</body></html>`;
const b64 = (s: string) => createHash("sha256").update(s).digest("base64");
const policy = (scriptHashes: string[]) => buildStaticCsp({ scriptHashes, apiOrigin: "https://app.example" });
const policyOf = (html: string) => /content="([^"]+)"/.exec(html)![1]!;

describe("the static bundle's policy", () => {
  const html = page('<script src="/_next/static/chunks/a.js" async=""></script>', '<script>(self.__next_f=self.__next_f||[]).push([0])</script><script>self.__next_f.push([1,"x"])</script>');

  it("names each inline script by digest, in order, and not the ones loaded by file", async () => {
    expect(await inlineScriptHashes(html)).toEqual([`sha256-${b64("(self.__next_f=self.__next_f||[]).push([0])")}`, `sha256-${b64('self.__next_f.push([1,"x"])')}`]);
  });

  it("stamps the policy first in <head>, with no nonce and no trust passing to other scripts", async () => {
    const stamped = await stampStaticCsp(html, policy);
    expect(stamped.startsWith('<!DOCTYPE html><html lang="en"><head><meta http-equiv="Content-Security-Policy" content="')).toBe(true);
    const csp = policyOf(stamped);
    const [first, second] = await inlineScriptHashes(html);
    expect(csp).not.toContain("nonce");
    expect(csp).not.toContain("strict-dynamic");
    expect(csp).not.toMatch(/'unsafe-inline'|'unsafe-eval'/);
    expect(csp).toContain(`script-src 'self' '${first}' '${second}' 'wasm-unsafe-eval';`);
    expect(csp).toContain("style-src 'self';");
  });

  it("lets the bundle reach the website's server pieces, the explorer and the Shield relay, nothing else", async () => {
    const csp = policyOf(await stampStaticCsp(html, policy));
    expect(csp).toContain(`connect-src 'self' https://app.example ${EXPLORER_ORIGIN} ${SHIELD_RELAY_ORIGIN};`);
    expect(csp.match(/(?:https?|wss?):\/\/[^\s;']+/g)).toEqual(["https://app.example", EXPLORER_ORIGIN, SHIELD_RELAY_ORIGIN]);
  });

  it("leaves out what a meta tag cannot carry, and keeps the rest", async () => {
    const csp = policyOf(await stampStaticCsp(html, policy));
    expect(csp).not.toContain("frame-ancestors");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-src 'none'");
    expect(csp).toContain("base-uri 'none'");
    expect(csp).toContain("upgrade-insecure-requests");
  });

  it("refuses a page it cannot make safe", async () => {
    await expect(stampStaticCsp(page("<style>b{}</style>", ""), policy)).rejects.toThrow(/inline style/);
    await expect(stampStaticCsp(await stampStaticCsp(html, policy), policy)).rejects.toThrow(/already/);
    await expect(stampStaticCsp("<html><body></body></html>", policy)).rejects.toThrow(/head/);
  });
});
