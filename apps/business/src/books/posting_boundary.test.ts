// Screens and the chain side post through the books' own functions, never the ledger's directly:
// a journal entry through `postJournalEntry` (posting.ts), a void through `voidEntry`
// (entry_owner.ts). The ledger's `postEntry` stays as it is for the books' own modules, which need
// their source kinds.

import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(__dirname, "..");
const BARRED = ["postEntry", "reverseEntry", "editEntry"];
// `import { a, b as c } from "@pnw/ledger"` (and `export … from`), across lines.
const LEDGER_IMPORT = /\b(?:import|export)\s+(?:type\s+)?\{([^}]*)\}\s*from\s*["']@pnw\/ledger(?:\/[^"']*)?["']/g;
const NAMESPACE_IMPORT = /\bimport\s+\*\s+as\s+\w+\s+from\s*["']@pnw\/ledger(?:\/[^"']*)?["']/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

/** The ledger's posting functions a file's source imports by name. */
function barredImports(source: string): string[] {
  const found: string[] = [];
  for (const m of source.matchAll(LEDGER_IMPORT)) {
    for (const part of m[1]!.split(",")) {
      const name = part.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0]!.trim();
      if (BARRED.includes(name)) found.push(name);
    }
  }
  if (NAMESPACE_IMPORT.test(source)) found.push("* as");
  return found;
}

describe("posting boundary", () => {
  it("finds a barred import however it is written", () => {
    expect(barredImports('import { type Books, postEntry } from "@pnw/ledger";')).toEqual(["postEntry"]);
    expect(barredImports('import {\n  accountMap,\n  reverseEntry as undo,\n} from "@pnw/ledger";')).toEqual(["reverseEntry"]);
    expect(barredImports('import * as ledger from "@pnw/ledger";')).toEqual(["* as"]);
    expect(barredImports('import { postJournalEntry } from "@/books/posting";')).toEqual([]);
  });

  it("no screen or chain file imports the ledger's postEntry, reverseEntry or editEntry", () => {
    const offenders = ["app", "chain"]
      .flatMap((d) => sourceFiles(join(SRC, d)))
      .flatMap((f) => barredImports(readFileSync(f, "utf8")).map((name) => `${relative(SRC, f)}: ${name}`));
    expect(offenders).toEqual([]);
  });
});
