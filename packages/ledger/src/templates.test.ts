import { describe, expect, it } from "vitest";
import { createBooks } from "./books";
import { TEMPLATES, applyTemplate, templateAccounts } from "./templates";

describe("starter charts", () => {
  for (const { id } of TEMPLATES) {
    it(`${id}: applies cleanly on top of the system accounts`, () => {
      const books = applyTemplate(createBooks({ businessName: "T", fiscalYearStartMonth: 1 }), id);
      expect(books.accounts.length).toBe(7 + templateAccounts(id).length);
      const numbers = books.accounts.map((a) => a.number).filter(Boolean);
      expect(new Set(numbers).size).toBe(numbers.length);
      const byName = new Map(books.accounts.map((a) => [a.name, a]));
      for (const row of templateAccounts(id).filter((r) => r.parent)) {
        expect(byName.get(row.name)!.parentId).toBe(byName.get(row.parent!)!.id);
      }
    });
  }
});
