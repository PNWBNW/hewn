"use client";

import { useState } from "react";
import { billBalance, payBills } from "@pnw/sales";
import { Button } from "@pnw/ui/button";
import { cn } from "@pnw/ui/utils";
import { Field, FormError, errorMessage, inputClass } from "@/books/AuthCard";
import { useOpenBooks } from "@/books/BooksProvider";
import { AccountSelect, Money, todayIso } from "@/books/display";
import { parseMoney, plainCents, tryMoney } from "../sales/parts";

/** Pays one or more of a vendor's open bills from a bank account. */
export function PayBillsForm({ vendorId: initialVendor = "", billId, onDone }: { vendorId?: string; billId?: string; onDone: () => void }) {
  const { books, sales, updateCompany } = useOpenBooks();
  const [vendorId, setVendorId] = useState(initialVendor);
  const [date, setDate] = useState(todayIso());
  const [bank, setBank] = useState(books.accounts.find((a) => a.type === "bank" && a.active)?.id ?? "");
  const [reference, setReference] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const openFor = (id: string) =>
    sales.bills
      .filter((b) => b.vendorId === id && billBalance(sales, b) > 0n)
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
      .map((b) => ({ bill: b, balance: billBalance(sales, b) }));
  const open = vendorId ? openFor(vendorId) : [];
  // Start with the chosen bill (or, with none chosen, every open bill) paid in full.
  const [amounts, setAmounts] = useState<Record<string, string>>(() =>
    Object.fromEntries(open.map((o) => [o.bill.id, !billId || o.bill.id === billId ? plainCents(o.balance) : ""])),
  );
  const total = open.reduce((t, o) => t + tryMoney(amounts[o.bill.id] ?? ""), 0n);
  const vendors = sales.vendors.filter((v) => v.active || v.id === vendorId);

  return (
    <form
      className="flex flex-col gap-4 rounded-lg border bg-card p-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setError(null);
        setBusy(true);
        try {
          const applications = open.map((o) => ({ billId: o.bill.id, amount: parseMoney(amounts[o.bill.id] ?? "", o.bill.number ?? o.bill.date) }));
          await updateCompany((c) => {
            const r = payBills(c.books, c.sales, {
              date,
              vendorId,
              bankAccountId: bank,
              ...(reference.trim() ? { reference } : {}),
              applications,
            });
            return { ...c, books: r.books, sales: r.sales };
          });
          onDone();
        } catch (err) {
          setError(errorMessage(err));
          setBusy(false);
        }
      }}
    >
      <h2 className="text-base font-semibold">Pay bills</h2>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Vendor">
          <select
            className={inputClass}
            value={vendorId}
            onChange={(e) => {
              setVendorId(e.target.value);
              setAmounts(Object.fromEntries(openFor(e.target.value).map((o) => [o.bill.id, plainCents(o.balance)])));
            }}
            required
          >
            <option value="">Choose a vendor</option>
            {vendors.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Paid on">
          <input type="date" className={inputClass} value={date} onChange={(e) => setDate(e.target.value)} required />
        </Field>
        <Field label="Paid from">
          <AccountSelect
            books={books}
            value={bank}
            onChange={setBank}
            filter={(a) => a.active && a.type === "bank"}
            className={inputClass}
            placeholder="Choose a bank account"
          />
        </Field>
        <Field label="Reference" hint="Optional: check number, transfer ID.">
          <input className={inputClass} value={reference} onChange={(e) => setReference(e.target.value)} />
        </Field>
      </div>

      {vendorId && (
        <div className="relative overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Bill</th>
                <th className="hidden px-3 py-2 text-left font-medium sm:table-cell">Due</th>
                <th className="px-3 py-2 text-right font-medium">Balance</th>
                <th className="px-3 py-2 text-right font-medium">Pay</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {open.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-3 py-6 text-center text-muted-foreground">
                    Nothing open for this vendor.
                  </td>
                </tr>
              )}
              {open.map((o) => (
                <tr key={o.bill.id}>
                  <td className="px-3 py-1.5 font-medium">{o.bill.number ?? `Dated ${o.bill.date}`}</td>
                  <td className="hidden px-3 py-1.5 tabular-nums sm:table-cell">{o.bill.dueDate}</td>
                  <td className="px-3 py-1.5 text-right">
                    <Money cents={o.balance} />
                  </td>
                  <td className="px-3 py-1.5 text-right">
                    <input
                      className={cn(inputClass, "ml-auto w-28 text-right sm:w-32")}
                      inputMode="decimal"
                      aria-label={`Pay ${o.bill.number ?? o.bill.date}`}
                      value={amounts[o.bill.id] ?? ""}
                      onChange={(e) => setAmounts((a) => ({ ...a, [o.bill.id]: e.target.value }))}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="text-sm">
        <span className="text-xs text-muted-foreground">Total payment </span>
        <Money cents={total} className="font-semibold" />
      </div>
      <FormError message={error} />
      <div className="flex gap-3">
        <Button type="button" variant="outline" className="h-11 flex-1 sm:flex-none" onClick={onDone} disabled={busy}>
          Cancel
        </Button>
        <Button type="submit" className="h-11 flex-1 sm:flex-none" disabled={busy || !vendorId || total <= 0n || !bank}>
          {busy ? "Saving…" : "Record payment"}
        </Button>
      </div>
    </form>
  );
}
