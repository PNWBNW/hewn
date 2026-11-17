// Writes SHA256SUMS-<name>.txt in a bundle folder: the SHA-256 of every installer and update
// package under it, one line each, sorted, in the format `sha256sum -c` reads. The same on every
// system the workflow builds on (.github/workflows/desktop.yml).
//
//   node scripts/sums.mjs <bundle folder> <name>
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

const INSTALLER = /\.(dmg|app\.tar\.gz|msi|exe|AppImage|deb|rpm)$/;

const [dir, name] = process.argv.slice(2);
if (!dir || !name) throw new Error("usage: node scripts/sums.mjs <bundle folder> <name>");

function files(at) {
  return readdirSync(at, { withFileTypes: true }).flatMap((entry) => {
    const path = join(at, entry.name);
    // An .app is a folder; its tar.gz beside it is what gets summed.
    if (entry.isDirectory()) return entry.name.endsWith(".app") ? [] : files(path);
    return INSTALLER.test(entry.name) ? [path] : [];
  });
}

const lines = files(dir)
  .map((path) => [relative(dir, path).split(sep).join("/"), createHash("sha256").update(readFileSync(path)).digest("hex")])
  .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  .map(([path, hash]) => `${hash}  ${path}`);
if (lines.length === 0) throw new Error(`no installers under ${dir}`);
writeFileSync(join(dir, `SHA256SUMS-${name}.txt`), `${lines.join("\n")}\n`);
console.log(lines.join("\n"));
