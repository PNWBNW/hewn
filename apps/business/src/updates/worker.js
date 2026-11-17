// The update worker: a service worker for the static bundle served on the web (docs/HOSTING.md,
// step 4; README.md beside this file). Plain JavaScript, no library. `scripts/update_worker.mjs`
// writes it into the bundle as `sw.js`, with one line above this one:
//
//   const CONFIG = { keys: [{ id, publicKey }], headers: [[name, value], ...] };
//
// `keys` are the release public keys (@pnw/brand releaseKeys), `headers` the security headers a
// plain file host can't send (src/security/headers.ts).
//
// What it does:
// - Keeps the last good release on the device and serves the app's files from it.
// - Takes a new release only when its release.json is signed (release.sig) by one of `keys`, is no
//   older than the one it holds and isn't retired, and every file it lists downloads with its
//   listed SHA-256. Until then it keeps serving the release it has. The date (`created`) is outside
//   the signature, so it guards against going back by mistake, not on purpose (a bad old release is
//   retired), and a date later than today counts as today.
// - Checks again what it finds kept on the device (each release's signature, each retirement's)
//   before trusting it: storage a worker the host swapped in could have written.
// - Serves a file only when its bytes match the SHA-256 the release lists; one that doesn't is
//   refused, never served.
// - Retires a release when release-retired.json carries a signature of its digest by one of
//   `keys`: the device drops it and serves nothing until a release that isn't retired is
//   published. The host can withhold a retirement but can't make one up.
// - Keeps the release before the current one too, so a page opened before an update can still
//   load its own files.
// - Adds `headers` to what it serves, and to a page its own policy plus `frame-ancestors 'none'`.
//
// What it can't do: the browser fetches and updates this file itself, from the host, without
// asking it. A host that serves a different worker replaces this one. The page notices a new
// worker installing and says so (UpdateNotice.tsx); nothing here can stop it.

"use strict";

const MANIFEST = "release.json";
const SIGNATURE = "release.sig";
const RETIRED = "release-retired.json";
/** What a retirement signs, before the digest: never 32 bytes, so never what a release signs. */
const RETIRE_TAG = "release-retire:v1:";
/** Fetched by the worker itself, never served from a release: the release's own files and this worker. */
const PASS = new Set([MANIFEST, SIGNATURE, RETIRED, "sw.js"]);
const STATE = "release-state";
const FILES = "release-files-";
/** How often opening a page may look at the host's release again. */
const CHECK_EVERY_MS = 5 * 60 * 1000;

const HEX64 = /^[0-9a-f]{64}$/;
const KEY_ID = /^[0-9a-f]{16}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

const TYPES = {
  html: "text/html; charset=utf-8", js: "text/javascript; charset=utf-8", mjs: "text/javascript; charset=utf-8",
  css: "text/css; charset=utf-8", json: "application/json", txt: "text/plain; charset=utf-8",
  webmanifest: "application/manifest+json", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
  webp: "image/webp", svg: "image/svg+xml", ico: "image/x-icon", woff2: "font/woff2", woff: "font/woff",
  wasm: "application/wasm", pdf: "application/pdf", xml: "application/xml",
};

const WITHDRAWN =
  "The version of this app on this device was withdrawn by its publisher, and a replacement isn't published yet. " +
  "Your books stay on this device. Try again later.";
const MISMATCH = "This file doesn't match the release this device trusts, so it wasn't loaded. Try again later.";

// ---------------------------------------------------------------------------
// Bytes, hashes and signatures (WebCrypto only).
// ---------------------------------------------------------------------------

const utf8 = (text) => new TextEncoder().encode(text);
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
const fromHex = (h) => new Uint8Array(h.match(/../g).map((b) => parseInt(b, 16)));
const fromBase64 = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
const sha256 = async (bytes) => hex(await crypto.subtle.digest("SHA-256", bytes));

/** The canonical JSON of a files object (scripts/release/README.md): keys sorted, no whitespace. */
function canonicalFiles(files) {
  return "{" + Object.keys(files).sort().map((p) => `${JSON.stringify(p)}:${JSON.stringify(files[p])}`).join(",") + "}";
}

/** A path a release may list: printable ASCII without `"` or `\`, relative, no empty, `.` or `..` part. */
function safePath(path) {
  if (typeof path !== "string" || path.length === 0 || path.length > 1024) return false;
  if (path.startsWith("/") || !/^[\x20-\x7e]+$/.test(path) || /["\\]/.test(path)) return false;
  return path.split("/").every((seg) => seg !== "" && seg !== "." && seg !== "..");
}

let trusted = null;
/** CONFIG.keys as a map from id to a verify key; an entry whose id isn't its key's is left out. */
function trustedKeys() {
  trusted ??= (async () => {
    const out = new Map();
    for (const { id, publicKey } of CONFIG.keys) {
      try {
        const raw = fromBase64(publicKey);
        if (raw.length !== 32 || (await sha256(raw)).slice(0, 16) !== id) continue;
        out.set(id, await crypto.subtle.importKey("raw", raw, { name: "Ed25519" }, false, ["verify"]));
      } catch {
        // a key this browser can't read is no key
      }
    }
    return out;
  })();
  return trusted;
}

const goodSignatures = new Set();
/** Whether `sig` ({key, sig}) signs `message` under one of the trusted keys (each good one remembered while this worker runs). */
async function signedBy(message, sig) {
  if (!sig || !KEY_ID.test(sig.key ?? "") || typeof sig.sig !== "string") return false;
  const seen = `${sig.key}:${sig.sig}:${hex(message)}`;
  if (goodSignatures.has(seen)) return true;
  const key = (await trustedKeys()).get(sig.key);
  if (!key) return false;
  try {
    const bytes = fromBase64(sig.sig);
    const good = bytes.length === 64 && (await crypto.subtle.verify({ name: "Ed25519" }, key, bytes, message));
    if (good) goodSignatures.add(seen);
    return good;
  } catch {
    return false;
  }
}

/** Today on this device, as release.json writes a date. */
const today = () => new Date().toISOString().slice(0, 10);
/** A release's date as the worker compares it: release.json's, but never later than today (the date isn't signed). */
const dated = (created) => (created > today() ? today() : created);

/** Whether a release as kept on the device still checks: its digest is its list's, and a release key signed it. */
async function stillSigned(r) {
  if (!r || typeof r !== "object" || !HEX64.test(r.digest ?? "") || !DAY.test(r.created ?? "")) return false;
  if (!r.files || typeof r.files !== "object" || Array.isArray(r.files)) return false;
  if ((await sha256(utf8(canonicalFiles(r.files)))) !== r.digest) return false;
  return signedBy(fromHex(r.digest), r.sig);
}

/** Whether a retirement ({digest, key, sig}) is a release key's. */
const signedRetirement = async (r) => HEX64.test(r?.digest ?? "") && (await signedBy(utf8(RETIRE_TAG + r.digest), r));

// ---------------------------------------------------------------------------
// The device's state, in the worker's own caches.
// ---------------------------------------------------------------------------

const scoped = (path) => new URL(path, self.registration.scope).href;

async function readState(name, fallback) {
  const res = await (await caches.open(STATE)).match(scoped(`__release/${name}`));
  return res ? res.json() : fallback;
}

async function writeState(name, value) {
  await (await caches.open(STATE)).put(scoped(`__release/${name}`), new Response(JSON.stringify(value)));
}

/** A release the device keeps ("current" or "previous"), only when it still checks; one that doesn't is forgotten. */
async function kept(name) {
  const r = await readState(name, null);
  if (!r) return null;
  if (!(await stillSigned(r))) {
    await writeState(name, null);
    return null;
  }
  return { ...r, created: dated(r.created) };
}

const current = () => kept("current");
const previous = () => kept("previous");

/** The retirements the device has seen, by digest: only those a release key signed. */
async function retiredSet() {
  const list = await readState("retired", []);
  const out = new Map();
  for (const r of Array.isArray(list) ? list : []) if (await signedRetirement(r)) out.set(r.digest, { digest: r.digest, key: r.key, sig: r.sig });
  return out;
}
/** Why the host's release wasn't taken the last time, for the page to read (null when it was). */
const note = (problem) => writeState("problem", problem);

/** Drops every release cache but those of the releases named. */
async function dropOthers(...keep) {
  const names = new Set(keep.filter(Boolean).map((r) => FILES + r.digest));
  for (const name of await caches.keys()) if (name.startsWith(FILES) && !names.has(name)) await caches.delete(name);
}

// ---------------------------------------------------------------------------
// Checking and taking a release.
// ---------------------------------------------------------------------------

// Always asks the host (the browser's own copy only when the host says it is current): every file
// is checked against its hash anyway, and release.json against its signature.
const fresh = (path) => fetch(scoped(path), { cache: "no-cache", credentials: "same-origin" });

/** The host's release when its digest is its list's and release.sig signs it; else why not. */
async function signedRelease() {
  const [mRes, sRes] = await Promise.all([fresh(MANIFEST), fresh(SIGNATURE)]);
  if (!mRes.ok) return { problem: "the host serves no release.json" };
  if (!sRes.ok) return { problem: "the host's release isn't signed" };
  let m, sig;
  try {
    m = JSON.parse(await mRes.text());
    sig = JSON.parse(await sRes.text());
  } catch {
    return { problem: "the host's release files aren't JSON" };
  }
  if (!m || typeof m.version !== "string" || !DAY.test(m.created ?? "") || !HEX64.test(m.digest ?? "")) return { problem: "the host's release.json is malformed" };
  if (!m.files || typeof m.files !== "object" || Array.isArray(m.files)) return { problem: "the host's release.json lists no files" };
  const paths = Object.keys(m.files);
  if (paths.length === 0 || !paths.every((p) => safePath(p) && p !== MANIFEST && p !== SIGNATURE && HEX64.test(m.files[p]))) return { problem: "the host's release.json lists a file it can't" };
  if ((await sha256(utf8(canonicalFiles(m.files)))) !== m.digest) return { problem: "the host's release.json doesn't match its own digest" };
  if (!(await signedBy(fromHex(m.digest), sig))) return { problem: "the host's release isn't signed by a release key" };
  const signature = { key: sig.key, sig: sig.sig };
  return { release: { version: m.version, commit: m.commit, created: dated(m.created), digest: m.digest, files: m.files, sig: signature } };
}

/** Reads release-retired.json and adds each retirement a release key signed to the device's list, which never shrinks while that key is trusted. */
async function learnRetirements() {
  const retired = await retiredSet();
  const res = await fresh(RETIRED).catch(() => null);
  if (!res?.ok) return retired;
  try {
    const list = (await res.json())?.retired;
    for (const r of Array.isArray(list) ? list : []) {
      if (retired.has(r?.digest)) continue;
      if (await signedRetirement(r)) retired.set(r.digest, { digest: r.digest, key: r.key, sig: r.sig });
    }
  } catch {
    // an unreadable list retires nothing
  }
  await writeState("retired", [...retired.keys()].sort().map((d) => retired.get(d)));
  return retired;
}

/** Downloads every file of `release` into a cache of its own, each checked against its hash, then makes it current. */
async function take(release, before) {
  const cache = await caches.open(FILES + release.digest);
  const old = before ? await caches.open(FILES + before.digest) : null;
  const oldByHash = new Map(before ? Object.entries(before.files).map(([p, h]) => [h, p]) : []);
  const one = async (path) => {
    const want = release.files[path];
    if (await cache.match(scoped(path))) return;
    // An unchanged file comes from the device; anything else from the host.
    const kept = oldByHash.has(want) ? await old.match(scoped(oldByHash.get(want))) : null;
    let bytes = kept ? await kept.arrayBuffer() : null;
    if (!bytes || (await sha256(bytes)) !== want) {
      const res = await fresh(path);
      bytes = res.ok ? await res.arrayBuffer() : null;
    }
    if (!bytes || (await sha256(bytes)) !== want) throw new Error(`${path} doesn't match the release`);
    await cache.put(scoped(path), new Response(bytes));
  };
  // A few at a time; the first file that doesn't match stops the rest.
  const queue = Object.keys(release.files);
  let failed = null;
  await Promise.all(
    Array.from({ length: 6 }, async () => {
      while (queue.length > 0 && !failed) {
        await one(queue.shift()).catch((e) => {
          failed = e;
        });
      }
    }),
  );
  // What did match stays for the next try (the bundle is large: the Aleo SDK's WebAssembly is most
  // of it); the release is taken only once every file is here.
  if (failed) throw failed;
  await writeState("previous", before);
  await writeState("current", release);
  await writeState("withdrawn", false);
  await dropOthers(release, before);
}

let checking = null;
let lastCheck = 0;

/** Looks at the host's release (one look at a time) and takes it when it may. */
function check() {
  checking ??= (async () => {
    lastCheck = Date.now();
    try {
      const retired = await learnRetirements();
      let have = await current();
      const before = await previous();
      if (before && retired.has(before.digest)) await writeState("previous", null);
      if (have && retired.has(have.digest)) {
        // Nothing from it again, and nothing from the host until it publishes a release that isn't retired.
        await writeState("current", null);
        await writeState("previous", null);
        await writeState("withdrawn", true);
        await dropOthers();
        have = null;
      }
      const { release, problem } = await signedRelease();
      if (!release) return await note(problem);
      if (have?.digest === release.digest) return await note(null);
      if (retired.has(release.digest)) return await note("the host serves a retired release");
      if (have && release.created < have.created) return await note("the host serves an older release");
      await take(release, have);
      await note(null);
    } catch (e) {
      await note(String(e?.message ?? e)).catch(() => {});
    } finally {
      checking = null;
    }
  })();
  return checking;
}

// ---------------------------------------------------------------------------
// Serving.
// ---------------------------------------------------------------------------

/** The file a path names in a release, as a plain file host finds it. */
function fileFor(pathname, files) {
  let p;
  try {
    p = decodeURIComponent(pathname).replace(/^\/+/, "");
  } catch {
    return null;
  }
  const tries = p === "" || p.endsWith("/") ? [p + "index.html"] : [p, p + "/index.html", p + ".html"];
  return tries.find((t) => Object.hasOwn(files, t)) ?? null;
}

const typeOf = (path) => TYPES[path.slice(path.lastIndexOf(".") + 1).toLowerCase()] ?? "application/octet-stream";

/** A page's own policy, from its meta tag, plus what only a header can say. */
function pagePolicy(bytes) {
  const meta = /<meta http-equiv="Content-Security-Policy" content="([^"]*)"/i.exec(new TextDecoder().decode(bytes));
  const own = meta ? meta[1].replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&") : "";
  return own ? `${own}; frame-ancestors 'none'` : "frame-ancestors 'none'";
}

/** A response with the security headers. */
function respond(body, type, status = 200) {
  const headers = new Headers(CONFIG.headers);
  headers.set("Content-Type", type);
  headers.set("Content-Security-Policy", type.startsWith("text/html") ? pagePolicy(body) : "frame-ancestors 'none'");
  return new Response(body, { status, headers });
}

const refuse = (status, text) => respond(utf8(text), "text/plain; charset=utf-8", status);

/** The bytes of `path` in `release`, from the device or else the host, and only when they match. */
async function verifiedBytes(release, path) {
  const want = release.files[path];
  const cache = await caches.open(FILES + release.digest);
  const kept = await cache.match(scoped(path));
  if (kept) {
    const bytes = await kept.arrayBuffer();
    if ((await sha256(bytes)) === want) return bytes;
    await cache.delete(scoped(path));
  }
  const res = await fresh(path).catch(() => null);
  if (!res?.ok) return null;
  const bytes = await res.arrayBuffer();
  if ((await sha256(bytes)) !== want) return null;
  await cache.put(scoped(path), new Response(bytes));
  return bytes;
}

/** No release on this device (none published yet, or the first visit): the host's file as served, with the headers. */
async function passThrough(request) {
  const res = await fetch(request);
  if (res.type !== "basic" || [101, 204, 205, 304].includes(res.status)) return res;
  return respond(await res.arrayBuffer(), res.headers.get("Content-Type") ?? "application/octet-stream", res.status);
}

async function serve(request, url) {
  const release = await current();
  if (!release) return (await readState("withdrawn", false)) ? refuse(503, WITHDRAWN) : passThrough(request);
  const navigate = request.mode === "navigate";
  let from = release;
  let path = fileFor(url.pathname, release.files);
  if (!path && !navigate) {
    // A page opened before the last update asks for one of its own files.
    from = await previous();
    path = from ? fileFor(url.pathname, from.files) : null;
  }
  if (!path) {
    const missing = navigate && Object.hasOwn(release.files, "404.html") ? await verifiedBytes(release, "404.html") : null;
    return missing ? respond(missing, typeOf("404.html"), 404) : refuse(404, "Not part of this release.");
  }
  // A folder asked for without its slash is sent to the folder, as a file host does.
  if (navigate && path.endsWith("index.html") && path !== url.pathname.replace(/^\/+/, "") && !url.pathname.endsWith("/")) {
    return Response.redirect(`${url.origin}${url.pathname}/${url.search}`, 301);
  }
  const bytes = await verifiedBytes(from, path);
  return bytes ? respond(bytes, typeOf(path)) : refuse(502, MISMATCH);
}

// ---------------------------------------------------------------------------
// Events.
// ---------------------------------------------------------------------------

self.addEventListener("install", (event) => {
  // Installs even when the host's release can't be taken: the release on the device stays.
  event.waitUntil(check().catch(() => {}));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const have = await current();
      if (have) await dropOthers(have, await previous());
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (PASS.has(url.pathname.replace(/^\/+/, ""))) return;
  event.respondWith(serve(request, url));
  if (request.mode === "navigate" && Date.now() - lastCheck > CHECK_EVERY_MS) event.waitUntil(check());
});

// From a page: "check" looks at the host's release now (after any look in progress), "status"
// answers what the device holds. Either answers on the port it brings, if any.
self.addEventListener("message", (event) => {
  const type = event.data?.type;
  if (type !== "check" && type !== "status") return;
  event.waitUntil(
    (async () => {
      if (type === "check") {
        await checking;
        await check();
      }
      const have = await current();
      event.ports?.[0]?.postMessage({
        version: have?.version ?? null,
        digest: have?.digest ?? null,
        withdrawn: await readState("withdrawn", false),
        problem: await readState("problem", null),
      });
    })(),
  );
});
