// The release key on the operator's machine: where it may be written, how it is read, and the
// passphrase prompt. Nothing here prints or logs a private key or a passphrase.

import { spawnSync } from "node:child_process";
import { createPrivateKey, generateKeyPairSync } from "node:crypto";
import { chmodSync, existsSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";
import { ReleaseError, keyId, rawPublicKey } from "./lib.mjs";
import { ROOT } from "./git.mjs";

/** Whether `path` (absolute, real) is `dir` or inside it. */
function within(path, dir) {
  const rel = relative(dir, path);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

/**
 * Where a new private key may go: an absolute or relative path whose folder exists, outside this
 * repository and outside any other git checkout (where a commit could pick it up), not already a file.
 */
export function keyDestination(out, { root = ROOT } = {}) {
  if (!out) throw new ReleaseError("Pass --out with where to write the private key, outside this repository (an encrypted drive, say)");
  const target = resolve(out);
  const folder = dirname(target);
  if (!existsSync(folder)) throw new ReleaseError(`The folder ${folder} doesn't exist`);
  const real = resolve(realpathSync(folder), basename(target));
  if (within(real, realpathSync(root))) throw new ReleaseError("Refusing to write a private key inside this repository: pass a path outside it");
  const git = spawnSync("git", ["rev-parse", "--show-toplevel"], { cwd: realpathSync(folder), encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  if (git.status === 0 && git.stdout.trim()) throw new ReleaseError("Refusing to write a private key inside a git checkout: pass a path outside any repository");
  if (existsSync(real)) throw new ReleaseError(`${real} already exists: a key is never overwritten`);
  return real;
}

/**
 * Makes an Ed25519 key pair and writes the private key (PKCS8 PEM, encrypted when a passphrase is
 * given, file mode 0600) to `out`. Returns only the public half: its id and its base64 raw bytes.
 */
export function generateReleaseKey({ out, passphrase, root = ROOT }) {
  const path = keyDestination(out, { root });
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const pem = passphrase ? privateKey.export({ type: "pkcs8", format: "pem", cipher: "aes-256-cbc", passphrase }) : privateKey.export({ type: "pkcs8", format: "pem" });
  writeFileSync(path, pem, { mode: 0o600, flag: "wx" });
  chmodSync(path, 0o600);
  const raw = rawPublicKey(publicKey);
  return { path, id: keyId(raw), publicKey: raw.toString("base64") };
}

/** Whether a PEM private key is encrypted (needs a passphrase). */
export const encryptedPem = (pem) => /-----BEGIN ENCRYPTED /.test(pem);

/**
 * Reads a private key file for signing. Refuses one that others can read (as ssh does), and asks
 * `passphrase()` only when the file is encrypted.
 */
export async function readReleaseKey(path, passphrase) {
  let stat;
  try {
    stat = statSync(path);
  } catch {
    throw new ReleaseError(`No key file at ${path}`);
  }
  if (process.platform !== "win32" && (stat.mode & 0o077) !== 0) throw new ReleaseError(`The key file ${path} can be read by others: run chmod 600 on it first`);
  const pem = readFileSync(path, "utf8");
  try {
    const key = encryptedPem(pem) ? createPrivateKey({ key: pem, format: "pem", passphrase: await passphrase() }) : createPrivateKey({ key: pem, format: "pem" });
    if (key.asymmetricKeyType !== "ed25519") throw new ReleaseError("The key file holds a key that isn't Ed25519");
    return key;
  } catch (e) {
    if (e instanceof ReleaseError) throw e;
    throw new ReleaseError("Couldn't read the key file: a wrong passphrase, or not a release key");
  }
}

/** Asks for a passphrase on the terminal without showing it. */
export function askHidden(question) {
  return new Promise((done, fail) => {
    const input = process.stdin;
    if (!input.isTTY) return fail(new ReleaseError("The passphrase is asked on a terminal: run this in one"));
    process.stderr.write(question);
    let value = "";
    const finish = () => {
      input.setRawMode(false);
      input.pause();
      input.off("data", onData);
      process.stderr.write("\n");
    };
    const onData = (chunk) => {
      for (const ch of chunk) {
        if (ch === "\r" || ch === "\n") {
          finish();
          return done(value);
        }
        if (ch === "\u0003" || ch === "\u0004") {
          finish();
          return fail(new ReleaseError("Cancelled"));
        }
        if (ch === "\u007f" || ch === "\b") value = value.slice(0, -1);
        else value += ch;
      }
    };
    input.setRawMode(true);
    input.setEncoding("utf8");
    input.resume();
    input.on("data", onData);
  });
}
