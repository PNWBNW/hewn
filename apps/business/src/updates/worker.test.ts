// The update worker (worker.js) against a simulated browser: a host of files, the Cache Storage
// API, and the install, activate, fetch and message events. Each test makes its own release key;
// none is kept. The same worker in a real browser: test/worker (`test:worker`).

import { execFileSync } from "node:child_process";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SECURITY_HEADERS } from "@/security/headers";
import { parseRetired, retireMessage, RETIRED_FILE } from "./retire";
import { workerHeaders, workerScript, type ReleaseKeyEntry } from "./worker_source";

const SOURCE = readFileSync(new URL("./worker.js", import.meta.url), "utf8");
const ORIGIN = "https://app.example.test";
const sha = (data: string | Uint8Array) => createHash("sha256").update(data).digest("hex");
const POLICY = "default-src 'self'; script-src 'self' 'sha256-abc'";

// ---------------------------------------------------------------------------
// Keys and releases.
// ---------------------------------------------------------------------------

function releaseKey() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const raw = Buffer.from(publicKey.export({ format: "jwk" }).x!, "base64url");
  const entry: ReleaseKeyEntry = { id: sha(raw).slice(0, 16), publicKey: raw.toString("base64") };
  const signs = (message: Uint8Array) => sign(null, message, privateKey).toString("base64");
  return { entry, signs, privateKey };
}
type Key = ReturnType<typeof releaseKey>;

type Files = Record<string, string>;
const page = (title: string) => `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="${POLICY}"/></head><body>${title}</body></html>`;

const canonical = (files: Record<string, string>) =>
  "{" + Object.keys(files).sort().map((p) => `${JSON.stringify(p)}:${JSON.stringify(files[p])}`).join(",") + "}";

/** release.json and (when a key is given) release.sig for `files`, as the release scripts write them. */
function release(files: Files, { version = "v1.0", created = "2026-11-17", key }: { version?: string; created?: string; key?: Key } = {}) {
  const hashes: Record<string, string> = {};
  for (const p of Object.keys(files).sort()) hashes[p] = sha(files[p]!);
  const digest = sha(canonical(hashes));
  const out: Files = {
    ...files,
    "release.json": JSON.stringify({ version, commit: "a".repeat(40), created, files: hashes, digest }),
  };
  if (key) out["release.sig"] = JSON.stringify({ key: key.entry.id, sig: key.signs(Buffer.from(digest, "hex")) });
  return { files: out, digest };
}

const retirement = (digest: string, key: Key) => ({ digest, key: key.entry.id, sig: key.signs(retireMessage(digest)) });

const BUNDLE: Files = {
  "index.html": page("home v1"),
  "terms/index.html": page("terms v1"),
  "404.html": page("not found"),
  "_next/static/app-1.js": "console.log('v1')",
  "brand/mark.png": "\u0089PNG",
  "sw.js": "// the worker, listed like any file of the bundle",
};

// ---------------------------------------------------------------------------
// The simulated browser.
// ---------------------------------------------------------------------------

class FakeCache {
  readonly entries = new Map<string, ArrayBuffer>();
  async match(url: string) {
    const body = this.entries.get(url);
    return body ? new Response(body.slice(0)) : undefined;
  }
  async put(url: string, res: Response) {
    this.entries.set(url, await res.arrayBuffer());
  }
  async delete(url: string) {
    return this.entries.delete(url);
  }
}

class FakeCaches {
  readonly stores = new Map<string, FakeCache>();
  async open(name: string) {
    if (!this.stores.has(name)) this.stores.set(name, new FakeCache());
    return this.stores.get(name)!;
  }
  async keys() {
    return [...this.stores.keys()];
  }
  async delete(name: string) {
    return this.stores.delete(name);
  }
}

type Req = { method: string; url: string; mode: string };
type Listener = (event: Record<string, unknown>) => void;

/** A host serving `files` and a device with one worker built for `keys`, sharing `caches` with any later worker. */
function device(keys: ReleaseKeyEntry[], host: Files, caches = new FakeCaches()) {
  const fetched: string[] = [];
  const fetch = async (input: string | Req) => {
    const url = new URL(typeof input === "string" ? input : input.url);
    const path = decodeURIComponent(url.pathname).replace(/^\/+/, "");
    fetched.push(path);
    const body = host[path] ?? (host[`${path}index.html`] !== undefined ? host[`${path}index.html`] : undefined);
    if (url.origin !== ORIGIN || body === undefined) return new Response("missing", { status: 404 });
    const res = new Response(body, { headers: { "Content-Type": path.endsWith(".html") || path === "" ? "text/html" : "text/plain" } });
    Object.defineProperty(res, "type", { value: "basic" });
    return res;
  };
  const listeners: Record<string, Listener> = {};
  const self = {
    location: new URL(`${ORIGIN}/sw.js`),
    registration: { scope: `${ORIGIN}/` },
    clients: { claim: async () => undefined },
    addEventListener: (type: string, fn: Listener) => {
      listeners[type] = fn;
    },
  };
  new Function("self", "caches", "fetch", workerScript(SOURCE, keys, workerHeaders(SECURITY_HEADERS)))(self, caches, fetch);

  async function extendable(type: string, extra: Record<string, unknown> = {}) {
    const waits: Promise<unknown>[] = [];
    let response: Promise<Response> | undefined;
    listeners[type]!({ ...extra, waitUntil: (p: Promise<unknown>) => waits.push(p), respondWith: (p: Promise<Response>) => (response = p) });
    const res = response ? await response : undefined;
    await Promise.all(waits);
    return res;
  }

  return {
    caches,
    fetched,
    install: () => extendable("install"),
    activate: () => extendable("activate"),
    get: (path: string, { mode = "no-cors", method = "GET", origin = ORIGIN } = {}) => extendable("fetch", { request: { method, url: `${origin}${path}`, mode } }),
    open: (path: string) => extendable("fetch", { request: { method: "GET", url: `${ORIGIN}${path}`, mode: "navigate" } }),
    check: () => extendable("message", { data: { type: "check" } }),
    async status() {
      let answer: unknown;
      await extendable("message", { data: { type: "status" }, ports: [{ postMessage: (m: unknown) => (answer = m) }] });
      return answer as { version: string | null; digest: string | null; withdrawn: boolean; problem: string | null };
    },
  };
}

const text = async (res: Response | undefined) => (res ? res.text() : undefined);

// ---------------------------------------------------------------------------

describe("a signed release", () => {
  it("is taken at install, every file checked, and served from the device with the security headers", async () => {
    const key = releaseKey();
    const r = release(BUNDLE, { key });
    const d = device([key.entry], r.files);
    await d.install();
    await d.activate();
    expect(await d.status()).toMatchObject({ version: "v1.0", digest: r.digest, problem: null, withdrawn: false });

    d.fetched.length = 0;
    const res = await d.open("/");
    expect(await text(res)).toBe(BUNDLE["index.html"]);
    expect(d.fetched).toEqual([]); // from the device, not the host
    expect(res!.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
    expect(res!.headers.get("Content-Security-Policy")).toBe(`${POLICY}; frame-ancestors 'none'`);
    expect(res!.headers.get("X-Frame-Options")).toBe("DENY");
    expect(res!.headers.get("Permissions-Policy")).toContain("camera=()");
    expect(res!.headers.get("Strict-Transport-Security")).toBeNull();

    const script = await d.get("/_next/static/app-1.js");
    expect(await text(script)).toBe(BUNDLE["_next/static/app-1.js"]);
    expect(script!.headers.get("Content-Type")).toBe("text/javascript; charset=utf-8");
    expect(script!.headers.get("Content-Security-Policy")).toBe("frame-ancestors 'none'");
  });

  it("keeps serving its own files when the host changes them", async () => {
    const key = releaseKey();
    const r = release(BUNDLE, { key });
    const d = device([key.entry], r.files);
    await d.install();
    r.files["index.html"] = page("someone else's code");
    expect(await text(await d.open("/"))).toBe(BUNDLE["index.html"]);
  });

  it("refuses a file whose bytes don't match, rather than serve it", async () => {
    const key = releaseKey();
    const r = release(BUNDLE, { key });
    const d = device([key.entry], r.files);
    await d.install();
    // The device lost its copy, and the host now serves other bytes.
    (await d.caches.open(`release-files-${r.digest}`)).entries.delete(`${ORIGIN}/_next/static/app-1.js`);
    r.files["_next/static/app-1.js"] = "steal()";
    const res = await d.get("/_next/static/app-1.js");
    expect(res!.status).toBe(502);
    expect(await text(res)).not.toContain("steal");
    // A copy on the device that was changed is dropped and refused the same way.
    (await d.caches.open(`release-files-${r.digest}`)).entries.set(`${ORIGIN}/index.html`, new TextEncoder().encode("changed").buffer);
    r.files["index.html"] = "changed";
    expect((await d.open("/"))!.status).toBe(502);
  });

  it("finds pages as a file host does, and nothing outside the release", async () => {
    const key = releaseKey();
    const r = release(BUNDLE, { key });
    const d = device([key.entry], r.files);
    await d.install();
    expect(await text(await d.open("/terms/"))).toBe(BUNDLE["terms/index.html"]);
    const bare = await d.open("/terms?x=1");
    expect(bare!.status).toBe(301);
    expect(bare!.headers.get("Location")).toBe(`${ORIGIN}/terms/?x=1`);
    const lost = await d.open("/nowhere/");
    expect(lost!.status).toBe(404);
    expect(await text(lost)).toBe(BUNDLE["404.html"]);
    r.files["extra.js"] = "steal()";
    expect((await d.get("/extra.js"))!.status).toBe(404);
  });

  it("leaves other addresses, other methods and the release's own files to the browser", async () => {
    const key = releaseKey();
    const r = release(BUNDLE, { key });
    const d = device([key.entry], r.files);
    await d.install();
    expect(await d.get("/", { origin: "https://api.example.test" })).toBeUndefined();
    expect(await d.get("/", { method: "POST" })).toBeUndefined();
    for (const own of ["/release.json", "/release.sig", "/release-retired.json", "/sw.js"]) expect(await d.get(own)).toBeUndefined();
  });
});

describe("a new release", () => {
  const V2: Files = { ...BUNDLE, "index.html": page("home v2"), "_next/static/app-2.js": "console.log('v2')" };
  delete V2["_next/static/app-1.js"];

  async function onV1() {
    const key = releaseKey();
    const r1 = release(BUNDLE, { key });
    const host: Files = { ...r1.files };
    const d = device([key.entry], host);
    await d.install();
    await d.activate();
    const publish = (files: Files) => {
      for (const p of Object.keys(host)) delete host[p];
      Object.assign(host, files);
    };
    return { key, r1, host, d, publish };
  }

  it("signed, newer and complete: taken, and the last one kept for pages opened before it", async () => {
    const { key, d, publish } = await onV1();
    const r2 = release(V2, { key, version: "v1.1", created: "2026-11-18" });
    publish(r2.files);
    d.fetched.length = 0;
    await d.check();
    expect(await d.status()).toMatchObject({ version: "v1.1", digest: r2.digest, problem: null });
    expect(await text(await d.open("/"))).toBe(V2["index.html"]);
    expect(await text(await d.get("/_next/static/app-1.js"))).toBe(BUNDLE["_next/static/app-1.js"]);
    // Unchanged files came from the device, not the host.
    expect(d.fetched).not.toContain("terms/index.html");
  });

  it("unsigned: not taken", async () => {
    const { r1, d, publish } = await onV1();
    publish(release(V2, { version: "v1.1", created: "2026-11-18" }).files);
    await d.check();
    expect(await d.status()).toMatchObject({ digest: r1.digest, problem: "the host's release isn't signed" });
    expect(await text(await d.open("/"))).toBe(BUNDLE["index.html"]);
  });

  it("signed by a key that isn't a release key: not taken", async () => {
    const { r1, d, publish } = await onV1();
    publish(release(V2, { key: releaseKey(), version: "v1.1", created: "2026-11-18" }).files);
    await d.check();
    expect(await d.status()).toMatchObject({ digest: r1.digest, problem: "the host's release isn't signed by a release key" });
  });

  it("with a list changed after it was signed: not taken", async () => {
    const { key, r1, d, publish } = await onV1();
    const r2 = release(V2, { key, version: "v1.1", created: "2026-11-18" });
    const forged = JSON.parse(r2.files["release.json"]!);
    forged.files["index.html"] = sha("steal()");
    publish({ ...r2.files, "index.html": "steal()", "release.json": JSON.stringify(forged) });
    await d.check();
    expect(await d.status()).toMatchObject({ digest: r1.digest, problem: "the host's release.json doesn't match its own digest" });
    forged.digest = sha(canonical(forged.files));
    publish({ ...r2.files, "index.html": "steal()", "release.json": JSON.stringify(forged) });
    await d.check();
    expect(await d.status()).toMatchObject({ digest: r1.digest, problem: "the host's release isn't signed by a release key" });
  });

  it("signed, but a file the host serves doesn't match: not taken, and that file not kept", async () => {
    const { key, r1, d, publish } = await onV1();
    const r2 = release(V2, { key, version: "v1.1", created: "2026-11-18" });
    publish({ ...r2.files, "_next/static/app-2.js": "steal()" });
    await d.check();
    expect(await d.status()).toMatchObject({ digest: r1.digest, problem: "_next/static/app-2.js doesn't match the release" });
    expect((await d.caches.open(`release-files-${r2.digest}`)).entries.has(`${ORIGIN}/_next/static/app-2.js`)).toBe(false);
    expect(await text(await d.open("/"))).toBe(BUNDLE["index.html"]);
    // Once the host serves the right bytes, the next look takes it, fetching only what was missing.
    publish(r2.files);
    d.fetched.length = 0;
    await d.check();
    expect(await d.status()).toMatchObject({ digest: r2.digest, problem: null });
    expect(d.fetched.filter((p) => !p.startsWith("release"))).toEqual(["_next/static/app-2.js"]);
  });

  it("signed but older than the one on the device: not taken", async () => {
    const { key, r1, d, publish } = await onV1();
    publish(release(V2, { key, version: "v0.9", created: "2026-11-01" }).files);
    await d.check();
    expect(await d.status()).toMatchObject({ digest: r1.digest, problem: "the host serves an older release" });
  });

  it("listing the release's own files or a path outside the bundle: not taken", async () => {
    const { key, r1, d, publish } = await onV1();
    publish(release({ ...V2, "release.sig": "x" }, { key, created: "2026-11-18" }).files);
    await d.check();
    expect(await d.status()).toMatchObject({ digest: r1.digest, problem: "the host's release.json lists a file it can't" });
  });
});

describe("retiring a release", () => {
  it("a signed retirement drops the release, serves nothing until a good one is out, then takes it", async () => {
    const key = releaseKey();
    const r1 = release(BUNDLE, { key });
    const host: Files = { ...r1.files };
    const d = device([key.entry], host);
    await d.install();
    host["release-retired.json"] = JSON.stringify({ retired: [retirement(r1.digest, key)] });
    await d.check();
    expect(await d.status()).toMatchObject({ digest: null, withdrawn: true, problem: "the host serves a retired release" });
    const res = await d.open("/");
    expect(res!.status).toBe(503);
    expect(await text(res)).toContain("withdrawn");
    expect(await d.caches.keys()).not.toContain(`release-files-${r1.digest}`);

    const r2 = release({ ...BUNDLE, "index.html": page("fixed") }, { key, version: "v1.0.1" });
    Object.assign(host, r2.files);
    await d.check();
    expect(await d.status()).toMatchObject({ digest: r2.digest, withdrawn: false, problem: null });
    expect(await text(await d.open("/"))).toBe(page("fixed"));
  });

  it("the host alone can't retire one: an unsigned, wrongly signed or replayed retirement does nothing", async () => {
    const key = releaseKey();
    const r1 = release(BUNDLE, { key });
    const host: Files = { ...r1.files };
    const d = device([key.entry], host);
    await d.install();
    const releaseSig = JSON.parse(r1.files["release.sig"]!);
    host["release-retired.json"] = JSON.stringify({
      retired: [
        { digest: r1.digest },
        retirement(r1.digest, releaseKey()),
        { digest: r1.digest, key: key.entry.id, sig: releaseSig.sig }, // the release's own signature, replayed
      ],
    });
    await d.check();
    expect(await d.status()).toMatchObject({ digest: r1.digest, withdrawn: false });
    expect(await text(await d.open("/"))).toBe(BUNDLE["index.html"]);
  });

  it("a retired release is never taken again, even by a new worker", async () => {
    const key = releaseKey();
    const r1 = release(BUNDLE, { key });
    const host: Files = { ...r1.files, "release-retired.json": JSON.stringify({ retired: [retirement(r1.digest, key)] }) };
    const d = device([key.entry], host);
    await d.install();
    delete host["release-retired.json"]; // the host stops publishing it
    const next = device([key.entry], host, d.caches);
    await next.install();
    expect(await next.status()).toMatchObject({ digest: null, problem: "the host serves a retired release" });
  });

  it("the operator's script writes a retirement the worker honours", async () => {
    const key = releaseKey();
    const r1 = release(BUNDLE, { key });
    // A throwaway key file for this test only, readable by its owner alone, removed after.
    const dir = mkdtempSync(join(tmpdir(), "retire-"));
    try {
      const keyFile = join(dir, "release.pem");
      writeFileSync(keyFile, key.privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 });
      const list = join(dir, RETIRED_FILE);
      const script = new URL("../../scripts/retire_release.mjs", import.meta.url).pathname;
      const printed = execFileSync(process.execPath, [script, r1.digest, "--key", keyFile, "--list", list], { encoding: "utf8" });
      execFileSync(process.execPath, [script, r1.digest, "--key", keyFile, "--list", list]); // twice: still one entry
      expect(printed).toContain(key.entry.id);
      expect(printed).not.toMatch(/PRIVATE KEY|MC4CAQ/);
      const written = readFileSync(list, "utf8");
      expect(parseRetired(written)).toHaveLength(1);

      const host: Files = { ...r1.files };
      const d = device([key.entry], host);
      await d.install();
      host[RETIRED_FILE] = written;
      await d.check();
      expect(await d.status()).toMatchObject({ digest: null, withdrawn: true });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("a retirement signs other bytes than any release", () => {
    expect(retireMessage("a".repeat(64))).toHaveLength(82);
    expect(() => retireMessage("not a digest")).toThrow();
  });
});

describe("with no release key, or no release", () => {
  it("takes nothing and serves the host's files as they are, with the headers", async () => {
    const r = release(BUNDLE, { key: releaseKey() });
    const d = device([], r.files);
    await d.install();
    expect(await d.status()).toMatchObject({ digest: null, problem: "the host's release isn't signed by a release key" });
    const res = await d.open("/");
    expect(await text(res)).toBe(BUNDLE["index.html"]);
    expect(res!.headers.get("Content-Security-Policy")).toBe(`${POLICY}; frame-ancestors 'none'`);
    expect(res!.headers.get("X-Frame-Options")).toBe("DENY");
  });

  it("ignores a listed key whose id isn't its own", async () => {
    const key = releaseKey();
    const r = release(BUNDLE, { key });
    const d = device([{ ...key.entry, id: "0123456789abcdef" }], { ...r.files, "release.sig": JSON.stringify({ ...JSON.parse(r.files["release.sig"]!), key: "0123456789abcdef" }) });
    await d.install();
    expect((await d.status()).digest).toBeNull();
  });

  it("still installs when the host serves no release at all", async () => {
    const d = device([releaseKey().entry], { "index.html": page("plain") });
    await d.install();
    expect(await d.status()).toMatchObject({ digest: null, problem: "the host serves no release.json" });
    expect(await text(await d.open("/"))).toBe(page("plain"));
  });
});

describe("the worker's text", () => {
  it("is worker.js with one CONFIG line, carrying no script from anywhere else", () => {
    const key = releaseKey();
    const script = workerScript(SOURCE, [key.entry], workerHeaders(SECURITY_HEADERS));
    const [first, ...rest] = script.split("\n");
    expect(rest.join("\n")).toBe(SOURCE);
    expect(JSON.parse(first!.replace(/^const CONFIG = /, "").replace(/;$/, ""))).toEqual({
      keys: [key.entry],
      headers: workerHeaders(SECURITY_HEADERS),
    });
    expect(SOURCE).not.toMatch(/importScripts|import\s*\(|https?:\/\//);
    expect(() => workerScript("console.log(1)", [], [])).toThrow();
  });

  it("adds the website's headers but HSTS", () => {
    const names = workerHeaders(SECURITY_HEADERS).map(([k]) => k);
    expect(names).toEqual(expect.arrayContaining(["X-Frame-Options", "Permissions-Policy", "X-Content-Type-Options", "Referrer-Policy"]));
    expect(names).not.toContain("Strict-Transport-Security");
  });
});
