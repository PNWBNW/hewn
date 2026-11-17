// Makes latest.json for a desktop release, on the operator's machine, after the update packages
// are signed (README.md, "Releasing"). Each package needs its signature beside it (<file>.sig, as
// `cargo tauri signer sign --app-version <version>` writes it); each is checked against
// BRAND.desktop.updateKey before it is listed, so the manifest can't name a file the app would
// refuse. Reads no secret key.
//
//   node scripts/update_manifest.mjs <version> <notes> <package>...
//
// Writes latest.json in the current folder. Upload it to the release with the packages and their
// .sig files.
import { readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import { BRAND } from "@pnw/brand";
import { updateManifest } from "../src/update_manifest.ts";

const [version, notes, ...paths] = process.argv.slice(2);
if (!version || notes === undefined || paths.length === 0) {
  throw new Error("usage: node scripts/update_manifest.mjs <version> <notes> <package>...");
}

const manifest = updateManifest({
  version,
  notes,
  date: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
  downloadBase: `${BRAND.sourceUrl}/releases/download/v${version}`,
  pubkey: BRAND.desktop.updateKey,
  files: paths.map((path) => ({ name: basename(path), data: readFileSync(path), signature: readFileSync(`${path}.sig`, "utf8") })),
});
writeFileSync("latest.json", `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`latest.json: version ${version}, ${Object.keys(manifest.platforms).length} platforms, every package signed with the update key`);
