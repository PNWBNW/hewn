// Stamping the static bundle's security policy into an exported page.
//
// The website sends its policy as a header with a fresh nonce per request
// (src/proxy.ts). The static bundle is plain files, so each page carries its
// policy in a meta tag instead, naming by digest the inline scripts Next.js
// wrote into that page (its hydration payload: two short scripts) so exactly
// those run. Anything else inline, injected later, is refused as on the site.
//
// Digests come from the browser's own WebCrypto, which Node has too, so the
// build script (scripts/static_csp.mjs) runs this file as it is.

const INLINE_SCRIPT = /<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/g;
const INLINE_STYLE = /<style[^>]*>/;
const META = /<meta http-equiv="Content-Security-Policy"/;

/** `sha256-…` for each inline script in the page, in order, as the browser will compute it. */
export async function inlineScriptHashes(html: string): Promise<string[]> {
  const bodies = [...html.matchAll(INLINE_SCRIPT)].map(([, body]) => body!);
  return Promise.all(
    bodies.map(async (body) => {
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body));
      return `sha256-${btoa(String.fromCharCode(...new Uint8Array(digest)))}`;
    }),
  );
}

/**
 * The page with its policy stamped in, first thing in `<head>` so it governs everything after.
 * `policy` turns the page's script digests into the policy text (`buildStaticCsp` in headers.ts).
 * Refuses a page it cannot make safe: one with an inline style (nothing names those) or one
 * already stamped (two policies combine as the stricter, which is not what anyone meant).
 */
export async function stampStaticCsp(html: string, policy: (scriptHashes: string[]) => string): Promise<string> {
  if (INLINE_STYLE.test(html)) throw new Error("the page carries an inline style, which the static policy cannot name");
  if (META.test(html)) throw new Error("the page already carries a policy");
  const head = html.indexOf("<head>");
  if (head < 0) throw new Error("no <head> in the page");
  const tag = `<meta http-equiv="Content-Security-Policy" content="${policy(await inlineScriptHashes(html))}"/>`;
  return html.slice(0, head + "<head>".length) + tag + html.slice(head + "<head>".length);
}
