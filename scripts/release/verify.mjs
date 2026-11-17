// Checks a release, for anyone, from anywhere (README.md beside this file).
//
//   node scripts/release/verify.mjs <bundle directory | https://host/base/> [--key <base64 public key>]... [--anchor] [--endpoint <explorer>]
//
// 1. release.json is well formed and its digest is the SHA-256 of its list of files.
// 2. release.sig is an Ed25519 signature of that digest by a release key: those in @pnw/brand
//    `releaseKeys`, or only the ones given with --key.
// 3. Every listed file is there with the listed SHA-256: read from the directory (where a file
//    the list doesn't name is a problem too), or fetched from the URL.
// 4. With --anchor, the digest is anchored on Aleo (payroll_audit_log, audit_event_height), read
//    from the explorer: the block it first appeared in.
// Exits 0 when every check passes, 1 with one plain line per problem otherwise.

import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  AUDIT_LOG_PROGRAM,
  BRAND_RELEASE_KEYS,
  DEFAULT_ENDPOINT,
  MANIFEST,
  ReleaseError,
  SIGNATURE,
  anchorHeight,
  checkSignature,
  compareFiles,
  hashBundle,
  parseArgs,
  parseManifest,
  parseSignature,
  run,
  sha256Hex,
  trustedKeys,
} from "./lib.mjs";

/** A bundle on disk. Every file in it counts. */
export function dirSource(dir) {
  return {
    label: dir,
    complete: true,
    text: async (name) => {
      try {
        return readFileSync(join(dir, name), "utf8");
      } catch {
        throw new ReleaseError(`No ${name} in ${dir}`);
      }
    },
    hashes: async () => hashBundle(dir),
  };
}

const LOCAL = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** A bundle served at a URL. Only the listed files are fetched. */
export function urlSource(base, fetchImpl = fetch, concurrency = 8) {
  let url;
  try {
    url = new URL(base.endsWith("/") ? base : `${base}/`);
  } catch {
    throw new ReleaseError(`Not a URL: ${base}`);
  }
  if (url.protocol !== "https:" && !(url.protocol === "http:" && LOCAL.has(url.hostname))) throw new ReleaseError("A release is fetched over https (http only from this machine)");
  if (url.search || url.hash) throw new ReleaseError("The base URL takes no query or fragment");
  const at = (path) => new URL(path.split("/").map(encodeURIComponent).join("/"), url);
  const get = async (path) => {
    const res = await fetchImpl(at(path), { cache: "no-store", signal: AbortSignal.timeout(30_000) });
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  };
  return {
    label: url.href,
    complete: false,
    text: async (name) => {
      const body = await get(name).catch(() => null);
      if (!body) throw new ReleaseError(`Couldn't fetch ${name} from ${url.href}`);
      return body.toString("utf8");
    },
    hashes: async (paths) => {
      const out = Object.create(null);
      let next = 0;
      const worker = async () => {
        while (next < paths.length) {
          const path = paths[next++];
          const body = await get(path).catch(() => null);
          out[path] = body ? sha256Hex(body) : null;
        }
      };
      await Promise.all(Array.from({ length: Math.min(concurrency, paths.length) }, worker));
      return out;
    },
  };
}

/**
 * Runs the checks. `keys` are {id?, publicKey} entries to trust; `anchor`, when given, is
 * {endpoint, fetchImpl?}. Returns the manifest, the problems found (empty when it checks out),
 * the signing key's id and the anchor's block.
 */
export async function verifyRelease(source, { keys = BRAND_RELEASE_KEYS, anchor = null } = {}) {
  const manifest = parseManifest(await source.text(MANIFEST));
  const problems = [];
  let signer = null;
  try {
    signer = checkSignature(manifest.digest, parseSignature(await source.text(SIGNATURE)), trustedKeys(keys));
  } catch (e) {
    if (!(e instanceof ReleaseError)) throw e;
    problems.push(e.message);
  }
  const actual = await source.hashes(Object.keys(manifest.files));
  problems.push(...compareFiles(manifest.files, actual, { complete: source.complete }));
  let height = null;
  if (anchor) {
    try {
      height = await anchorHeight(anchor.endpoint, AUDIT_LOG_PROGRAM, manifest.digest, anchor.fetchImpl);
      if (height === null) problems.push(`The digest isn't anchored on Aleo (${AUDIT_LOG_PROGRAM}, audit_event_height)`);
    } catch (e) {
      if (!(e instanceof ReleaseError)) throw e;
      problems.push(`Couldn't read the anchor: ${e.message}`);
    }
  }
  return { manifest, problems, signer, height };
}

async function main() {
  const args = parseArgs(process.argv.slice(2), { values: ["key", "endpoint"], flags: ["anchor"] });
  if (args._.length !== 1) throw new ReleaseError("Usage: verify.mjs <bundle directory | https://host/base/> [--key <base64 public key>]... [--anchor] [--endpoint <explorer>]");
  const target = args._[0];
  const source = /^https?:\/\//i.test(target) ? urlSource(target) : dirSource(resolve(target));
  const keys = args.key ? args.key.map((publicKey) => ({ publicKey })) : BRAND_RELEASE_KEYS;
  const anchor = args.anchor ? { endpoint: args.endpoint?.at(-1) ?? DEFAULT_ENDPOINT } : null;
  const { manifest, problems, signer, height } = await verifyRelease(source, { keys, anchor });
  console.log(`${manifest.version} (commit ${manifest.commit}, ${manifest.created}): ${Object.keys(manifest.files).length} files, digest ${manifest.digest}`);
  if (problems.length > 0) {
    console.error(`NOT VERIFIED: ${source.label}`);
    for (const p of problems.slice(0, 50)) console.error(`  ${p}`);
    if (problems.length > 50) console.error(`  … and ${problems.length - 50} more`);
    return 1;
  }
  console.log(`Signed by release key ${signer}; every file matches${source.complete ? ", and there is nothing else" : ""}.`);
  if (height !== null) console.log(`Anchored on Aleo in block ${height}.`);
  console.log(`VERIFIED: ${source.label}`);
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) run(main);
