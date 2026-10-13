# @pnw/ledger

The double-entry core. Pure TypeScript, no I/O, no chain code; identical in every mode.
Anchored and settled modes add proofs on top (`gl_core.aleo`, Phase 1), enforcing the same rules.

## Rules (each has a negative test)

| Rule | Error |
|---|---|
| Debits equal credits, to the cent | `UNBALANCED` |
| At least two lines; each line is a debit or a credit, positive | `EMPTY_ENTRY`, `BAD_LINE` |
| Money is `bigint` cents; floats are refused | `BAD_AMOUNT` |
| Every line hits an existing, active account | `UNKNOWN_ACCOUNT`, `INACTIVE_ACCOUNT` |
| Receivable lines name a customer; payable lines name a vendor | `NAME_REQUIRED` |
| Nothing is dated in a closed period | `PERIOD_CLOSED` |
| Locked periods can't be posted to, reopened, or have entries reversed | `PERIOD_LOCKED` |
| An entry is reversed at most once; reversals aren't reversed | `ALREADY_REVERSED` |
| System accounts can't be retyped or deactivated | `SYSTEM_ACCOUNT` |
| Accounts with a balance can't be deactivated or moved to another statement section | `ACCOUNT_IN_USE` |

## How it differs from editing in place

The journal is append-only. **Edit** = reverse the original + post the correction (linked by
`replaces`). **Void** = reverse. Each entry stores `prevHash` and its own BLAKE3 `hash`
(domain `PNW::GL::ENTRY::v1`); `verifyChain` finds any changed, deleted or reordered entry.

## Periods

One mark, `closedThrough`, like a closing date, but enforced; and `lockedThrough`, permanent.
Reopening is an explicit, logged event. Year-end needs no closing entry: prior-year income and
expense roll into Retained Earnings when a report runs.

## API sketch

```ts
let books = applyTemplate(createBooks({ businessName: "Acme", fiscalYearStartMonth: 1 }), "service");
({ books } = postEntry(books, { date: "2026-10-01", lines: [
  { accountId: checking, debit: parseCents("1500") },
  { accountId: ownerInvestment, credit: parseCents("1500") },
]}));
trialBalance(books, "2026-10-31");   // rows + totals; totals always equal
books = closeThrough(books, "2026-09");
```

Every function takes books and returns new books; inputs are never mutated.
