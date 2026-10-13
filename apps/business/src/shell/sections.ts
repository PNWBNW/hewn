// ---------------------------------------------------------------------------
// The business app's information architecture, in one place.
//
// Every section is a list/detail workspace: a few tabs, each a list with
// known columns, and one primary action. Screens render from this config, so
// the shape of the product can be reviewed (and changed) here before any
// ledger logic exists. Wording is our own; see docs/DESIGN_BRIEF.md.
// ---------------------------------------------------------------------------

export type Column = {
  label: string;
  /** Money and counts right-align so figures line up. */
  numeric?: boolean;
};

export type SectionTab = {
  id: string;
  label: string;
  columns: Column[];
  /** Shown when the list is empty: what will appear here, in plain words. */
  empty: string;
};

export type Section = {
  id: string;
  label: string;
  /** One line under the page title: what this area is for. */
  summary: string;
  /** Build-plan phase that makes this section real. */
  phase: number;
  primaryAction: string;
  tabs: SectionTab[];
};

const money = (label: string): Column => ({ label, numeric: true });

export const SECTIONS: Section[] = [
  {
    id: "transactions",
    label: "Transactions",
    summary: "Every entry in your books, with the accounts it touched.",
    phase: 1,
    primaryAction: "New journal entry",
    tabs: [
      {
        id: "register",
        label: "All entries",
        columns: [
          { label: "Date" }, { label: "Type" }, { label: "No." }, { label: "Name" },
          { label: "Memo" }, money("Debit"), money("Credit"),
        ],
        empty: "Invoices, bills, payroll and manual entries will all land here as balanced journal entries.",
      },
      {
        id: "accounts",
        label: "Chart of accounts",
        columns: [{ label: "Account" }, { label: "Type" }, { label: "Detail" }, money("Balance")],
        empty: "Your accounts, grouped as assets, liabilities, equity, income and expenses. Pick a starter template to begin.",
      },
      {
        id: "bank",
        label: "Bank activity",
        columns: [{ label: "Date" }, { label: "Description" }, money("Amount"), { label: "Match" }],
        empty: "Import a bank statement (CSV or OFX) and each line will be matched to an entry in your books.",
      },
    ],
  },
  {
    id: "sales",
    label: "Sales",
    summary: "What customers owe you, and what they've paid.",
    phase: 3,
    primaryAction: "New invoice",
    tabs: [
      {
        id: "invoices",
        label: "Invoices",
        columns: [
          { label: "No." }, { label: "Customer" }, { label: "Date" }, { label: "Due" },
          money("Total"), money("Balance"), { label: "Status" },
        ],
        empty: "Invoices you send, from draft to paid. Partial payments keep the balance current.",
      },
      {
        id: "estimates",
        label: "Estimates",
        columns: [{ label: "No." }, { label: "Customer" }, { label: "Date" }, money("Total"), { label: "Status" }],
        empty: "Quotes for work not yet done. An accepted estimate turns into an invoice in one step.",
      },
      {
        id: "customers",
        label: "Customers",
        columns: [{ label: "Name" }, { label: "Contact" }, money("Open balance")],
        empty: "The people and businesses you sell to.",
      },
      {
        id: "payments",
        label: "Payments received",
        columns: [{ label: "Date" }, { label: "Customer" }, { label: "Reference" }, money("Amount")],
        empty: "Money in, applied to one or more invoices.",
      },
    ],
  },
  {
    id: "expenses",
    label: "Expenses",
    summary: "What you owe vendors, and what you've spent.",
    phase: 3,
    primaryAction: "New bill",
    tabs: [
      {
        id: "bills",
        label: "Bills",
        columns: [
          { label: "Vendor" }, { label: "Bill date" }, { label: "Due" },
          money("Total"), money("Balance"), { label: "Status" },
        ],
        empty: "Bills from vendors, tracked until they're paid. Attach the receipt; it's stored encrypted.",
      },
      {
        id: "spending",
        label: "Spending",
        columns: [{ label: "Date" }, { label: "Payee" }, { label: "Category" }, money("Amount")],
        empty: "Card and cash purchases recorded straight to an expense account.",
      },
      {
        id: "vendors",
        label: "Vendors",
        columns: [{ label: "Name" }, { label: "Contact" }, { label: "1099" }, money("Open balance")],
        empty: "The people and businesses you buy from.",
      },
    ],
  },
  {
    id: "payroll",
    label: "Payroll",
    summary: "Pay your team, and track what's withheld until it's sent to the IRS.",
    phase: 2,
    primaryAction: "Run payroll",
    tabs: [
      {
        id: "runs",
        label: "Pay runs",
        columns: [
          { label: "Pay date" }, { label: "Period" }, { label: "Workers", numeric: true },
          money("Gross"), money("Net"), { label: "Status" },
        ],
        empty: "Each pay run posts one balanced entry per worker: wages, withholding and net pay.",
      },
      {
        id: "team",
        label: "Team",
        columns: [{ label: "Name" }, { label: "Pay type" }, { label: "W-4" }, { label: "Status" }],
        empty: "Employees and contractors. Pay details stay private to your vault, always.",
      },
      {
        id: "liabilities",
        label: "Withholding owed",
        columns: [{ label: "Period" }, { label: "Tax" }, money("Withheld"), money("Remitted"), money("Due")],
        empty: "Taxes withheld from paychecks and not yet paid over, by period.",
      },
    ],
  },
  {
    id: "projects",
    label: "Projects",
    summary: "Income and costs for each job, so you know which ones pay.",
    phase: 3,
    primaryAction: "New project",
    tabs: [
      {
        id: "projects",
        label: "Projects",
        columns: [
          { label: "Project" }, { label: "Customer" }, money("Income"),
          money("Costs"), money("Profit"), { label: "Status" },
        ],
        empty: "Tag invoices, bills and payroll with a project and its profit adds itself up here.",
      },
      {
        id: "tags",
        label: "Classes & locations",
        columns: [{ label: "Name" }, { label: "Kind" }, { label: "Entries", numeric: true }],
        empty: "Other ways to slice your books: departments, locations, lines of business.",
      },
    ],
  },
  {
    id: "reports",
    label: "Reports",
    summary: "Statements and summaries, computed on this device from your books.",
    phase: 4,
    primaryAction: "Customize a report",
    tabs: [
      {
        id: "statements",
        label: "Financial statements",
        columns: [{ label: "Report" }, { label: "What it answers" }],
        empty: "Profit & loss, balance sheet, cash flow, trial balance and general ledger.",
      },
      {
        id: "operations",
        label: "Who owes what",
        columns: [{ label: "Report" }, { label: "What it answers" }],
        empty: "Receivables and payables aging, sales by customer, spending by vendor, project profit.",
      },
      {
        id: "budgets",
        label: "Budgets",
        columns: [{ label: "Budget" }, { label: "Period" }, money("Budgeted"), money("Actual"), money("Variance")],
        empty: "Set a budget by account and month, then see budget against actual.",
      },
    ],
  },
  {
    id: "taxes",
    label: "Taxes",
    summary: "Sales tax and payroll tax you've collected and owe. You file; we keep the numbers straight.",
    phase: 3,
    primaryAction: "Record a tax payment",
    tabs: [
      {
        id: "sales-tax",
        label: "Sales tax",
        columns: [{ label: "Period" }, { label: "Agency" }, money("Collected"), money("Paid"), money("Owed")],
        empty: "Sales tax charged on invoices, rolled up by period and agency.",
      },
      {
        id: "payroll-tax",
        label: "Payroll tax",
        columns: [{ label: "Period" }, { label: "Form" }, money("Liability"), money("Paid"), { label: "Due" }],
        empty: "Federal withholding, Social Security and Medicare by quarter, ready for your 941.",
      },
      {
        id: "1099",
        label: "1099s",
        columns: [{ label: "Vendor" }, { label: "W-9" }, money("Paid this year"), { label: "Form" }],
        empty: "Contractors you've paid enough to need a 1099-NEC, with any missing W-9s flagged.",
      },
    ],
  },
];

export function findSection(id: string): Section | undefined {
  return SECTIONS.find((s) => s.id === id);
}
