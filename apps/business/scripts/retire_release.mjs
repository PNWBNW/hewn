// Signs the retirement of a bad release, on the operator's own machine (src/updates/README.md).
//
//   node apps/business/scripts/retire_release.mjs <digest> --key <private key file> [--list <release-retired.json>]
//
// The key is the release key (Ed25519, PKCS8 PEM, as scripts/release/keygen.mjs writes it); the
// passphrase is asked on the terminal when the file is encrypted. Adds the signed entry to the
// list (a new file when there is none), checks the signature against the key's own public half,
// and prints the digest and the key id only: never the key or the passphrase. Publish the list at
// the bundle's root on every host, beside release.json. Node's own modules only, plus @pnw/brand
// (to warn when the key isn't one of this copy's release keys).

import { createHash, createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { releaseKeys } from "@pnw/brand";
import { addRetirement, parseRetired, retireMessage, RETIRED_FILE } from "../src/updates/retire.ts";

function fail(message) {
  console.error(message);
  process.exit(1);
}

function args(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--key" || argv[i] === "--list") out[argv[i].slice(2)] = argv[++i];
    else if (argv[i].startsWith("--")) fail(`Unknown option ${argv[i]}`);
    else out._.push(argv[i]);
  }
  return out;
}

/** Asks for the passphrase without showing it. */
function askHidden(question) {
  return new Promise((done) => {
    const input = process.stdin;
    if (!input.isTTY) fail("The passphrase is asked on a terminal: run this in one");
    process.stderr.write(question);
    let value = "";
    input.setRawMode(true);
    input.setEncoding("utf8");
    input.resume();
    input.on("data", (chunk) => {
      for (const ch of chunk) {
        if (ch === "\u0003" || ch === "\u0004") fail("\nCancelled");
        if (ch === "\r" || ch === "\n") {
          input.setRawMode(false);
          input.pause();
          process.stderr.write("\n");
          return done(value);
        }
        value = ch === "\u007f" || ch === "\b" ? value.slice(0, -1) : value + ch;
      }
    });
  });
}

async function main() {
  const a = args(process.argv.slice(2));
  const [digest] = a._;
  if (a._.length !== 1 || !a.key) fail("Usage: retire_release.mjs <digest> --key <private key file> [--list <release-retired.json>]");
  const message = (() => {
    try {
      return retireMessage(digest);
    } catch (e) {
      return fail(e.message);
    }
  })();
  const keyPath = resolve(a.key);
  if (!existsSync(keyPath)) fail(`No key file at ${keyPath}`);
  if (process.platform !== "win32" && (statSync(keyPath).mode & 0o077) !== 0) fail(`The key file ${keyPath} can be read by others: run chmod 600 on it first`);
  const pem = readFileSync(keyPath, "utf8");
  let privateKey;
  try {
    const passphrase = /-----BEGIN ENCRYPTED /.test(pem) ? await askHidden("Passphrase for the release key: ") : undefined;
    privateKey = createPrivateKey({ key: pem, format: "pem", passphrase });
  } catch {
    fail("Couldn't read the key file: a wrong passphrase, or not a release key");
  }
  if (privateKey.asymmetricKeyType !== "ed25519") fail("The key file holds a key that isn't Ed25519");

  const publicKey = createPublicKey(privateKey);
  const raw = Buffer.from(publicKey.export({ format: "jwk" }).x, "base64url");
  const key = createHash("sha256").update(raw).digest("hex").slice(0, 16);
  const sig = sign(null, message, privateKey);
  if (!verify(null, message, publicKey, sig)) fail("The signature didn't check against its own key; nothing was written");

  if (!releaseKeys.some((k) => k.id === key)) {
    console.error(`Warning: key ${key} isn't in releaseKeys (@pnw/brand) in this copy; a worker built from it won't honour this retirement`);
  }
  const listPath = resolve(a.list ?? RETIRED_FILE);
  const existing = existsSync(listPath) ? parseRetired(readFileSync(listPath, "utf8")) : [];
  writeFileSync(listPath, addRetirement(existing, { digest, key, sig: sig.toString("base64") }));
  console.log(`Retired release ${digest} under key ${key}`);
  console.log(`${listPath} written: publish it at the bundle's root on every host`);
}

main().catch((e) => fail(`Failed: ${e?.message ?? e}`));
