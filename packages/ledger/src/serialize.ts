// ---------------------------------------------------------------------------
// Books ⇄ JSON text, for the vault.
//
// JSON has no bigint, so amounts are written as {"$c":"12345"} (cents) and
// read back exactly. Loading re-verifies the hash chain, so a file that was
// altered outside the app is refused even if it decrypts.
// ---------------------------------------------------------------------------

import { type Books, verifyChain } from "./books";
import { fail } from "./errors";

const FORMAT = "pnw-ledger-books";

export function booksToJson(books: Books): string {
  return JSON.stringify({ format: FORMAT, books }, (_key, value) =>
    typeof value === "bigint" ? { $c: value.toString() } : value,
  );
}

export function booksFromJson(text: string): Books {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text, (_key, value) =>
      value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === 1 &&
      typeof (value as { $c?: unknown }).$c === "string" && /^-?\d+$/.test((value as { $c: string }).$c)
        ? BigInt((value as { $c: string }).$c)
        : value,
    );
  } catch {
    fail("BAD_LINE", "Saved books are not valid JSON");
  }
  const doc = parsed as { format?: string; books?: Books };
  if (doc?.format !== FORMAT || !doc.books || doc.books.version !== 1) {
    fail("BAD_LINE", "Not a PNW Ledger books file, or a newer version than this app understands");
  }
  const check = verifyChain(doc.books);
  if (!check.ok) fail("BAD_LINE", `Saved books failed the integrity check at entry ${check.seq}: ${check.reason}`);
  return doc.books;
}
