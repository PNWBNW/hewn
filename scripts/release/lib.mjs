// The release format and its checks, shared by the release scripts (README.md beside this file).
//
// A release is the static bundle (apps/business/out) plus two files at its root:
//
//   release.json  {"version", "commit" (40 hex), "created" (YYYY-MM-DD),
//                  "files": {"<path, forward slashes, sorted>": "<sha256 hex>"},
//                  "digest": "<sha256 hex of the canonical JSON of files>"}
//   release.sig   {"key": "<first 16 hex of sha256 of the raw 32-byte public key>",
//                  "sig": "<base64 Ed25519 signature over the 32 raw digest bytes>"}
//
// The canonical JSON of `files` is `{"<path>":"<hash>",...}` with the paths in byte order and no
// whitespace, hashed as UTF-8. Paths are printable ASCII without `"` or `\`, so each is written as
// itself between quotes and any language gets the same bytes (in JavaScript: Object.keys().sort(),
// then JSON.stringify of each key and value). release.json and release.sig are never listed.
//
// Node's own modules only, plus @pnw/brand (the trusted keys) and @pnw/config (the program and the
// explorer), read from their source. Nothing here reads, prints or logs a private key.

import { createHash, createPublicKey, verify as edVerify } from "node:crypto";
import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { releaseKeys } from "../../packages/brand/src/index.ts";
import { ENV } from "../../packages/config/src/env.ts";
import { PROGRAMS } from "../../packages/config/src/programs.ts";

export const MANIFEST = "release.json";
export const SIGNATURE = "release.sig";
const OWN = new Set([MANIFEST, SIGNATURE]);

/** The release public keys this copy trusts (@pnw/brand). */
export const BRAND_RELEASE_KEYS = releaseKeys;
/** Where releases are anchored (@pnw/config): the program the app anchors closed periods with. */
export const AUDIT_LOG_PROGRAM = PROGRAMS.layer1.payroll_audit_log;
/** The explorer the app reads (@pnw/config). */
export const DEFAULT_ENDPOINT = ENV.ALEO_ENDPOINT;

const HEX64 = /^[0-9a-f]{64}$/;
const COMMIT = /^[0-9a-f]{40}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const KEY_ID = /^[0-9a-f]{16}$/;

/** Thrown for anything a person should read: the scripts print the message alone and exit 1. */
export class ReleaseError extends Error {}

export const sha256Hex = (bytes) => createHash("sha256").update(bytes).digest("hex");

/** The canonical JSON of a files object: keys sorted, no whitespace. */
export function canonicalFiles(files) {
  return "{" + Object.keys(files).sort().map((path) => `${JSON.stringify(path)}:${JSON.stringify(files[path])}`).join(",") + "}";
}

/** The release digest: SHA-256 of the canonical JSON of the files object, as hex. */
export const filesDigest = (files) => sha256Hex(Buffer.from(canonicalFiles(files), "utf8"));

/**
 * A path as release.json may name it: printable ASCII without `"` or `\`, relative, forward
 * slashes, no empty, `.` or `..` segment. Checked before any path from a manifest is read or fetched.
 */
export function safePath(path) {
  if (typeof path !== "string" || path.length === 0 || path.length > 1024) return false;
  if (path.startsWith("/") || !/^[\x20-\x7e]+$/.test(path) || /["\\]/.test(path)) return false;
  return path.split("/").every((seg) => seg !== "" && seg !== "." && seg !== "..");
}

/** Every file under `dir` as bundle paths, sorted, without release.json and release.sig at the root. */
export function bundleFiles(dir) {
  const out = [];
  const walk = (d) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const full = join(d, entry.name);
      const rel = relative(dir, full).split(sep).join("/");
      if (entry.isSymbolicLink()) throw new ReleaseError(`The bundle holds a link, which a release can't: ${rel}`);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) {
        if (!OWN.has(rel)) out.push(rel);
      } else throw new ReleaseError(`The bundle holds something that isn't a file: ${rel}`);
    }
  };
  if (!lstatSync(dir, { throwIfNoEntry: false })?.isDirectory()) throw new ReleaseError(`No bundle at ${dir}`);
  walk(dir);
  for (const rel of out) if (!safePath(rel)) throw new ReleaseError(`A file name a release can't carry: ${JSON.stringify(rel)}`);
  return out.sort();
}

/** The files object of a bundle directory: each path with its SHA-256. */
export function hashBundle(dir) {
  const files = Object.create(null); // no prototype: a file named __proto__ is a file like any other
  for (const rel of bundleFiles(dir)) files[rel] = sha256Hex(readFileSync(join(dir, ...rel.split("/"))));
  return files;
}

/** The release.json object for a bundle directory. */
export function buildManifest(dir, { version, commit, created }) {
  if (typeof version !== "string" || !/^[0-9A-Za-z][0-9A-Za-z._+-]{0,63}$/.test(version)) throw new ReleaseError("A version is letters, digits, dots, dashes or plus signs, as in v1.2");
  if (!COMMIT.test(commit ?? "")) throw new ReleaseError("A commit is 40 hex characters");
  if (!DAY.test(created ?? "")) throw new ReleaseError("A release date is YYYY-MM-DD");
  const files = hashBundle(dir);
  if (Object.keys(files).length === 0) throw new ReleaseError(`The bundle at ${dir} is empty`);
  return { version, commit, created, files, digest: filesDigest(files) };
}

/** release.json as written: two-space indent, files in sorted order, a final newline. */
export function manifestText(manifest) {
  const { version, commit, created, files, digest } = manifest;
  const q = JSON.stringify;
  const list = Object.keys(files).sort().map((path) => `    ${q(path)}: ${q(files[path])}`).join(",\n");
  return `{\n  "version": ${q(version)},\n  "commit": ${q(commit)},\n  "created": ${q(created)},\n  "files": {\n${list}\n  },\n  "digest": ${q(digest)}\n}\n`;
}

/** Parses and checks a release.json: its shape, every path, and that the digest is the files'. */
export function parseManifest(text) {
  let m;
  try {
    m = JSON.parse(text);
  } catch {
    throw new ReleaseError("release.json isn't JSON");
  }
  if (!m || typeof m !== "object" || Array.isArray(m)) throw new ReleaseError("release.json isn't an object");
  if (typeof m.version !== "string" || m.version.length === 0) throw new ReleaseError("release.json has no version");
  if (!COMMIT.test(m.commit ?? "")) throw new ReleaseError("release.json's commit isn't 40 hex characters");
  if (!DAY.test(m.created ?? "")) throw new ReleaseError("release.json's date isn't YYYY-MM-DD");
  if (!HEX64.test(m.digest ?? "")) throw new ReleaseError("release.json's digest isn't 64 hex characters");
  if (!m.files || typeof m.files !== "object" || Array.isArray(m.files)) throw new ReleaseError("release.json has no files");
  const paths = Object.keys(m.files);
  if (paths.length === 0) throw new ReleaseError("release.json lists no files");
  for (const p of paths) {
    if (!safePath(p) || OWN.has(p)) throw new ReleaseError(`release.json lists a path a release can't carry: ${JSON.stringify(p)}`);
    if (!HEX64.test(m.files[p])) throw new ReleaseError(`release.json's hash for ${p} isn't 64 hex characters`);
  }
  if (filesDigest(m.files) !== m.digest) throw new ReleaseError("release.json's digest doesn't match its list of files");
  return m;
}

// ---------------------------------------------------------------------------
// Keys and signatures (Ed25519 over the 32 raw digest bytes).
// ---------------------------------------------------------------------------

/** The raw 32-byte public key of a node KeyObject (public or private). */
export function rawPublicKey(keyObject) {
  const pub = keyObject.type === "private" ? createPublicKey(keyObject) : keyObject;
  if (pub.asymmetricKeyType !== "ed25519") throw new ReleaseError("A release key is an Ed25519 key");
  return Buffer.from(pub.export({ format: "jwk" }).x, "base64url");
}

/** A key's id: the first 16 hex characters of the SHA-256 of its raw 32-byte public key. */
export const keyId = (raw) => sha256Hex(raw).slice(0, 16);

/** A public KeyObject from base64 raw 32 bytes. */
export function publicKeyFromBase64(b64) {
  const raw = Buffer.from(String(b64), "base64");
  if (raw.length !== 32 || raw.toString("base64") !== String(b64)) throw new ReleaseError("A release public key is 32 bytes in base64");
  return { raw, key: createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x: raw.toString("base64url") }, format: "jwk" }) };
}

/** Trusted keys as a map from id to KeyObject, checking each entry's id against its key. */
export function trustedKeys(entries) {
  const out = new Map();
  for (const entry of entries) {
    const { raw, key } = publicKeyFromBase64(entry.publicKey);
    const id = keyId(raw);
    if (entry.id !== undefined && entry.id !== id) throw new ReleaseError(`A release key's id says ${entry.id}, but its key's id is ${id}`);
    out.set(id, key);
  }
  return out;
}

export function parseSignature(text) {
  let s;
  try {
    s = JSON.parse(text);
  } catch {
    throw new ReleaseError("release.sig isn't JSON");
  }
  if (!s || typeof s !== "object" || !KEY_ID.test(s.key ?? "") || typeof s.sig !== "string") throw new ReleaseError("release.sig needs a key id (16 hex) and a signature");
  const sig = Buffer.from(s.sig, "base64");
  if (sig.length !== 64 || sig.toString("base64") !== s.sig) throw new ReleaseError("release.sig's signature isn't 64 bytes in base64");
  return { key: s.key, sig };
}

/** Whether `sig` (release.sig, parsed) signs `digest` (hex) under one of `keys` (id → KeyObject). */
export function checkSignature(digest, sig, keys) {
  if (keys.size === 0) throw new ReleaseError("No release keys to check against: none are published yet. Pass --key with the public key to trust.");
  const key = keys.get(sig.key);
  if (!key) throw new ReleaseError(`release.sig is signed by key ${sig.key}, which isn't a release key`);
  if (!edVerify(null, Buffer.from(digest, "hex"), key, sig.sig)) throw new ReleaseError(`release.sig doesn't sign this release's digest (key ${sig.key})`);
  return sig.key;
}

// ---------------------------------------------------------------------------
// The anchor: payroll_audit_log::anchor_event(event_hash: [u8; 32]) and its mapping
// audit_event_height, the same program the app anchors closed periods with
// (apps/business/src/chain/close_anchor.ts, period_check.ts).
// ---------------------------------------------------------------------------

function digestBytes(digest) {
  if (!HEX64.test(digest ?? "")) throw new ReleaseError("A digest is 64 hex characters");
  return [...Buffer.from(digest, "hex")];
}

/** The digest as the `[u8; 32]` literal anchor_event takes, as the app writes it (offer.ts bytesToAleoU8Array). */
export const u8Literal = (digest) => "[ " + digestBytes(digest).map((b) => `${b}u8`).join(", ") + " ]";

/** The digest as the mapping key in the explorer's path, as the app reads it (period_check.ts rootKey). */
export const mappingKey = (digest) => encodeURIComponent(`[${digestBytes(digest).map((b) => `${b}u8`).join(",")}]`);

export function anchorUrl(endpoint, program, digest) {
  return `${endpoint.replace(/\/+$/, "")}/program/${program}/mapping/audit_event_height/${mappingKey(digest)}`;
}

/** The block the digest was anchored at, or null when it never was. Read only. */
export async function anchorHeight(endpoint, program, digest, fetchImpl = fetch) {
  const res = await fetchImpl(anchorUrl(endpoint, program, digest), { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(15_000) });
  if (res.status === 404) return null;
  if (!res.ok) throw new ReleaseError(`The explorer answered ${res.status}`);
  const value = await res.json();
  if (value === null || value === undefined) return null;
  const m = typeof value === "string" ? /^\s*(\d+)u32\s*$/.exec(value) : null;
  if (!m) throw new ReleaseError("The explorer sent the anchor in an unexpected shape");
  const height = Number(m[1]);
  return height > 0 ? height : null;
}

// ---------------------------------------------------------------------------
// Checking a bundle against its manifest.
// ---------------------------------------------------------------------------

/**
 * Compares a bundle's files with a manifest's. `actual` maps path → hash (or null when a file
 * couldn't be read); `complete` says whether `actual` lists every file served (a directory) or
 * only the listed ones (a URL). Returns plain sentences, one per problem.
 */
export function compareFiles(expected, actual, { complete }) {
  const problems = [];
  for (const [path, hash] of Object.entries(expected)) {
    if (!Object.hasOwn(actual, path) || actual[path] === null) problems.push(`missing: ${path}`);
    else if (actual[path] !== hash) problems.push(`changed: ${path}`);
  }
  if (complete) for (const path of Object.keys(actual)) if (!Object.hasOwn(expected, path)) problems.push(`not in the release: ${path}`);
  return problems;
}

/** Parses `--name value` and `--flag` arguments; the rest are positional. */
export function parseArgs(argv, { values = [], flags = [] } = {}) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const name = a.slice(2);
      if (flags.includes(name)) out[name] = true;
      else if (values.includes(name)) {
        if (i + 1 >= argv.length) throw new ReleaseError(`--${name} needs a value`);
        (out[name] ??= []).push(argv[++i]);
      } else throw new ReleaseError(`Unknown option --${name}`);
    } else out._.push(a);
  }
  return out;
}

/** Runs a script's main, printing a ReleaseError's message alone (never a stack) and exiting 1. */
export function run(main) {
  main().then(
    (code) => process.exit(code ?? 0),
    (e) => {
      if (e instanceof ReleaseError) console.error(e.message);
      else console.error(`Failed: ${e?.message ?? e}`);
      process.exit(1);
    },
  );
}
