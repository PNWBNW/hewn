# PNW Ledger — Design Brief (business shell)

Phase 0, deliverable 3. Clean-room: written from what bookkeepers need to *do*, not from any
other product's screens, icons, text or layout.

## Who it's for

A small-business owner or their bookkeeper, often on a phone between jobs, sometimes at a desk
for an afternoon of reconciling. They already think in customers, vendors, invoices, bills,
payroll, and a profit-and-loss at month end. They are not crypto users and must never need to be.

## Principles

1. **A work surface, not a showcase.** Calm light canvas by default, dark mode on request or by
   OS setting. The cinematic style of the PNW landing page stays on the landing page.
2. **Brand on the frame, not the figures.** The PNW navy rail and forest/gold accents frame the
   app; tables and numbers stay neutral and high-contrast.
3. **Numbers line up.** Tabular figures everywhere (`font-feature-settings: "tnum"`); money and
   counts right-aligned; negatives in `--money-negative`, never colour alone (sign or parentheses
   as well).
4. **Plain words.** "Owed to you", "You owe", "Withholding owed". Accounting terms only where a
   bookkeeper expects them (journal entry, chart of accounts, trial balance).
5. **Private by default, and say so once.** One quiet "Private · this device" chip in the top bar
   and a line in the rail. No chain vocabulary anywhere in fiat mode (enforced by
   `apps/business/src/fiat_boundary.test.ts`); the word "blockchain" first appears on the
   anchoring opt-in review screen.
6. **Honest empty states.** Every empty list says what will appear there and how it gets filled.
   Actions that don't exist yet are shown disabled with the phase they arrive in, never faked.
7. **Phone-first touch targets.** 44px minimum on touch; nothing scrolls sideways except tables,
   which scroll inside their own frame.

## Layout

```
┌──────────┬───────────────────────────────────────────────┐
│ Rail     │ Top bar: business name · privacy chip         │
│          ├───────────────────────────────────────────────┤
│ Dashboard│ Page title                     [Primary action]│
│ Trans…   │ One-line summary                              │
│ Sales    │ [Tab] [Tab] [Tab]                             │
│ Expenses │ ┌───────────────────────────────────────────┐ │
│ Payroll  │ │ list: columns, rows, empty state          │ │
│ Projects │ └───────────────────────────────────────────┘ │
│ Reports  │                                               │
│ Taxes    │                                               │
└──────────┴───────────────────────────────────────────────┘
```

- **Desktop (≥1024px):** fixed 15rem rail, content max 72rem.
- **Phone/tablet:** rail becomes a drawer behind a menu button; primary action drops under the
  title; tabs and tables scroll horizontally inside their frame.

## Patterns

**List/detail.** Every section is a set of tabs, each a list with fixed columns
(`apps/business/src/shell/sections.ts` is the single source). Selecting a row will open its
detail on the right at desktop widths and as a full screen on phones (Phase 1+).

**Transaction forms** (Phase 1+, not built yet). One layout for invoice, bill, expense and
journal entry:

1. Header fields: who (customer/vendor), dates, number, terms.
2. Line grid: account or item, description, quantity, rate, amount, tax, project/class.
3. Footer: subtotal, tax, total; for journal entries, debit and credit totals with the
   difference shown until it is zero. Save is disabled until the entry balances.
4. Attachments (receipt image) stored encrypted in the vault.

**Dashboard.** Four key figures (cash, owed to you, you owe, profit this month) above a setup
checklist that disappears once the books have data.

## Tokens

`packages/ui/src/tokens.css`: PNW brand primitives (same hex values as the portal), semantic
light/dark tokens, rail tokens and money tokens, exposed to Tailwind via `@theme inline`. New
colours go in that file, not inline.

## Not in this brief

Worker app (`apps/worker`), mode-upgrade review screens, report layouts. Each gets its own
section here before its screens are built.
