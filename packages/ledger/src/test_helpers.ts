// Shared fixtures for the ledger tests (not exported from the package).
import { type Books, addAccount, createBooks } from "./books";

let tick = 0;
export const clock = { now: () => `2026-10-13T00:00:${String(tick++ % 60).padStart(2, "0")}.000Z` };

export function sampleBooks(): { books: Books; ids: Record<string, string> } {
  let books = createBooks({ businessName: "Test Co", fiscalYearStartMonth: 1 });
  const ids: Record<string, string> = {};
  const add = (key: string, name: string, type: Parameters<typeof addAccount>[1]["type"]) => {
    const r = addAccount(books, { name, type });
    books = r.books;
    ids[key] = r.account.id;
  };
  add("checking", "Checking", "bank");
  add("sales", "Sales", "income");
  add("rent", "Rent", "expense");
  add("card", "Card", "credit_card");
  add("owner", "Owner Investment", "equity");
  for (const a of books.accounts) if (a.system) ids[a.system] = a.id;
  return { books, ids };
}
