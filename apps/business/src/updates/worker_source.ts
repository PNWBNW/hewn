// The update worker as the bundle serves it (`sw.js`): worker.js with its CONFIG line on top.
// Written by scripts/update_worker.mjs after the static build; the tests build it the same way with
// a key made for the test. Nothing in it changes from one build of a commit to the next.
//
// Imports nothing, so plain Node runs it from the build script as it is.

/** Where the bundle serves the worker: at its root, so it covers every page. */
export const WORKER_FILE = "sw.js";

export type ReleaseKeyEntry = { readonly id: string; readonly publicKey: string };
export type Header = { readonly key: string; readonly value: string };

/**
 * The headers the worker adds to what it serves: the website's (SECURITY_HEADERS in
 * src/security/headers.ts), less Strict-Transport-Security, which a browser takes only from the
 * network.
 */
export function workerHeaders(headers: readonly Header[]): [string, string][] {
  return headers.filter((h) => h.key.toLowerCase() !== "strict-transport-security").map((h) => [h.key, h.value]);
}

/** The worker's text: one CONFIG line, then worker.js unchanged. */
export function workerScript(source: string, keys: readonly ReleaseKeyEntry[], headers: [string, string][]): string {
  if (!source.includes('self.addEventListener("fetch"')) throw new Error("that isn't the update worker's source");
  const config = { keys: keys.map(({ id, publicKey }) => ({ id, publicKey })), headers };
  return `const CONFIG = ${JSON.stringify(config)};\n${source}`;
}
