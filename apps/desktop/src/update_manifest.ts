// The update manifest (latest.json) the desktop app reads from the source repository's latest
// release, made on the operator's machine from the installers and the signatures they made with
// the update key (README.md, "Releasing"). Before it names a file, it checks that file's signature
// against the update key in @pnw/brand, the way the app will: minisign over the file's BLAKE2b-512
// digest, the trusted comment covered by the global signature, and the version bound in it.
// So a manifest made here can't point the app at something it would refuse.
//
// Node only (node:crypto). Never sees a secret key.

import { createHash, createPublicKey, verify } from "node:crypto";

const b64 = (s: string) => Buffer.from(s.trim(), "base64");

/** The raw Ed25519 key and its minisign key id from the base64 form tauri.conf.json carries. */
export function parsePublicKey(pubkeyB64: string): { keyId: Buffer; key: Buffer } {
  const lines = b64(pubkeyB64).toString("utf8").trim().split("\n");
  const raw = b64(lines[lines.length - 1] ?? "");
  if (raw.length !== 42 || raw.subarray(0, 2).toString("latin1") !== "Ed") throw new Error("not a minisign public key");
  return { keyId: raw.subarray(2, 10), key: raw.subarray(10) };
}

/** The parts of a minisign signature in the base64 form `cargo tauri signer sign` writes. */
export function parseSignature(signatureB64: string): { prehashed: boolean; keyId: Buffer; sig: Buffer; trustedComment: string; globalSig: Buffer } {
  const lines = b64(signatureB64).toString("utf8").replace(/\r/g, "").split("\n");
  const raw = b64(lines[1] ?? "");
  const prefix = "trusted comment: ";
  if (raw.length !== 74 || !(lines[2] ?? "").startsWith(prefix)) throw new Error("not a minisign signature");
  const alg = raw.subarray(0, 2).toString("latin1");
  if (alg !== "ED" && alg !== "Ed") throw new Error(`unknown signature algorithm ${alg}`);
  return { prehashed: alg === "ED", keyId: raw.subarray(2, 10), sig: raw.subarray(10), trustedComment: lines[2]!.slice(prefix.length), globalSig: b64(lines[3] ?? "") };
}

function ed25519Verify(key: Buffer, message: Buffer, sig: Buffer): boolean {
  // The raw key wrapped as SubjectPublicKeyInfo, which node:crypto reads.
  const spki = Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), key]);
  return verify(null, message, createPublicKey({ key: spki, format: "der", type: "spki" }), sig);
}

/** The version a signature was bound to (`--app-version`), from its trusted comment. */
export function signedVersion(trustedComment: string): string | null {
  for (const field of trustedComment.split("\t")) if (field.startsWith("version:")) return field.slice("version:".length);
  return null;
}

/**
 * Throws unless `signatureB64` is the update key's signature over `data`, bound to `version`:
 * what the app's updater checks with `requireSignedVersion` on.
 */
export function checkSignature(data: Buffer, signatureB64: string, pubkeyB64: string, version: string): void {
  const pub = parsePublicKey(pubkeyB64);
  const s = parseSignature(signatureB64);
  if (!s.keyId.equals(pub.keyId)) throw new Error("signed with another key than the update key");
  const message = s.prehashed ? createHash("blake2b512").update(data).digest() : data;
  if (!ed25519Verify(pub.key, message, s.sig)) throw new Error("the signature does not match the file");
  if (!ed25519Verify(pub.key, Buffer.concat([s.sig, Buffer.from(s.trustedComment, "utf8")]), s.globalSig)) {
    throw new Error("the signature's trusted comment was changed");
  }
  const bound = signedVersion(s.trustedComment);
  if (bound !== version) throw new Error(`signed for version ${bound ?? "(none)"}, not ${version}: sign with --app-version ${version}`);
}

/**
 * The updater's platform keys a file serves (`{os}-{arch}-{installer}`, tauri-plugin-updater).
 * The macOS build is universal, so its one package serves both processors.
 */
export function platformsFor(fileName: string): string[] {
  if (fileName.endsWith(".app.tar.gz")) return ["darwin-aarch64-app", "darwin-x86_64-app"];
  if (fileName.endsWith(".msi")) return ["windows-x86_64-msi"];
  if (fileName.endsWith("-setup.exe")) return ["windows-x86_64-nsis"];
  if (fileName.endsWith(".AppImage")) return ["linux-x86_64-appimage"];
  if (fileName.endsWith(".deb")) return ["linux-x86_64-deb"];
  if (fileName.endsWith(".rpm")) return ["linux-x86_64-rpm"];
  return [];
}

export type UpdateFile = { name: string; data: Buffer; signature: string };

/**
 * latest.json for `version`: every file checked against the update key, then listed under the
 * platforms it serves, at its address on the release (`downloadBase`, the release's download
 * folder). Refuses a file it can't place, a file signed otherwise, and two files for one platform.
 */
export function updateManifest(input: { version: string; notes: string; date: string; downloadBase: string; pubkey: string; files: UpdateFile[] }) {
  if (!input.pubkey) throw new Error("no update key: add it to BRAND.desktop.updateKey first");
  const platforms: Record<string, { signature: string; url: string }> = {};
  for (const file of input.files) {
    const keys = platformsFor(file.name);
    if (keys.length === 0) throw new Error(`${file.name}: not an update package`);
    checkSignature(file.data, file.signature, input.pubkey, input.version);
    for (const key of keys) {
      if (platforms[key]) throw new Error(`two packages for ${key}`);
      platforms[key] = { signature: file.signature.trim(), url: `${input.downloadBase.replace(/\/$/, "")}/${encodeURIComponent(file.name)}` };
    }
  }
  return { version: input.version, notes: input.notes, pub_date: input.date, platforms };
}
