import { createHash, generateKeyPairSync, randomBytes, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import { checkSignature, parsePublicKey, platformsFor, signedVersion, updateManifest } from "./update_manifest";

// A throwaway update key in minisign's format, made for the test and dropped with it, and a
// signer that writes what `cargo tauri signer sign --app-version` writes.
function throwawayKey() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const raw = publicKey.export({ format: "der", type: "spki" }).subarray(12);
  const keyId = randomBytes(8);
  const box = `untrusted comment: minisign public key: ${keyId.toString("hex").toUpperCase()}\n${Buffer.concat([Buffer.from("Ed"), keyId, raw]).toString("base64")}\n`;
  const pubkey = Buffer.from(box).toString("base64");
  const signFile = (data: Buffer, version: string | null, file = "update") => {
    const sig = sign(null, createHash("blake2b512").update(data).digest(), privateKey);
    const trusted = `timestamp:0\tfile:${file}${version === null ? "" : `\tversion:${version}`}`;
    const global = sign(null, Buffer.concat([sig, Buffer.from(trusted)]), privateKey);
    const text = `untrusted comment: signature from tauri secret key\n${Buffer.concat([Buffer.from("ED"), keyId, sig]).toString("base64")}\ntrusted comment: ${trusted}\n${global.toString("base64")}\n`;
    return Buffer.from(text).toString("base64");
  };
  return { pubkey, signFile };
}

const DATA = Buffer.from("an update package");

describe("checkSignature", () => {
  const key = throwawayKey();

  it("accepts the update key's signature bound to the version", () => {
    expect(() => checkSignature(DATA, key.signFile(DATA, "0.2.0"), key.pubkey, "0.2.0")).not.toThrow();
  });

  it("refuses another key's signature", () => {
    const other = throwawayKey();
    expect(() => checkSignature(DATA, other.signFile(DATA, "0.2.0"), key.pubkey, "0.2.0")).toThrow(/another key/);
  });

  it("refuses a file changed after signing", () => {
    expect(() => checkSignature(Buffer.from("another package"), key.signFile(DATA, "0.2.0"), key.pubkey, "0.2.0")).toThrow(/does not match/);
  });

  it("refuses a signature for another version, or none", () => {
    expect(() => checkSignature(DATA, key.signFile(DATA, "0.1.0"), key.pubkey, "0.2.0")).toThrow(/version 0.1.0/);
    expect(() => checkSignature(DATA, key.signFile(DATA, null), key.pubkey, "0.2.0")).toThrow(/\(none\)/);
  });

  it("refuses a trusted comment edited after signing", () => {
    const text = Buffer.from(key.signFile(DATA, "0.1.0"), "base64").toString("utf8").replace("version:0.1.0", "version:0.2.0");
    expect(() => checkSignature(DATA, Buffer.from(text).toString("base64"), key.pubkey, "0.2.0")).toThrow(/trusted comment/);
  });

  it("reads the key the way tauri.conf.json carries it", () => {
    expect(parsePublicKey(key.pubkey).key).toHaveLength(32);
    expect(() => parsePublicKey("")).toThrow();
    expect(signedVersion("timestamp:1\tfile:x\tversion:1.2.3")).toBe("1.2.3");
    expect(signedVersion("timestamp:1\tfile:x")).toBeNull();
  });
});

describe("updateManifest", () => {
  const key = throwawayKey();
  const file = (name: string, version = "0.2.0") => ({ name, data: DATA, signature: key.signFile(DATA, version, name) });
  const base = { version: "0.2.0", notes: "Fixes.", date: "2026-11-17T00:00:00Z", downloadBase: "https://example.org/releases/download/v0.2.0/", pubkey: key.pubkey };

  it("lists every package under the platforms it serves, at its address", () => {
    const m = updateManifest({ ...base, files: [file("App.app.tar.gz"), file("App_0.2.0_x64_en-US.msi"), file("App_0.2.0_amd64.AppImage")] });
    expect(Object.keys(m.platforms).sort()).toEqual(["darwin-aarch64-app", "darwin-x86_64-app", "linux-x86_64-appimage", "windows-x86_64-msi"]);
    expect(m.platforms["windows-x86_64-msi"]!.url).toBe("https://example.org/releases/download/v0.2.0/App_0.2.0_x64_en-US.msi");
    expect(m.version).toBe("0.2.0");
  });

  it("refuses a package signed otherwise, an unknown file, two for one platform, and no key", () => {
    expect(() => updateManifest({ ...base, files: [file("App.msi", "0.1.0")] })).toThrow();
    expect(() => updateManifest({ ...base, files: [file("notes.txt")] })).toThrow(/not an update package/);
    expect(() => updateManifest({ ...base, files: [file("a.msi"), file("b.msi")] })).toThrow(/two packages/);
    expect(() => updateManifest({ ...base, pubkey: "", files: [file("App.msi")] })).toThrow(/no update key/);
  });

  it("knows the installers' platforms", () => {
    expect(platformsFor("App_0.2.0_x64-setup.exe")).toEqual(["windows-x86_64-nsis"]);
    expect(platformsFor("App_0.2.0_amd64.deb")).toEqual(["linux-x86_64-deb"]);
    expect(platformsFor("App-0.2.0-1.x86_64.rpm")).toEqual(["linux-x86_64-rpm"]);
    expect(platformsFor("App.dmg")).toEqual([]);
  });
});
