"use client";

// ---------------------------------------------------------------------------
// Recording a difference nothing explains, from the Dashboard's "The books don't
// match Shield" flag (books/reconcile.ts `recordShieldDifference`): money in
// nothing listed explains (a private payment Shield won't open for the books,
// say) or money out. The business says what it was; the entry posts the Shield
// account against that account, dated today.
// ---------------------------------------------------------------------------

import { useState } from "react";
import { type Account, type Cents, baseOf, formatCents } from "@pnw/ledger";
import { RAIL_ACCOUNT_NAME } from "@pnw/payroll";
import { Button } from "@pnw/ui/button";
import { FormError, errorMessage, inputClass } from "./AuthCard";
import { useOpenBooks } from "./BooksProvider";
import { AccountSelect, todayIso } from "./display";
import { isShieldFamily } from "./funds";
import { recordShieldDifference } from "./reconcile";

export function RecordDifference({ cents }: { cents: Cents }) {
  const { books, sales, updateCompany } = useOpenBooks();
  const inbound = cents > 0n;
  const fits = (a: Account) => a.active && !isShieldFamily({ books }, a.id);
  const first = books.accounts.find((a) => fits(a) && baseOf(a) === (inbound ? "income" : "expense"))?.id ?? "";
  const [open, setOpen] = useState(false);
  const [accountId, setAccountId] = useState(first);
  const [partyId, setPartyId] = useState("");
  const [memo, setMemo] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const parties = (inbound ? sales.customers : sales.vendors).filter((p) => p.active);
  const amount = formatCents(inbound ? cents : -cents);

  async function record() {
    setBusy(true);
    setError(null);
    try {
      await updateCompany((c) =>
        recordShieldDifference(c, {
          cents,
          accountId,
          date: todayIso(),
          ...(memo.trim() ? { memo: memo.trim() } : {}),
          ...(partyId ? { name: { kind: inbound ? "customer" : "vendor", id: partyId } } : {}),
        }),
      );
      setOpen(false);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <Button variant="outline" size="sm" className="min-h-11 self-start sm:min-h-8" onClick={() => setOpen(true)}>
        Record the {amount} difference
      </Button>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-muted-foreground">
        {inbound ? `${amount} came into Shield` : `${amount} left Shield`} without anything in the books for it. Say what it was; it posts to the {RAIL_ACCOUNT_NAME}{" "}
        and the account you choose, dated today. If the transaction behind it shows up in For review later, exclude it there so it isn&apos;t counted
        twice.
      </p>
      <AccountSelect books={books} value={accountId} onChange={setAccountId} filter={fits} className={inputClass} ariaLabel="Account" placeholder={inbound ? "Income account" : "Expense account"} />
      {parties.length > 0 && (
        <select aria-label={inbound ? "Customer" : "Vendor"} className={inputClass} value={partyId} onChange={(e) => setPartyId(e.target.value)}>
          <option value="">{inbound ? "Customer (optional)" : "Vendor (optional)"}</option>
          {parties.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      )}
      <input aria-label="Memo" className={inputClass} placeholder={inbound ? "Memo, like who paid and for what (optional)" : "Memo (optional)"} value={memo} maxLength={200} onChange={(e) => setMemo(e.target.value)} />
      <FormError message={error} />
      <div className="flex flex-wrap gap-3">
        <Button className="min-h-11 sm:min-h-9" disabled={busy || !accountId} onClick={() => void record()}>
          {busy ? "Recording…" : `Record ${amount}`}
        </Button>
        <Button variant="outline" className="min-h-11 sm:min-h-9" disabled={busy} onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
