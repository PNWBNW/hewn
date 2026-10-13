// ---------------------------------------------------------------------------
// Starter charts of accounts. A new business picks one, then edits freely.
// System accounts (receivables, payables, retained earnings, ...) are always
// created with the books, so templates only add the rest.
// ---------------------------------------------------------------------------

import type { AccountType } from "./accounts";
import { type Books, addAccount } from "./books";

type TemplateAccount = { number: string; name: string; type: AccountType; parent?: string };

export type TemplateId = "service" | "contractor" | "retail";

const COMMON: TemplateAccount[] = [
  { number: "1000", name: "Checking", type: "bank" },
  { number: "1010", name: "Savings", type: "bank" },
  { number: "1500", name: "Equipment", type: "fixed_asset" },
  { number: "1590", name: "Accumulated Depreciation", type: "fixed_asset" },
  { number: "2100", name: "Business Credit Card", type: "credit_card" },
  { number: "2700", name: "Loans Payable", type: "long_term_liability" },
  { number: "3000", name: "Owner's Investment", type: "equity" },
  { number: "3100", name: "Owner's Draw", type: "equity" },
  { number: "4900", name: "Interest Earned", type: "other_income" },
  { number: "6000", name: "Advertising & Marketing", type: "expense" },
  { number: "6050", name: "Bank & Card Fees", type: "expense" },
  { number: "6100", name: "Insurance", type: "expense" },
  { number: "6150", name: "Legal & Professional Fees", type: "expense" },
  { number: "6200", name: "Office Supplies & Software", type: "expense" },
  { number: "6250", name: "Rent", type: "expense" },
  { number: "6300", name: "Utilities & Phone", type: "expense" },
  { number: "6350", name: "Travel", type: "expense" },
  { number: "6400", name: "Meals", type: "expense" },
  { number: "6500", name: "Payroll Expenses", type: "expense" },
  { number: "6510", name: "Wages", type: "expense", parent: "Payroll Expenses" },
  { number: "6520", name: "Employer Payroll Taxes", type: "expense", parent: "Payroll Expenses" },
  { number: "6600", name: "Taxes & Licenses", type: "expense" },
  { number: "6700", name: "Depreciation", type: "expense" },
  { number: "7900", name: "Interest Paid", type: "other_expense" },
];

const BY_TEMPLATE: Record<TemplateId, TemplateAccount[]> = {
  service: [
    { number: "4000", name: "Service Income", type: "income" },
    { number: "4100", name: "Reimbursed Expenses", type: "income" },
    { number: "6450", name: "Contract Labor", type: "expense" },
    ...COMMON,
  ],
  contractor: [
    { number: "1200", name: "Retainage Receivable", type: "other_current_asset" },
    { number: "4000", name: "Construction Income", type: "income" },
    { number: "4050", name: "Change Order Income", type: "income" },
    { number: "5000", name: "Job Costs", type: "cost_of_goods_sold" },
    { number: "5010", name: "Job Materials", type: "cost_of_goods_sold", parent: "Job Costs" },
    { number: "5020", name: "Subcontractors", type: "cost_of_goods_sold", parent: "Job Costs" },
    { number: "5030", name: "Equipment Rental", type: "cost_of_goods_sold", parent: "Job Costs" },
    { number: "5040", name: "Permits & Fees", type: "cost_of_goods_sold", parent: "Job Costs" },
    { number: "1550", name: "Vehicles", type: "fixed_asset" },
    { number: "6800", name: "Fuel", type: "expense" },
    { number: "6810", name: "Vehicle Repairs", type: "expense" },
    { number: "6820", name: "Small Tools", type: "expense" },
    ...COMMON,
  ],
  retail: [
    { number: "1300", name: "Inventory", type: "other_current_asset" },
    { number: "1310", name: "Undeposited Cash", type: "other_current_asset" },
    { number: "4000", name: "Sales", type: "income" },
    { number: "4090", name: "Discounts & Returns", type: "income" },
    { number: "4100", name: "Shipping Income", type: "income" },
    { number: "5000", name: "Cost of Goods Sold", type: "cost_of_goods_sold" },
    { number: "5100", name: "Shipping & Delivery", type: "cost_of_goods_sold" },
    { number: "5200", name: "Inventory Shrinkage", type: "cost_of_goods_sold" },
    { number: "6060", name: "Merchant Processing Fees", type: "expense" },
    ...COMMON,
  ],
};

export const TEMPLATES: { id: TemplateId; label: string; description: string }[] = [
  { id: "service", label: "Services", description: "Consulting, agencies, trades billed by the hour or project." },
  { id: "contractor", label: "Contractor", description: "Construction and job-based work with materials, subs and retainage." },
  { id: "retail", label: "Retail", description: "Selling products, with inventory and cost of goods sold." },
];

export function templateAccounts(id: TemplateId): readonly TemplateAccount[] {
  return BY_TEMPLATE[id];
}

/** Adds a template's accounts to the books (parents before children). */
export function applyTemplate(books: Books, id: TemplateId): Books {
  const rows = [...BY_TEMPLATE[id]].sort((a, b) => Number(Boolean(a.parent)) - Number(Boolean(b.parent)));
  let next = books;
  for (const row of rows) {
    const parentId = row.parent ? next.accounts.find((a) => a.name === row.parent)?.id : undefined;
    next = addAccount(next, {
      name: row.name,
      number: row.number,
      type: row.type,
      ...(parentId ? { parentId } : {}),
    }).books;
  }
  return next;
}
