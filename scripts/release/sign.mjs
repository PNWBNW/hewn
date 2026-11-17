// Signs a release on the operator's own machine (README.md beside this file).
//
//   node scripts/release/sign.mjs [bundle or release.json] --key <private key file>
//
// Checks release.json first (its digest is its files'; given a bundle, every file matches it and
// nothing else is there), signs the 32 digest bytes with Ed25519 and writes release.sig beside
// release.json. Asks for the passphrase when the key file is encrypted. Prints the digest and
// the key id only: never the key or the passphrase.

import { sign as edSign, verify as edVerify, createPublicKey } from "node:crypto";
import { lstatSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { BRAND_RELEASE_KEYS, MANIFEST, ReleaseError, SIGNATURE, buildIds, compareFiles, hashBundle, keyId, parseArgs, parseManifest, rawPublicKey, run } from "./lib.mjs";
import { askHidden, readReleaseKey } from "./keys.mjs";
import { DEFAULT_BUNDLE } from "./manifest.mjs";

/** Where release.json is, and the bundle beside it when a directory was given. */
export function locate(target) {
  const path = resolve(target);
  const isDir = lstatSync(path, { throwIfNoEntry: false })?.isDirectory() ?? false;
  return isDir ? { manifestPath: join(path, MANIFEST), bundle: path } : { manifestPath: path, bundle: null };
}

/** Signs the release at `target` with `privateKey` (a KeyObject); writes release.sig and returns {digest, key, path}. */
export function signRelease(target, privateKey) {
  const { manifestPath, bundle } = locate(target);
  let text;
  try {
    text = readFileSync(manifestPath, "utf8");
  } catch {
    throw new ReleaseError(`No ${MANIFEST} at ${manifestPath}: write it with manifest.mjs or build.mjs first`);
  }
  const manifest = parseManifest(text);
  const ids = buildIds(manifest.files);
  if (ids.some((id) => id !== manifest.commit)) throw new ReleaseError(`${MANIFEST} names commit ${manifest.commit}, but the bundle was built as ${ids.join(", ")}; nothing was signed`);
  if (bundle) {
    const problems = compareFiles(manifest.files, hashBundle(bundle), { complete: true });
    if (problems.length > 0) throw new ReleaseError(`The bundle doesn't match its ${MANIFEST}; nothing was signed:\n  ${problems.slice(0, 20).join("\n  ")}`);
  }
  const digest = Buffer.from(manifest.digest, "hex");
  const sig = edSign(null, digest, privateKey);
  const pub = createPublicKey(privateKey);
  if (!edVerify(null, digest, pub, sig)) throw new ReleaseError("The signature didn't check against its own key; nothing was written");
  const key = keyId(rawPublicKey(pub));
  const path = join(dirname(manifestPath), SIGNATURE);
  writeFileSync(path, JSON.stringify({ key, sig: sig.toString("base64") }) + "\n");
  return { digest: manifest.digest, key, path, version: manifest.version };
}

async function main() {
  const args = parseArgs(process.argv.slice(2), { values: ["key"] });
  if (args._.length > 1 || !args.key) throw new ReleaseError("Usage: sign.mjs [bundle or release.json] --key <private key file>");
  const privateKey = await readReleaseKey(resolve(args.key.at(-1)), () => askHidden("Passphrase for the release key: "));
  const r = signRelease(args._[0] ?? DEFAULT_BUNDLE, privateKey);
  console.log(`Signed ${r.version}: digest ${r.digest}, key ${r.key}`);
  console.log(`${SIGNATURE} written to ${r.path}`);
  if (!BRAND_RELEASE_KEYS.some((k) => k.id === r.key)) console.log(`Key ${r.key} isn't in releaseKeys (packages/brand) yet: verify.mjs refuses this release until it is, or until it is given with --key.`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) run(main);
