// Run: node --test scripts/release/release.test.mjs
// Every signing key here is made at test time and thrown away (INV-06).
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash, createPublicKey, generateKeyPairSync } from "node:crypto";
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RELEASE_KEY_FIXTURE, releaseKeys } from "../../packages/brand/src/index.ts";
import { PROGRAMS } from "../../packages/config/src/programs.ts";
import { digestOf } from "./anchor.mjs";
import { buildEnv } from "./build.mjs";
import { filesOf } from "./compare.mjs";
import { ROOT } from "./git.mjs";
import { generateReleaseKey, keyDestination, readReleaseKey } from "./keys.mjs";
import {
  AUDIT_LOG_PROGRAM,
  BRAND_RELEASE_KEYS,
  anchorHeight,
  anchorUrl,
  buildIds,
  buildManifest,
  canonicalFiles,
  filesDigest,
  keyId,
  manifestText,
  mappingKey,
  parseManifest,
  parseSignature,
  rawPublicKey,
  safePath,
  u8Literal,
} from "./lib.mjs";
import { releaseInputs, writeManifest } from "./manifest.mjs";
import { signRelease } from "./sign.mjs";
import { dirSource, urlSource, verifyRelease } from "./verify.mjs";

const FIXTURE = join(import.meta.dirname, "fixture", "bundle");
const HERE = import.meta.dirname;
const sha = (s) => createHash("sha256").update(s).digest("hex");
const tmp = () => mkdtempSync(join(tmpdir(), "hewn-release-test-"));
const COMMIT = "a".repeat(40);
const INPUTS = { version: "v9.9", commit: COMMIT, created: "2026-11-17" };

/** A copy of the fixture bundle in a fresh folder, to change. */
function fixtureCopy() {
  const dir = join(tmp(), "bundle");
  cpSync(FIXTURE, dir, { recursive: true });
  return dir;
}

function throwawayKey() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return { privateKey, publicKey: rawPublicKey(publicKey).toString("base64") };
}

const problemsOf = async (dir, keys) => (await verifyRelease(dirSource(dir), { keys })).problems;

// ---------------------------------------------------------------------------
// The format
// ---------------------------------------------------------------------------

test("the digest is the SHA-256 of the files' canonical JSON: sorted keys, no whitespace", () => {
  const files = { "b/index.html": "1".repeat(64), "a.js": "2".repeat(64), "10": "3".repeat(64) };
  const canonical = `{"10":"${"3".repeat(64)}","a.js":"${"2".repeat(64)}","b/index.html":"${"1".repeat(64)}"}`;
  assert.equal(canonicalFiles(files), canonical);
  assert.equal(filesDigest(files), sha(canonical));
});

test("release.json lists every file but itself and release.sig, sorted, with forward slashes", () => {
  const dir = fixtureCopy();
  const m = buildManifest(dir, INPUTS);
  assert.deepEqual(Object.keys(m.files), ["_next/static/app.css", "index.html", "terms/index.html"]);
  assert.equal(m.files["index.html"], sha(readFileSync(join(dir, "index.html"))));
  assert.equal(m.digest, filesDigest(m.files));
  assert.deepEqual(parseManifest(manifestText(m)), { ...m, files: { ...m.files } });
  // Writing it twice gives the same bytes, and the files it adds aren't listed.
  writeManifest(dir, INPUTS);
  const first = readFileSync(join(dir, "release.json"), "utf8");
  writeManifest(dir, INPUTS);
  assert.equal(readFileSync(join(dir, "release.json"), "utf8"), first);
});

test("the fixture's release.json is what manifest.mjs writes for its bundle", () => {
  const m = parseManifest(readFileSync(join(FIXTURE, "release.json"), "utf8"));
  assert.equal(readFileSync(join(FIXTURE, "release.json"), "utf8"), manifestText(buildManifest(FIXTURE, m)));
});

test("a changed byte changes the digest", () => {
  const dir = fixtureCopy();
  const before = buildManifest(dir, INPUTS).digest;
  writeFileSync(join(dir, "index.html"), readFileSync(join(dir, "index.html"), "utf8").replace("fixture", "fixturE"));
  assert.notEqual(buildManifest(dir, INPUTS).digest, before);
});

test("a bundle with a link or an odd file name is refused", () => {
  const dir = fixtureCopy();
  symlinkSync(join(dir, "index.html"), join(dir, "link.html"));
  assert.throws(() => buildManifest(dir, INPUTS), /a link/);
  const odd = fixtureCopy();
  writeFileSync(join(odd, 'quote".html'), "x");
  assert.throws(() => buildManifest(odd, INPUTS), /can't carry/);
});

test("the inputs are checked: a 40-hex commit, a YYYY-MM-DD date, a plain version", () => {
  assert.throws(() => buildManifest(FIXTURE, { ...INPUTS, commit: "abc" }), /40 hex/);
  assert.throws(() => buildManifest(FIXTURE, { ...INPUTS, created: "17/11/2026" }), /YYYY-MM-DD/);
  assert.throws(() => buildManifest(FIXTURE, { ...INPUTS, version: "v1 2" }), /version/);
  assert.deepEqual(releaseInputs({ commit: COMMIT, created: "2026-11-17" }), { version: `dev-${COMMIT.slice(0, 12)}`, commit: COMMIT, created: "2026-11-17" });
});

test("only plain relative paths are accepted from a manifest", () => {
  for (const ok of ["index.html", "_next/static/chunks/a-b_c.js", "terms/index.html", "[slug]/x.txt"]) assert.ok(safePath(ok), ok);
  for (const bad of ["", "/etc/passwd", "../x", "a/../b", "a//b", "a/./b", "a\\b", 'a"b', "a\nb", "é.html", "a/"]) assert.ok(!safePath(bad), JSON.stringify(bad));
});

test("a manifest that doesn't add up is refused", () => {
  const m = buildManifest(FIXTURE, INPUTS);
  const bad = (edit) => manifestText({ ...m, ...edit });
  assert.throws(() => parseManifest(bad({ digest: "0".repeat(64) })), /doesn't match its list/);
  assert.throws(() => parseManifest(bad({ files: { ...m.files, "../outside": "0".repeat(64) } })), /can't carry/);
  assert.throws(() => parseManifest(bad({ files: { ...m.files, "release.sig": "0".repeat(64) } })), /can't carry/);
  assert.throws(() => parseManifest(bad({ files: { "index.html": "XYZ" } })), /64 hex/);
  assert.throws(() => parseManifest(bad({ commit: "nope" })), /40 hex/);
  assert.throws(() => parseManifest("not json"), /isn't JSON/);
});

// ---------------------------------------------------------------------------
// Keys and verification
// ---------------------------------------------------------------------------

test("no key is trusted until the operator publishes one; the fixture key is never trusted", () => {
  assert.deepEqual([...releaseKeys], []);
  assert.equal(BRAND_RELEASE_KEYS, releaseKeys);
  const raw = Buffer.from(RELEASE_KEY_FIXTURE.publicKey, "base64");
  assert.equal(RELEASE_KEY_FIXTURE.id, keyId(raw));
});

test("the fixture verifies under the fixture key, and only under it", async () => {
  assert.deepEqual(await problemsOf(FIXTURE, [RELEASE_KEY_FIXTURE]), []);
  assert.match((await problemsOf(FIXTURE, releaseKeys)).join(), /No release keys/);
  assert.match((await problemsOf(FIXTURE, [{ publicKey: throwawayKey().publicKey }])).join(), /isn't a release key/);
  assert.throws(() => parseSignature('{"key":"e8605ea7f54dad93","sig":"short"}'), /64 bytes/);
});

test("a changed, missing or added file fails verification, naming the file", async () => {
  const changed = fixtureCopy();
  writeFileSync(join(changed, "terms", "index.html"), "<p>other terms</p>\n");
  assert.deepEqual(await problemsOf(changed, [RELEASE_KEY_FIXTURE]), ["changed: terms/index.html"]);
  const missing = fixtureCopy();
  rmSync(join(missing, "_next", "static", "app.css"));
  assert.deepEqual(await problemsOf(missing, [RELEASE_KEY_FIXTURE]), ["missing: _next/static/app.css"]);
  const added = fixtureCopy();
  writeFileSync(join(added, "extra.js"), "steal()");
  assert.deepEqual(await problemsOf(added, [RELEASE_KEY_FIXTURE]), ["not in the release: extra.js"]);
  for (const name of ["__proto__", "constructor", "toString"]) {
    const odd = fixtureCopy();
    writeFileSync(join(odd, name), "x");
    assert.deepEqual(await problemsOf(odd, [RELEASE_KEY_FIXTURE]), [`not in the release: ${name}`], name);
  }
});

test("a manifest edited to match changed files no longer matches its signature", async () => {
  const dir = fixtureCopy();
  writeFileSync(join(dir, "index.html"), "<p>changed</p>\n");
  const m = parseManifest(readFileSync(join(dir, "release.json"), "utf8"));
  writeManifest(dir, m); // the list and digest now describe the changed bundle
  assert.match((await problemsOf(dir, [RELEASE_KEY_FIXTURE])).join(), /doesn't sign this release's digest/);
});

test("sign then verify with a throwaway key; signing refuses a bundle that doesn't match its list", async () => {
  const dir = fixtureCopy();
  writeManifest(dir, INPUTS);
  const { privateKey, publicKey } = throwawayKey();
  const r = signRelease(dir, privateKey);
  assert.equal(r.key, keyId(Buffer.from(publicKey, "base64")));
  const sig = JSON.parse(readFileSync(join(dir, "release.sig"), "utf8"));
  assert.deepEqual(Object.keys(sig), ["key", "sig"]);
  assert.deepEqual(await problemsOf(dir, [{ publicKey }]), []);
  writeFileSync(join(dir, "index.html"), "late change");
  assert.throws(() => signRelease(dir, privateKey), /doesn't match/);
});

test("verify.mjs exits 0 on a good release and 1 with a plain message on a bad one", () => {
  const ok = spawnSync(process.execPath, [join(HERE, "verify.mjs"), FIXTURE, "--key", RELEASE_KEY_FIXTURE.publicKey], { encoding: "utf8" });
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /VERIFIED/);
  const dir = fixtureCopy();
  writeFileSync(join(dir, "index.html"), "x");
  const bad = spawnSync(process.execPath, [join(HERE, "verify.mjs"), dir, "--key", RELEASE_KEY_FIXTURE.publicKey], { encoding: "utf8" });
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /NOT VERIFIED[\s\S]*changed: index.html/);
  assert.doesNotMatch(bad.stderr, /at .*\.mjs:\d+/); // no stack trace
  const none = spawnSync(process.execPath, [join(HERE, "verify.mjs"), FIXTURE], { encoding: "utf8" });
  assert.equal(none.status, 1);
  assert.match(none.stderr, /No release keys/);
});

test("verifying from a URL fetches each listed file", async (t) => {
  const dir = fixtureCopy();
  let folderOverride = {};
  const server = createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (Object.hasOwn(folderOverride, pathname)) return res.end(folderOverride[pathname]);
    const path = pathname.replace(/^\/app\//, "").replace(/(^|\/)$/, "$1index.html");
    try {
      res.end(readFileSync(join(dir, ...path.split("/"))));
    } catch {
      res.statusCode = 404;
      res.end();
    }
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}/app`;
  assert.deepEqual((await verifyRelease(urlSource(base), { keys: [RELEASE_KEY_FIXTURE] })).problems, []);
  // A page is also checked at its folder's address, where a browser asks for it.
  folderOverride = { "/app/terms/": "<p>other terms at the folder's address</p>" };
  assert.deepEqual((await verifyRelease(urlSource(base), { keys: [RELEASE_KEY_FIXTURE] })).problems, ["changed: /terms/ (served differently from terms/index.html)"]);
  folderOverride = { "/app/": "<p>another front page</p>" };
  assert.deepEqual((await verifyRelease(urlSource(base), { keys: [RELEASE_KEY_FIXTURE] })).problems, ["changed: / (served differently from index.html)"]);
  folderOverride = {};
  writeFileSync(join(dir, "index.html"), "served something else");
  rmSync(join(dir, "terms", "index.html"));
  assert.deepEqual((await verifyRelease(urlSource(base), { keys: [RELEASE_KEY_FIXTURE] })).problems, ["changed: index.html", "missing: terms/index.html"]);
  assert.throws(() => urlSource("http://example.com/"), /https/);
  assert.throws(() => urlSource("https://example.com/?x=1"), /no query/);
});

test("the commit release.json names must be the bundle's build id, which the signature covers", async () => {
  const other = "b".repeat(40);
  assert.deepEqual(buildIds({ "_next/static/x/a.js": "0".repeat(64), [`_next/static/${COMMIT}/_ssgManifest.js`]: "0".repeat(64), [`_next/static/${COMMIT}/b.js`]: "0".repeat(64) }), [COMMIT]);
  const dir = fixtureCopy();
  mkdirSync(join(dir, "_next", "static", COMMIT), { recursive: true });
  writeFileSync(join(dir, "_next", "static", COMMIT, "_buildManifest.js"), "self.__BUILD_MANIFEST={}");
  const { privateKey, publicKey } = throwawayKey();
  writeManifest(dir, INPUTS);
  signRelease(dir, privateKey);
  const good = await verifyRelease(dirSource(dir), { keys: [{ publicKey }] });
  assert.deepEqual(good.problems, []);
  assert.equal(good.commitSigned, true);
  // The same signed list relabelled with another commit: the signature still checks (it covers the
  // files), the commit doesn't, and sign.mjs won't sign such a release.json either.
  writeManifest(dir, { ...INPUTS, commit: other, version: "v99.0" });
  assert.throws(() => signRelease(dir, privateKey), /built as .*nothing was signed/);
  assert.deepEqual((await verifyRelease(dirSource(dir), { keys: [{ publicKey }] })).problems, [`release.json names commit ${other}, but the bundle was built as ${COMMIT}`]);
  // A bundle with no build id (a plain build, the fixture) can't vouch for its commit.
  assert.equal((await verifyRelease(dirSource(FIXTURE), { keys: [RELEASE_KEY_FIXTURE] })).commitSigned, false);
});

// ---------------------------------------------------------------------------
// The release key on the operator's machine
// ---------------------------------------------------------------------------

test("a private key is never written inside this repository, a git checkout, or over a file", () => {
  assert.throws(() => keyDestination(join(ROOT, "release.pem")), /inside this repository/);
  assert.throws(() => keyDestination(join(ROOT, "scripts", "release", "k.pem")), /inside this repository/);
  assert.throws(() => keyDestination(join(tmp(), "no-such-folder", "k.pem")), /doesn't exist/);
  const checkout = tmp();
  execFileSync("git", ["init", "-q", checkout]);
  assert.throws(() => keyDestination(join(checkout, "k.pem")), /git checkout/);
  const taken = join(tmp(), "k.pem");
  writeFileSync(taken, "x");
  assert.throws(() => keyDestination(taken), /already exists/);
  assert.throws(() => keyDestination(""), /--out/);
});

test("keygen writes a 0600 PKCS8 key and returns only the public half", async () => {
  const out = join(tmp(), "release.pem");
  const key = generateReleaseKey({ out, passphrase: "a long test passphrase" });
  assert.deepEqual(Object.keys(key).sort(), ["id", "path", "publicKey"]);
  assert.equal(statSync(out).mode & 0o777, 0o600);
  const pem = readFileSync(out, "utf8");
  assert.match(pem, /^-----BEGIN ENCRYPTED /);
  await assert.rejects(readReleaseKey(out, async () => "wrong passphrase"), /wrong passphrase/);
  const privateKey = await readReleaseKey(out, async () => "a long test passphrase");
  assert.equal(keyId(rawPublicKey(createPublicKey(privateKey))), key.id);
  chmodSync(out, 0o644);
  await assert.rejects(readReleaseKey(out, async () => ""), /chmod 600/);
});

test("keygen.mjs and sign.mjs print the public key, the id and the digest, never the private key", () => {
  const folder = tmp();
  const out = join(folder, "release.pem");
  const gen = spawnSync(process.execPath, [join(HERE, "keygen.mjs"), "--out", out, "--no-passphrase"], { encoding: "utf8" });
  assert.equal(gen.status, 0, gen.stderr);
  const pem = readFileSync(out, "utf8");
  const body = pem.split("\n").filter((l) => l && !l.startsWith("-----")).join("");
  const secretPart = body.slice(-40);
  for (const stream of [gen.stdout, gen.stderr]) {
    assert.ok(!stream.includes(secretPart));
    assert.doesNotMatch(stream, /PRIVATE KEY-----/);
  }
  const id = /Key id\s+([0-9a-f]{16})/.exec(gen.stdout)?.[1];
  const pub = /Public key\s+(\S+)/.exec(gen.stdout)?.[1];
  assert.ok(id && pub);
  const dir = fixtureCopy();
  writeManifest(dir, INPUTS);
  const signed = spawnSync(process.execPath, [join(HERE, "sign.mjs"), dir, "--key", out], { encoding: "utf8" });
  assert.equal(signed.status, 0, signed.stderr);
  for (const stream of [signed.stdout, signed.stderr]) assert.ok(!stream.includes(secretPart));
  assert.match(signed.stdout, new RegExp(`key ${id}`));
  const verified = spawnSync(process.execPath, [join(HERE, "verify.mjs"), dir, "--key", pub], { encoding: "utf8" });
  assert.equal(verified.status, 0, verified.stderr);
  const inside = spawnSync(process.execPath, [join(HERE, "keygen.mjs"), "--out", join(ROOT, "x.pem"), "--no-passphrase"], { encoding: "utf8" });
  assert.equal(inside.status, 1);
  assert.match(inside.stderr, /inside this repository/);
});

// ---------------------------------------------------------------------------
// The anchor
// ---------------------------------------------------------------------------

const DIGEST = "f0cb" + "00".repeat(28) + "ff01";

test("the anchor goes to payroll_audit_log from @pnw/config, as the app's closes do", () => {
  assert.equal(AUDIT_LOG_PROGRAM, PROGRAMS.layer1.payroll_audit_log);
  assert.equal(u8Literal(DIGEST), `[ 240u8, 203u8, ${"0u8, ".repeat(28)}255u8, 1u8 ]`);
  assert.equal(decodeURIComponent(mappingKey(DIGEST)), `[240u8,203u8,${"0u8,".repeat(28)}255u8,1u8]`);
  assert.equal(
    anchorUrl("https://example.test/v2/testnet/", AUDIT_LOG_PROGRAM, DIGEST),
    `https://example.test/v2/testnet/program/${AUDIT_LOG_PROGRAM}/mapping/audit_event_height/${mappingKey(DIGEST)}`,
  );
  assert.throws(() => u8Literal("abc"), /64 hex/);
  assert.equal(digestOf(FIXTURE), parseManifest(readFileSync(join(FIXTURE, "release.json"), "utf8")).digest);
  assert.equal(digestOf(DIGEST), DIGEST);
});

test("the anchor check reads the block height, and says when there is none", async () => {
  const answer = (status, body) => async () => new Response(body === undefined ? null : JSON.stringify(body), { status });
  assert.equal(await anchorHeight("https://e.test", AUDIT_LOG_PROGRAM, DIGEST, answer(200, "21235519u32")), 21235519);
  assert.equal(await anchorHeight("https://e.test", AUDIT_LOG_PROGRAM, DIGEST, answer(200, null)), null);
  assert.equal(await anchorHeight("https://e.test", AUDIT_LOG_PROGRAM, DIGEST, answer(404)), null);
  await assert.rejects(anchorHeight("https://e.test", AUDIT_LOG_PROGRAM, DIGEST, answer(500)), /answered 500/);
  await assert.rejects(anchorHeight("https://e.test", AUDIT_LOG_PROGRAM, DIGEST, answer(200, { height: 1 })), /unexpected shape/);
});

// ---------------------------------------------------------------------------
// The build and the comparison
// ---------------------------------------------------------------------------

test("a release build sees a fixed environment: the commit as build id, nothing of the machine's", () => {
  const env = buildEnv(COMMIT, { PATH: "/bin", HOME: "/h", NEXT_PUBLIC_APP_URL: "https://elsewhere.test", VERCEL_GIT_COMMIT_SHA: "b".repeat(40), HEWN_STATIC: "0", TZ: "Pacific/Auckland", SECRET_THING: "x" });
  assert.deepEqual(env, { PATH: "/bin", HOME: "/h", HEWN_BUILD_ID: COMMIT, TZ: "UTC", LANG: "C.UTF-8", LC_ALL: "C.UTF-8", NEXT_TELEMETRY_DISABLED: "1", NODE_ENV: "production" });
});

test("compare.mjs: same release from a bundle and its release.json; different ones name the files", () => {
  assert.deepEqual({ ...filesOf(FIXTURE) }, parseManifest(readFileSync(join(FIXTURE, "release.json"), "utf8")).files);
  const same = spawnSync(process.execPath, [join(HERE, "compare.mjs"), FIXTURE, join(FIXTURE, "release.json")], { encoding: "utf8" });
  assert.equal(same.status, 0, same.stderr);
  const other = fixtureCopy();
  writeFileSync(join(other, "terms", "index.html"), "y");
  mkdirSync(join(other, "new"));
  writeFileSync(join(other, "new", "a.js"), "z");
  const diff = spawnSync(process.execPath, [join(HERE, "compare.mjs"), FIXTURE, other], { encoding: "utf8" });
  assert.equal(diff.status, 1);
  assert.match(diff.stderr, /changed: terms\/index.html/);
  assert.match(diff.stderr, /only in the second: new\/a.js/);
});
