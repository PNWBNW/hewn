// The top-page guard in a real browser (docs/THREAT_MODEL.md T3, docs/HOSTING.md step 1).
//
// Serves the built static bundle (`out/`) with no headers at all, the way a plain file host such
// as GitHub Pages would, so nothing but the guard stands between the page and a frame. Then loads
// it as the top page (shown) and inside frames on another origin: a plain frame, a frame
// sandboxed without scripts, and one sandboxed with `allow-scripts` (hidden in all three). It also
// measures what the guard costs: how much later the first paint comes than the same page without
// the guard's rule.
//
// Not part of `pnpm test` (Chromium is not in CI): `pnpm --filter @pnw/business test:frames`,
// after `pnpm --filter @pnw/business build:static` (it builds the bundle itself if `out/` is
// missing). Needs the `playwright` package and its Chromium where Node can find them (NODE_PATH);
// it never downloads a browser.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createRequire } from "node:module";
import { extname, join, normalize } from "node:path";
import { gzipSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TOP_PAGE_ATTRIBUTE, TOP_PAGE_MARK } from "@pnw/security/frame_guard";

type Playwright = typeof import("playwright");
type Browser = import("playwright").Browser;
type Frame = import("playwright").Frame;
type Page = import("playwright").Page;

const APP = join(__dirname, "..", "..");
const OUT = join(APP, "out");

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".txt": "text/plain; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".wasm": "application/wasm",
};

/** A plain file server for `out/`: no headers but the content type, as a static host sends. */
function bundleServer(): Server {
  return createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname);
    let file = normalize(join(OUT, path));
    if (!file.startsWith(OUT)) {
      res.writeHead(403).end();
      return;
    }
    if (existsSync(file) && statSync(file).isDirectory()) file = join(file, "index.html");
    if (!existsSync(file)) {
      res.writeHead(404).end();
      return;
    }
    const type = TYPES[extname(file)] ?? "application/octet-stream";
    // Compressed as every real host sends it, so the timings below see real transfer sizes.
    if (/text|json|svg/.test(type) && /gzip/.test(String(req.headers["accept-encoding"]))) {
      res.writeHead(200, { "content-type": type, "content-encoding": "gzip" });
      res.end(gzipSync(readFileSync(file)));
      return;
    }
    res.writeHead(200, { "content-type": type });
    res.end(readFileSync(file));
  });
}

/** Someone else's page that frames the app: `/plain`, `/sandbox` or `/scripts` (allow-scripts). */
function framerServer(appUrl: string): Server {
  const frames: Record<string, string> = {
    "/plain": `<iframe src="${appUrl}" width="800" height="600"></iframe>`,
    "/sandbox": `<iframe sandbox src="${appUrl}" width="800" height="600"></iframe>`,
    "/scripts": `<iframe sandbox="allow-scripts" src="${appUrl}" width="800" height="600"></iframe>`,
  };
  return createServer((req, res) => {
    const frame = frames[req.url ?? ""];
    if (!frame) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(`<!doctype html><html><head><title>framer</title></head><body>${frame}</body></html>`);
  });
}

async function listen(server: Server, host: string): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, host, resolve));
  return `http://${host}:${(server.address() as AddressInfo).port}`;
}

function loadPlaywright(): Playwright {
  try {
    return createRequire(import.meta.url)("playwright") as Playwright;
  } catch {
    throw new Error("these tests need the playwright package and its Chromium on NODE_PATH; they never install a browser");
  }
}

/** What a frame or page shows: whether <html> is drawn, the guard's mark, and whether the app's code ran. */
async function state(target: Page | Frame) {
  return target.evaluate(
    ([attribute, mark]) => ({
      display: getComputedStyle(document.documentElement).display,
      marked: document.documentElement.hasAttribute(attribute),
      markTimes: performance.getEntriesByName(mark).length,
      // The app's entry code sets this, in the same module that runs the guard; only meaningful
      // where scripts run (Playwright reads the page from a world of its own).
      appRan: Boolean((window as unknown as { next?: { turbopack?: boolean } }).next?.turbopack),
    }),
    [TOP_PAGE_ATTRIBUTE, TOP_PAGE_MARK] as const,
  );
}

async function framedApp(page: Page, url: string): Promise<Frame> {
  await page.goto(url);
  const frame = page.frames().find((f) => f !== page.mainFrame());
  if (!frame) throw new Error("no frame");
  await frame.waitForLoadState("load");
  // Give the app's scripts every chance to run, and to show the page if they ever would.
  await page.waitForTimeout(1000);
  return frame;
}

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;

describe("the top-page guard in the static bundle", () => {
  let browser: Browser;
  let bundle: Server;
  let framer: Server;
  let appUrl: string;
  let framerUrl: string;

  beforeAll(async () => {
    if (!existsSync(join(OUT, "index.html"))) {
      execFileSync("pnpm", ["build:static"], { cwd: APP, stdio: "inherit" });
    }
    const { chromium } = loadPlaywright();
    browser = await chromium.launch();
    // Two origins: the app on 127.0.0.1 and the framing page on localhost.
    bundle = bundleServer();
    appUrl = `${await listen(bundle, "127.0.0.1")}/`;
    framer = framerServer(appUrl);
    framerUrl = await listen(framer, "localhost");
  });

  afterAll(async () => {
    await browser?.close();
    bundle?.close();
    framer?.close();
  });

  it("shows the page when it is the top page", async () => {
    const page = await browser.newPage();
    await page.goto(appUrl);
    await page.waitForFunction((a) => document.documentElement.hasAttribute(a), TOP_PAGE_ATTRIBUTE);
    const s = await state(page);
    expect(s).toMatchObject({ display: "block", marked: true, markTimes: 1, appRan: true });
    expect(await page.locator("body").isVisible()).toBe(true);
    // The no-JavaScript note is never drawn when scripts run.
    expect(await page.locator("noscript").isVisible()).toBe(false);
    await page.close();
  });

  it("keeps a framed copy hidden, and the app's code did run there", async () => {
    const page = await browser.newPage();
    const frame = await framedApp(page, `${framerUrl}/plain`);
    expect(await state(frame)).toEqual({ display: "none", marked: false, markTimes: 0, appRan: true });
    // The framing page is where it was: the guard never moves the top window.
    expect(page.url()).toBe(`${framerUrl}/plain`);
    await page.close();
  });

  it("keeps a copy in a frame sandboxed with allow-scripts hidden", async () => {
    const page = await browser.newPage();
    const frame = await framedApp(page, `${framerUrl}/scripts`);
    expect(await state(frame)).toEqual({ display: "none", marked: false, markTimes: 0, appRan: true });
    expect(page.url()).toBe(`${framerUrl}/scripts`);
    await page.close();
  });

  it("keeps a copy in a frame sandboxed without scripts hidden, but for the no-JavaScript note", async () => {
    const page = await browser.newPage();
    const frame = await framedApp(page, `${framerUrl}/sandbox`);
    const s = await state(frame);
    expect(s).toMatchObject({ marked: false, markTimes: 0, appRan: false });
    // Every child of <body> but the note is hidden; the note is the only thing drawn.
    const drawn = await frame.evaluate(() =>
      [...document.body.children]
        .filter((el) => getComputedStyle(el).display !== "none" && el.getBoundingClientRect().height > 0)
        .map((el) => el.tagName.toLowerCase()),
    );
    expect(drawn).toEqual(["noscript"]);
    // (Playwright's text search skips <noscript>, so the note is found by its place.)
    const note = frame.locator("noscript > p");
    expect(await note.isVisible()).toBe(true);
    expect(await note.textContent()).toContain("needs JavaScript");
    await page.close();
  });

  it("shows only the note to a top page with JavaScript switched off", async () => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    await page.goto(appUrl);
    const drawn = await page.evaluate(() =>
      [...document.body.children]
        .filter((el) => getComputedStyle(el).display !== "none" && el.getBoundingClientRect().height > 0)
        .map((el) => el.tagName.toLowerCase()),
    );
    expect(drawn).toEqual(["noscript"]);
    await context.close();
  });

  it("measures how long the page stays blank because of the guard", async () => {
    // First paint with the guard, and with the guard's rule taken out of the stylesheet (the same
    // page as it was before the guard), five loads each, the median kept. Three machines: this
    // one as it is; its processor slowed four times; and that with a slow 4G network (150 ms
    // round trip, 1.6 Mbit/s down), Lighthouse's stand-in for a mid-range phone.
    const profiles = [
      { name: "this machine", cpu: 1 },
      { name: "cpu x4", cpu: 4 },
      { name: "cpu x4, slow 4G", cpu: 4, network: { latency: 150, downloadThroughput: 1.6e6 / 8, uploadThroughput: 750e3 / 8 } },
    ];
    const firstPaint = async (withGuard: boolean, profile: (typeof profiles)[number]) => {
      const context = await browser.newContext();
      const page = await context.newPage();
      if (!withGuard) {
        await page.route("**/*.css", async (route) => {
          const response = await route.fetch();
          const css = await response.text();
          const rule = `html:not([${TOP_PAGE_ATTRIBUTE}]){display:none}`;
          if (css.includes("data-top-page") && !css.includes(rule)) throw new Error("the guard's rule is not where the control expects it");
          await route.fulfill({ response, body: css.replaceAll(rule, "") });
        });
      }
      const cdp = await context.newCDPSession(page);
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: profile.cpu });
      if (profile.network) {
        await cdp.send("Network.enable");
        await cdp.send("Network.emulateNetworkConditions", { offline: false, ...profile.network });
      }
      await page.goto(appUrl, { waitUntil: "load", timeout: 60_000 });
      await page.waitForFunction(() => performance.getEntriesByName("first-contentful-paint").length > 0);
      const fcp = await page.evaluate(() => performance.getEntriesByName("first-contentful-paint")[0]!.startTime);
      await context.close();
      return fcp;
    };
    const results: Record<string, { guard: number; without: number; blank: number }> = {};
    for (const profile of profiles) {
      const guard: number[] = [];
      const without: number[] = [];
      for (let i = 0; i < 5; i++) {
        guard.push(await firstPaint(true, profile));
        without.push(await firstPaint(false, profile));
      }
      const g = median(guard);
      const w = median(without);
      results[profile.name] = { guard: Math.round(g), without: Math.round(w), blank: Math.round(g - w) };
    }
    console.log("first contentful paint of the static bundle's first page, ms (median of 5; blank = how much later it paints with the guard):", results);
    for (const r of Object.values(results)) expect(r.guard).toBeGreaterThan(0);
  }, 300_000);
});
