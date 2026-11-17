// Writes src-tauri/tauri.conf.json from @pnw/brand (src/tauri_config.ts), or, without --write,
// fails when the committed file differs. Plain Node runs it: the TypeScript it imports is stripped
// of types on load (Node 22.18+), as apps/business/scripts/static_csp.mjs does.
//
//   node scripts/tauri_config.mjs --write
//   node scripts/tauri_config.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tauriConfigText } from "../src/tauri_config.ts";

const FILE = join(import.meta.dirname, "..", "src-tauri", "tauri.conf.json");
const text = tauriConfigText();

if (process.argv.includes("--write")) {
  writeFileSync(FILE, text);
  console.log(`wrote ${FILE}`);
} else {
  let current = "";
  try {
    current = readFileSync(FILE, "utf8");
  } catch {
    // missing: reported below
  }
  if (current !== text) {
    console.error("src-tauri/tauri.conf.json differs from @pnw/brand: run node scripts/tauri_config.mjs --write");
    process.exit(1);
  }
  console.log("src-tauri/tauri.conf.json matches @pnw/brand");
}
