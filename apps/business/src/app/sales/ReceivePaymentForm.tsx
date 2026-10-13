"use client";

import { useState } from "react";
import { invoiceBalance, receivePayment, suggestApplications } from "@pnw/sales";
import { Button } from "@pnw/ui/button";
import { cn } from "@pnw/ui/utils";
import { Field, FormError, errorMessage, inputClass } from "@/books/AuthCard";
import { useOpenBooks } from "@/books/BooksProvider";
import { AccountSelect, Money, todayIso } from "@/books/display";
import { parseMoney, plainCents, tryMoney } from "./parts";

/**
 * Money in from a customer, applied to one or more of their open invoices.
 * Typing the amount fills the invoices oldest-due first; each can be changed.
 */
export function ReceivePaymentForm({
  customerId: initialCustomer = "",
  invoiceId,
  onDone,
}: {
  customerId?: string;
  invoiceId?: string;
  onDone: () => void;
}) {
  const { books, sales, updateCompany } = useOpenBooks();
  const [customerId, setCustomerId] = useState(initialCustomer);
  const [date, setDate] = useState(todayIso());
  const [deposit, setDeposit] = useState(books.accounts.find((a) => a.type === "bank" && a.active)?.id ?? "");
  const [reference, setReference] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const openFor = (id: string) =>
    sales.invoices
      .filter((i) => i.customerId === id && invoiceBalance(sales, i) > 0n)
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
      .map((i) => ({ invoice: i, balance: invoiceBalance(sales, i) }));
  const open = customerId ? openFor(customerId) : [];

  // Start with the chosen invoice paid in full, or nothing applied.
  const initial = () => {
    const target = invoiceId ? open.find((o) => o.invoice.id === invoiceId) : undefined;
    return {
      amount: target ? plainCents(target.balance) : "",
      apps: Object.fromEntries(open.map((o) => [o.invoice.id, o.invoice.id === invoiceId ? plainCents(o.balance) : ""])),
    };
  };
  const [amount, setAmount] = useState(() => initial().amount);
  const [apps, setApps] = useState<Record<string, string>>(() => initial().apps);

  const fill = (text: string, rows = open) => {
    const split = suggestApplications(
      rows.map((o) => ({ id: o.invoice.id, dueDate: o.invoice.dueDate, balance: o.balance })),
      tryMoney(text),
    );
    setApps(Object.fromEntries(rows.map((o) => [o.invoice.id, split.get(o.invoice.id) ? plainCents(split.get(o.invoice.id)!) : ""])));
  };

  const received = tryMoney(amount);
  const applied = open.reduce((t, o) => t + tryMoney(apps[o.invoice.id] ?? ""), 0n);
  const active = sales.customers.filter((c) => c.active || c.id === customerId);

  return (
    <form
      className="flex flex-col gap-4 rounded-lg border bg-card p-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setError(null);
        setBusy(true);
        try {
          const cents = parseMoney(amount, "Amount received");
          const applications = open.map((o) => ({ invoiceId: o.invoice.id, amount: parseMoney(apps[o.invoice.id] ?? "", o.invoice.number) }));
          await updateCompany((c) => {
            const r = receivePayment(c.books, c.sales, {
              date,
              customerId,
              amount: cents,
              depositAccountId: deposit,
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
      <h2 className="text-base font-semibold">Receive a payment</h2>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Field label="Customer">
          <select
            className={inputClass}
            value={customerId}
            onChange={(e) => {
              setCustomerId(e.target.value);
              setAmount("");
              setApps({});
            }}
            required
          >
            <option value="">Choose a customer</option>
            {active.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Received on">
          <input type="date" className={inputClass} value={date} onChange={(e) => setDate(e.target.value)} required />
        </Field>
        <Field label="Amount received">
          <input
            className={inputClass}
            inputMode="decimal"
            value={amount}
            onChange={(e) => {
              setAmount(e.target.value);
              fill(e.target.value);
            }}
            required
          />
        </Field>
        <Field label="Deposit to">
          <AccountSelect
            books={books}
            value={deposit}
            onChange={setDeposit}
            filter={(a) => a.active && (a.type === "bank" || a.system === "payments_to_deposit")}
            className={inputClass}
            placeholder="Choose an account"
          />
        </Field>
        <Field label="Reference" hint="Optional: check number, transfer ID.">
          <input className={inputClass} value={reference} onChange={(e) => setReference(e.target.value)} />
        </Field>
      </div>

      {customerId && (
        <div className="relative overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Invoice</th>
                <th className="hidden px-3 py-2 text-left font-medium sm:table-cell">Due</th>
                <th className="px-3 py-2 text-right font-medium">Balance</th>
                <th className="px-3 py-2 text-right font-medium">Apply</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {open.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-3 py-6 text-center text-muted-foreground">
                    No open invoices for this customer. A payment recorded now is held as a credit.
                  </td>
                </tr>
              )}
              {open.map((o) => (
                <tr key={o.invoice.id}>
                  <td className="px-3 py-1.5 font-medium">{o.invoice.number}</td>
                  <td className="hidden px-3 py-1.5 tabular-nums sm:table-cell">{o.invoice.dueDate}</td>
                  <td className="px-3 py-1.5 text-right">
                    <Money cents={o.balance} />
                  </td>
                  <td className="px-3 py-1.5 text-right">
                    <input
                      className={cn(inputClass, "ml-auto w-28 text-right sm:w-32")}
                      inputMode="decimal"
                      aria-label={`Apply to ${o.invoice.number}`}
                      value={apps[o.invoice.id] ?? ""}
                      onChange={(e) => setApps((a) => ({ ...a, [o.invoice.id]: e.target.value }))}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <dl className="grid grid-cols-3 gap-3 text-sm">
        <div>
          <dt className="text-xs text-muted-foreground">Received</dt>
          <dd><Money cents={received} /></dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Applied</dt>
          <dd><Money cents={applied} /></dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">{applied > received ? "Over-applied" : "Unapplied credit"}</dt>
          <dd className={applied > received ? "text-destructive" : ""}>
            <Money cents={applied > received ? applied - received : received - applied} />
          </dd>
        </div>
      </dl>
      <FormError message={error} />
      <div className="flex gap-3">
        <Button type="button" variant="outline" className="h-11 flex-1 sm:flex-none" onClick={onDone} disabled={busy}>
          Cancel
        </Button>
        <Button type="submit" className="h-11 flex-1 sm:flex-none" disabled={busy || !customerId || received <= 0n || !deposit}>
          {busy ? "Saving…" : "Record payment"}
        </Button>
      </div>
    </form>
  );
}
