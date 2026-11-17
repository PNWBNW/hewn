// The update worker in a real browser (src/updates/README.md, docs/HOSTING.md step 4).
//
// Copies the built static bundle (`out/`) to a folder of its own, writes the worker into it with a
// release key made for this run (its private half lives in memory only and is never written), signs
// the copy as a release, and serves it with no headers but the content type, as a plain file host
// such as GitHub Pages does. Then, in Chromium, as one device:
//
// 1. a signed release is taken and served from the device, with the headers the host can't send;
// 2. a file whose bytes don't match the release is refused;
// 3. a new release that isn't signed is not taken; a signed one is;
// 4. a new worker from the host brings up the notice.
//
// Not part of `pnpm test` (Chromium is not in CI): `pnpm --filter @pnw/business test:worker`,
// after `build:static` (it builds the bundle itself if `out/` is missing). Needs the `playwright`
// package and its Chromium where Node can find them (NODE_PATH); it never downloads a browser.

import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { execFileSync } from "node:child_process";
import { appendFileSync, cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { extname, join, normalize, relative, sep } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SECURITY_HEADERS } from "@/security/headers";
import { workerHeaders, workerScript, type ReleaseKeyEntry } from "@/updates/worker_source";

type Playwright = typeof import("playwright");
type Browser = import("playwright").Browser;
type Page = import("playwright").Page;

const APP = join(__dirname, "..", "..");
const OUT = join(APP, "out");
const SOURCE = readFileSync(join(APP, "src", "updates", "worker.js"), "utf8");

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".txt": "text/plain; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".wasm": "application/wasm",
  ".pdf": "application/pdf",
  ".sig": "application/octet-stream",
};

const sha = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");

// ---------------------------------------------------------------------------
// A release key for this run, and releases signed with it.
// ---------------------------------------------------------------------------

function releaseKey() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const raw = Buffer.from(publicKey.export({ format: "jwk" }).x!, "base64url");
  const entry: ReleaseKeyEntry = { id: sha(raw).slice(0, 16), publicKey: raw.toString("base64") };
  return { entry, signs: (message: Buffer) => sign(null, message, privateKey).toString("base64") };
}

function bundleFiles(dir: string): string[] {
  const walk = (d: string): string[] =>
    readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [relative(dir, join(d, e.name)).split(sep).join("/")]));
  return walk(dir).filter((p) => p !== "release.json" && p !== "release.sig").sort();
}

/** Writes release.json for `dir` (the format in scripts/release/README.md) and, with a key, release.sig. */
function writeRelease(dir: string, { version, created, key }: { version: string; created: string; key?: ReturnType<typeof releaseKey> }) {
  const files: Record<string, string> = {};
  for (const p of bundleFiles(dir)) files[p] = sha(readFileSync(join(dir, ...p.split("/"))));
  const canonical = "{" + Object.keys(files).sort().map((p) => `${JSON.stringify(p)}:${JSON.stringify(files[p])}`).join(",") + "}";
  const digest = sha(canonical);
  writeFileSync(join(dir, "release.json"), JSON.stringify({ version, commit: "0".repeat(40), created, files, digest }, null, 2));
  rmSync(join(dir, "release.sig"), { force: true });
  if (key) writeFileSync(join(dir, "release.sig"), JSON.stringify({ key: key.entry.id, sig: key.signs(Buffer.from(digest, "hex")) }));
  return digest;
}

// ---------------------------------------------------------------------------
// A plain file host: no headers but the content type, folders answered by their index.html,
// a folder without its slash sent to it, anything missing answered by 404.html. Reads the disk on
// every request, so the tests change what it serves by changing the files.
// ---------------------------------------------------------------------------

function fileHost(root: string): Server {
  return createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    let file = normalize(join(root, decodeURIComponent(url.pathname)));
    if (!file.startsWith(root)) return void res.writeHead(403).end();
    if (existsSync(file) && statSync(file).isDirectory()) {
      if (!url.pathname.endsWith("/")) return void res.writeHead(301, { location: `${url.pathname}/${url.search}` }).end();
      file = join(file, "index.html");
    }
    if (!existsSync(file)) {
      res.writeHead(404, { "content-type": TYPES[".html"] });
      return void res.end(existsSync(join(root, "404.html")) ? readFileSync(join(root, "404.html")) : "");
    }
    res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
    res.end(readFileSync(file));
  });
}

function loadPlaywright(): Playwright {
  try {
    return createRequire(import.meta.url)("playwright") as Playwright;
  } catch {
    throw new Error("these tests need the playwright package and its Chromium on NODE_PATH; they never install a browser");
  }
}

// ---------------------------------------------------------------------------

let site: string;
let server: Server;
let base: string;
let browser: Browser;
let page: Page;
let key: ReturnType<typeof releaseKey>;
let firstDigest: string;

type Status = { version: string | null; digest: string | null; withdrawn: boolean; problem: string | null };

/** Sends the worker "status" (what it holds) or "check" (look at the host's release now) and returns its answer. */
function ask(type: "status" | "check"): Promise<Status> {
  return page.evaluate(async (type) => {
    const reg = await navigator.serviceWorker.ready;
    return new Promise<Status>((resolve) => {
      const channel = new MessageChannel();
      channel.port1.onmessage = (e) => resolve(e.data);
      reg.active!.postMessage({ type }, [channel.port2]);
    });
  }, type);
}
const status = () => ask("status");
const check = () => ask("check");

beforeAll(async () => {
  if (!existsSync(join(OUT, "index.html"))) {
    execFileSync("pnpm", ["--filter", "@pnw/business", "build:static"], { cwd: APP, stdio: "inherit" });
  }
  site = mkdtempSync(join(tmpdir(), "update-worker-"));
  cpSync(OUT, site, { recursive: true });
  key = releaseKey();
  writeFileSync(join(site, "sw.js"), workerScript(SOURCE, [key.entry], workerHeaders(SECURITY_HEADERS)));
  firstDigest = writeRelease(site, { version: "v-test.1", created: "2026-11-17", key });

  server = fileHost(site);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  browser = await loadPlaywright().chromium.launch();
  page = await (await browser.newContext()).newPage();
});

afterAll(async () => {
  await browser?.close();
  await new Promise((resolve) => server?.close(resolve));
  if (site) rmSync(site, { recursive: true, force: true });
});

describe("the update worker in Chromium", () => {
  it("takes a signed release and serves it from the device, with the headers the host can't send", async () => {
    await page.goto(`${base}/`);
    // The first visit trusts the host; the worker registers, takes the release and claims the page.
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, { timeout: 120_000 });
    expect(await status()).toMatchObject({ version: "v-test.1", digest: firstDigest, problem: null });

    // The host now serves something else as the home page; the device serves the release's.
    appendFileSync(join(site, "index.html"), "<!-- served by someone else -->");
    const res = await page.goto(`${base}/`);
    expect(res!.fromServiceWorker()).toBe(true);
    expect(await res!.text()).not.toContain("someone else");
    const headers = res!.headers();
    expect(headers["x-frame-options"]).toBe("DENY");
    expect(headers["permissions-policy"]).toContain("camera=()");
    expect(headers["content-security-policy"]).toMatch(/^default-src 'self'; script-src 'self' 'sha256-.*; frame-ancestors 'none'$/);
    // The page's own policy, unchanged, is what the header carries.
    const meta = /<meta http-equiv="Content-Security-Policy" content="([^"]*)"/.exec(await res!.text())![1];
    expect(headers["content-security-policy"]).toBe(`${meta}; frame-ancestors 'none'`);
    // A page that isn't cached as a document is found the same way.
    expect((await page.goto(`${base}/terms/`))!.fromServiceWorker()).toBe(true);
  });

  it("refuses a file whose bytes don't match the release", async () => {
    const chunk = bundleFiles(site).find((p) => p.startsWith("_next/static/chunks/") && p.endsWith(".js"))!;
    // The device loses its copy, and the host serves other bytes in its place.
    await page.evaluate(
      async ([digest, url]) => (await caches.open(`release-files-${digest}`)).delete(url),
      [firstDigest, `${base}/${chunk}`] as const,
    );
    appendFileSync(join(site, ...chunk.split("/")), "\n;window.__stolen = true;");
    const answer = await page.evaluate(async (url) => {
      const r = await fetch(url);
      return { status: r.status, body: await r.text() };
    }, `${base}/${chunk}`);
    expect(answer.status).toBe(502);
    expect(answer.body).not.toContain("__stolen");
  });

  it("doesn't take a new release that isn't signed, and takes one that is", async () => {
    writeFileSync(join(site, "index.html"), readFileSync(join(site, "index.html"), "utf8").replace("<!-- served by someone else -->", "<!-- release two -->"));
    writeRelease(site, { version: "v-test.2", created: "2026-11-18" }); // no signature
    await check();
    expect(await status()).toMatchObject({ digest: firstDigest, problem: "the host's release isn't signed" });
    expect(await (await page.goto(`${base}/`))!.text()).not.toContain("release two");

    writeRelease(site, { version: "v-test.2", created: "2026-11-18", key: releaseKey() }); // someone else's key
    await check();
    expect(await status()).toMatchObject({ digest: firstDigest, problem: "the host's release isn't signed by a release key" });

    const second = writeRelease(site, { version: "v-test.2", created: "2026-11-18", key });
    await check();
    expect(await status()).toMatchObject({ version: "v-test.2", digest: second, problem: null });
    expect(await (await page.goto(`${base}/`))!.text()).toContain("release two");
  });

  it("brings up the notice when the browser starts installing a new worker", async () => {
    await page.goto(`${base}/`);
    await page.waitForLoadState("networkidle");
    expect(await page.locator("[data-update-notice]").count()).toBe(0);
    appendFileSync(join(site, "sw.js"), "\n// a worker the host changed\n");
    await page.evaluate(async () => (await navigator.serviceWorker.ready).update());
    const notice = page.locator("[data-update-notice]");
    await notice.waitFor({ state: "visible", timeout: 60_000 });
    expect(await notice.textContent()).toContain("An update arrived that this app can't check");
    expect(await notice.locator("a").getAttribute("href")).toMatch(/scripts\/release\/README\.md$/);
  });

  it("as built today, with no release key published: takes nothing and passes the host's files through, with the headers", async () => {
    const plain = fileHost(OUT); // the bundle exactly as build:static wrote it
    await new Promise<void>((resolve) => plain.listen(0, "127.0.0.1", resolve));
    const at = `http://127.0.0.1:${(plain.address() as AddressInfo).port}`;
    const context = await browser.newContext();
    try {
      const other = await context.newPage();
      await other.goto(`${at}/`);
      await other.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, { timeout: 60_000 });
      const answer = await other.evaluate(async () => {
        const reg = await navigator.serviceWorker.ready;
        return new Promise<Status>((resolve) => {
          const channel = new MessageChannel();
          channel.port1.onmessage = (e) => resolve(e.data);
          reg.active!.postMessage({ type: "status" }, [channel.port2]);
        });
      });
      expect(answer.digest).toBeNull();
      const res = await other.goto(`${at}/terms/`);
      expect(res!.fromServiceWorker()).toBe(true);
      expect(res!.status()).toBe(200);
      expect(res!.headers()["x-frame-options"]).toBe("DENY");
      expect(res!.headers()["content-security-policy"]).toMatch(/frame-ancestors 'none'$/);
      expect(await other.locator("[data-update-notice]").count()).toBe(0);
    } finally {
      await context.close();
      await new Promise((resolve) => plain.close(resolve));
    }
  });
});
