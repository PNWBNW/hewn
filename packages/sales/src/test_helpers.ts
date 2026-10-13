// Shared fixtures for the sales tests (not exported from the package).
import { type Books, applyTemplate, balanceOf, createBooks, systemAccount } from "@pnw/ledger";
import { type InvoiceLine, type Sales, addCustomer, addVendor, emptySales } from "./sales";

export const clock = { now: () => "2026-10-13T12:00:00.000Z" };

/** Contractor books with a customer, a 1099 vendor and a second vendor. */
export function contractor() {
  const books: Books = applyTemplate(createBooks({ businessName: "Day Construction", fiscalYearStartMonth: 1 }), "contractor");
  const id = (name: string) => books.accounts.find((a) => a.name === name)?.id ?? "";
  let sales: Sales = emptySales();
  const acme = addCustomer(sales, { name: "Acme Co" });
  sales = acme.sales;
  const lumber = addVendor(sales, { name: "Lumber Yard", tracks1099: true });
  sales = lumber.sales;
  const power = addVendor(sales, { name: "Power Co" });
  sales = power.sales;
  const income = id("Construction Income");
  const materials = id("Job Materials");
  const bank = id("Checking");
  const stp = systemAccount(books, "sales_tax_payable").id;
  return {
    books,
    sales,
    acme: acme.customer,
    lumber: lumber.vendor,
    power: power.vendor,
    income,
    materials,
    bank,
    stp,
    id,
    /** Sales Tax Payable, credit-positive. */
    owed: (b: Books) => -balanceOf(b, stp),
  };
}

export const invLine = (accountId: string, quantity: string, unitPrice: bigint, extra: Partial<InvoiceLine> = {}): InvoiceLine => ({
  description: "Work",
  accountId,
  quantity,
  unitPrice,
  ...extra,
});
