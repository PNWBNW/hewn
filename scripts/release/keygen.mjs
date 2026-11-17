// Makes a release key pair, once, on the operator's own machine (README.md beside this file).
//
//   node scripts/release/keygen.mjs --out /Volumes/ReleaseKey/hewn-release.pem [--no-passphrase]
//
// The private key goes only to --out: outside this repository and any other git checkout, never
// over an existing file, file mode 0600, encrypted with a passphrase asked on the terminal unless
// --no-passphrase. Only the public key and its id are printed, as the line to add to
// `releaseKeys` in packages/brand/src/index.ts. The private key is never printed or logged.

import { pathToFileURL } from "node:url";
import { ReleaseError, parseArgs, run } from "./lib.mjs";
import { askHidden, generateReleaseKey, keyDestination } from "./keys.mjs";

async function main() {
  const args = parseArgs(process.argv.slice(2), { values: ["out"], flags: ["no-passphrase"] });
  if (args._.length > 0 || !args.out) throw new ReleaseError("Usage: keygen.mjs --out <path outside this repository> [--no-passphrase]");
  const out = args.out.at(-1);
  keyDestination(out); // refuse a bad path before asking anything
  let passphrase;
  if (!args["no-passphrase"]) {
    passphrase = await askHidden("Passphrase for the new key (long; it is never shown): ");
    if (passphrase.length < 12) throw new ReleaseError("A passphrase of at least 12 characters, please (or --no-passphrase for a key on an encrypted drive)");
    if ((await askHidden("The same passphrase again: ")) !== passphrase) throw new ReleaseError("The two passphrases differ; nothing was written");
  }
  const key = generateReleaseKey({ out, passphrase });
  console.log(`Private key written to ${key.path} (mode 0600${passphrase ? ", encrypted" : ""}). Keep it offline; it is never needed anywhere else.`);
  console.log(`Key id      ${key.id}`);
  console.log(`Public key  ${key.publicKey}`);
  console.log("Add this line to releaseKeys in packages/brand/src/index.ts, in a pull request:");
  console.log(`  { id: "${key.id}", publicKey: "${key.publicKey}" },`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) run(main);
