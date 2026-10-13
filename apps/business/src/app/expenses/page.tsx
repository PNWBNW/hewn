"use client";

import { useState } from "react";
import Link from "next/link";
import { Paperclip, Plus } from "lucide-react";
import {
  type Bill,
  TERMS,
  addVendor,
  apAging,
  attachToBill,
  billBalance,
  billPaid,
  billPaymentAmount,
  billStatus,
  billTotal,
  detachFromBill,
  updateVendor,
  vendorBalance,
  voidBill,
  voidBillPayment,
} from "@pnw/sales";
import { Button, buttonVariants } from "@pnw/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@pnw/ui/tabs";
import { cn } from "@pnw/ui/utils";
import { FormError, errorMessage } from "@/books/AuthCard";
import { useOpenBooks } from "@/books/BooksProvider";
import { Money, todayIso } from "@/books/display";
import { PageHeader } from "@/shell/SectionView";
import { PartyForm } from "../sales/PartyForm";
import { AgingCard, StatusBadge, voidWithFallback } from "../sales/parts";
import { PayBillsForm } from "./PayBillsForm";
import { AttachButton, ReceiptList } from "./Receipts";

type Paying = { vendorId?: string; billId?: string } | null;

export default function ExpensesPage() {
  const { sales } = useOpenBooks();
  const [tab, setTab] = useState(sales.vendors.length === 0 ? "vendors" : "bills");
  const [paying, setPaying] = useState<Paying>(null);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Expenses"
        summary="What you owe vendors, and what you've paid them."
        action={
          sales.vendors.some((v) => v.active) ? (
            <Link href="/expenses/bills/new" className={cn(buttonVariants(), "min-h-11 sm:min-h-9")}>
              <Plus aria-hidden />
              New bill
            </Link>
          ) : (
            <span className="text-xs text-muted-foreground">Add a vendor to enter a bill.</span>
          )
        }
      />
      {paying && <PayBillsForm key={`${paying.vendorId}-${paying.billId}`} {...paying} onDone={() => setPaying(null)} />}
      <Tabs value={tab} onValueChange={setTab} className="flex flex-col gap-4">
        <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          <TabsList className="h-auto sm:h-9">
            <TabsTrigger value="bills" className="min-h-11 sm:min-h-7">Bills</TabsTrigger>
            <TabsTrigger value="vendors" className="min-h-11 sm:min-h-7">Vendors</TabsTrigger>
            <TabsTrigger value="payments" className="min-h-11 whitespace-nowrap sm:min-h-7">Bill payments</TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="bills">
          <Bills onPay={setPaying} />
        </TabsContent>
        <TabsContent value="vendors">
          <Vendors />
        </TabsContent>
        <TabsContent value="payments">
          <BillPayments />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ---- Bills -----------------------------------------------------------------

function Bills({ onPay }: { onPay: (p: Paying) => void }) {
  const { sales, updateCompany, discardAttachment } = useOpenBooks();
  const [error, setError] = useState<string | null>(null);
  const [filesOf, setFilesOf] = useState<string | null>(null);
  const today = todayIso();
  const names = new Map(sales.vendors.map((v) => [v.id, v.name]));
  const bills = [...sales.bills].sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
  const anyOpen = bills.some((b) => billBalance(sales, b) > 0n);
  const open = filesOf ? sales.bills.find((b) => b.id === filesOf) : undefined;

  const cancel = async (bill: Bill) => {
    setError(null);
    if (!window.confirm("Void this bill? A reversing entry is added; the original stays in your history.")) return;
    try {
      await voidWithFallback("This bill", (options) =>
        updateCompany((c) => {
          const r = voidBill(c.books, c.sales, bill.id, options);
          return { ...c, books: r.books, sales: r.sales };
        }),
      );
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <AgingCard title="You owe vendors, by age" aging={apAging(sales, today)} />
      {anyOpen && (
        <Button variant="outline" className="min-h-11 self-start sm:min-h-9" onClick={() => onPay({})}>
          Pay bills
        </Button>
      )}
      <FormError message={error} />
      <div className="relative overflow-x-auto rounded-lg border bg-card">
        <table className="w-full min-w-[44rem] text-sm">
          <thead className="border-b bg-muted text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-2 text-left font-medium">Vendor</th>
              <th className="px-4 py-2 text-left font-medium">Bill no.</th>
              <th className="px-4 py-2 text-left font-medium">Bill date</th>
              <th className="px-4 py-2 text-left font-medium">Due</th>
              <th className="px-4 py-2 text-right font-medium">Total</th>
              <th className="px-4 py-2 text-right font-medium">Balance</th>
              <th className="px-4 py-2 text-left font-medium">Status</th>
              <th className="px-4 py-2 text-right font-medium">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {bills.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-muted-foreground">
                  No bills yet. A bill posts to Accounts Payable when you enter it, and comes off when you pay it.
                </td>
              </tr>
            )}
            {bills.map((bill) => {
              const status = billStatus(sales, bill, today);
              const balance = billBalance(sales, bill);
              const files = bill.attachments ?? [];
              return (
                <tr key={bill.id} className={cn(status === "void" && "text-muted-foreground")}>
                  <td className="px-4 py-2 font-medium">{names.get(bill.vendorId) ?? bill.vendorId}</td>
                  <td className="px-4 py-2 whitespace-nowrap">{bill.number}</td>
                  <td className="px-4 py-2 tabular-nums whitespace-nowrap">{bill.date}</td>
                  <td className="px-4 py-2 tabular-nums whitespace-nowrap">{bill.dueDate}</td>
                  <td className="px-4 py-2 text-right"><Money cents={billTotal(bill)} /></td>
                  <td className="px-4 py-2 text-right font-medium"><Money cents={balance} /></td>
                  <td className="px-4 py-2"><StatusBadge status={status} /></td>
                  <td className="px-2 py-1 text-right whitespace-nowrap">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="min-h-11 sm:min-h-8"
                      aria-expanded={filesOf === bill.id}
                      aria-label={files.length ? `Receipts (${files.length})` : "Attach a receipt"}
                      onClick={() => setFilesOf((f) => (f === bill.id ? null : bill.id))}
                    >
                      <Paperclip aria-hidden />
                      {files.length > 0 && <span className="tabular-nums">{files.length}</span>}
                    </Button>
                    {balance > 0n && (
                      <Button variant="ghost" size="sm" className="min-h-11 sm:min-h-8" onClick={() => onPay({ vendorId: bill.vendorId, billId: bill.id })}>
                        Pay
                      </Button>
                    )}
                    {status !== "void" && billPaid(sales, bill.id) === 0n && (
                      <Button variant="ghost" size="sm" className="min-h-11 text-muted-foreground sm:min-h-8" onClick={() => cancel(bill)}>
                        Void
                      </Button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {open && (
        // Outside the scrolling table, so it fits the screen on a phone.
        <section aria-label="Receipts" className="flex flex-col gap-3 rounded-lg border bg-card p-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-medium">
              Receipts: {names.get(open.vendorId) ?? open.vendorId}
              {open.number ? ` · ${open.number}` : ""}
            </h2>
            <Button variant="ghost" size="sm" className="min-h-11 sm:min-h-8" onClick={() => setFilesOf(null)}>
              Close
            </Button>
          </div>
          {(open.attachments ?? []).length === 0 && <p className="text-sm text-muted-foreground">No receipt yet.</p>}
          <ReceiptList
            refs={open.attachments ?? []}
            onRemove={async (f) => {
              setError(null);
              if (!window.confirm(`Remove ${f.name} from this bill? The file is deleted from this device.`)) return;
              try {
                await updateCompany((c) => ({ ...c, sales: detachFromBill(c.sales, open.id, f.attachmentId) }));
                await discardAttachment(f.attachmentId);
              } catch (e) {
                setError(errorMessage(e));
              }
            }}
          />
          <AttachButton
            label={(open.attachments ?? []).length ? "Attach another" : "Attach receipt"}
            onAttached={async (ref) => {
              await updateCompany((c) => ({ ...c, sales: attachToBill(c.sales, open.id, ref) }));
            }}
          />
        </section>
      )}
    </div>
  );
}

// ---- Vendors ---------------------------------------------------------------

function Vendors() {
  const { sales, updateCompany } = useOpenBooks();
  const [editing, setEditing] = useState<string | "new" | null>(sales.vendors.length === 0 ? "new" : null);
  const [error, setError] = useState<string | null>(null);
  const termsLabel = (id: string) => TERMS.find((t) => t.id === id)?.label ?? id;

  return (
    <div className="flex flex-col gap-4">
      {editing !== "new" && (
        <Button variant="outline" className="min-h-11 self-start sm:min-h-9" onClick={() => setEditing("new")}>
          <Plus aria-hidden />
          Add vendor
        </Button>
      )}
      {editing === "new" && (
        <PartyForm
          kind="vendor"
          onCancel={() => setEditing(null)}
          onSave={async (input) => {
            await updateCompany((c) => ({ ...c, sales: addVendor(c.sales, input).sales }));
            setEditing(null);
          }}
        />
      )}
      <FormError message={error} />
      {sales.vendors.length > 0 && (
        <ul className="divide-y overflow-hidden rounded-lg border bg-card">
          {sales.vendors.map((v) =>
            editing === v.id ? (
              <li key={v.id} className="p-2">
                <PartyForm
                  kind="vendor"
                  initial={v}
                  onCancel={() => setEditing(null)}
                  onSave={async (input) => {
                    await updateCompany((c) => ({ ...c, sales: updateVendor(c.sales, v.id, input) }));
                    setEditing(null);
                  }}
                />
              </li>
            ) : (
              <li key={v.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className={cn("text-sm font-medium", !v.active && "text-muted-foreground line-through")}>
                    {v.name}
                    {v.tracks1099 && <span className="ml-2 rounded-full border px-2 py-0.5 text-xs font-normal text-muted-foreground">1099</span>}
                  </div>
                  <div className="truncate text-xs text-muted-foreground">
                    {[v.email, termsLabel(v.terms), !v.active && "Inactive"].filter(Boolean).join(" · ")}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-xs text-muted-foreground">Open balance</div>
                  <Money cents={vendorBalance(sales, v.id)} className="text-sm" />
                </div>
                <Button variant="ghost" size="sm" className="min-h-11 sm:min-h-8" onClick={() => setEditing(v.id)}>
                  Edit
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="min-h-11 text-muted-foreground sm:min-h-8"
                  onClick={async () => {
                    setError(null);
                    try {
                      await updateCompany((c) => ({ ...c, sales: updateVendor(c.sales, v.id, { active: !v.active }) }));
                    } catch (e) {
                      setError(errorMessage(e));
                    }
                  }}
                >
                  {v.active ? "Deactivate" : "Reactivate"}
                </Button>
              </li>
            ),
          )}
        </ul>
      )}
      <p className="text-xs text-muted-foreground">Vendor names and contact details are stored only in your encrypted books on this device.</p>
    </div>
  );
}

// ---- Bill payments ---------------------------------------------------------

function BillPayments() {
  const { books, sales, updateCompany } = useOpenBooks();
  const [error, setError] = useState<string | null>(null);
  const names = new Map(sales.vendors.map((v) => [v.id, v.name]));
  const labels = new Map(sales.bills.map((b) => [b.id, b.number ?? `Dated ${b.date}`]));
  const banks = new Map(books.accounts.map((a) => [a.id, a.name]));
  const payments = [...sales.billPayments].sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));

  return (
    <div className="flex flex-col gap-4">
      <FormError message={error} />
      <div className="relative overflow-x-auto rounded-lg border bg-card">
        <table className="w-full min-w-[40rem] text-sm">
          <thead className="border-b bg-muted text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-2 text-left font-medium">Date</th>
              <th className="px-4 py-2 text-left font-medium">Vendor</th>
              <th className="px-4 py-2 text-left font-medium">Bills</th>
              <th className="px-4 py-2 text-left font-medium">From</th>
              <th className="px-4 py-2 text-right font-medium">Amount</th>
              <th className="px-4 py-2 text-right font-medium">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {payments.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-muted-foreground">
                  No bill payments yet. Pay one or more bills from the Bills tab.
                </td>
              </tr>
            )}
            {payments.map((p) => {
              const voided = !!p.voidEntryId;
              return (
                <tr key={p.id} className={cn(voided && "text-muted-foreground line-through")}>
                  <td className="px-4 py-2 tabular-nums whitespace-nowrap">{p.date}</td>
                  <td className="px-4 py-2">{names.get(p.vendorId) ?? p.vendorId}</td>
                  <td className="px-4 py-2">{p.applications.map((a) => labels.get(a.billId) ?? a.billId).join(", ")}</td>
                  <td className="px-4 py-2">
                    {banks.get(p.bankAccountId)}
                    {p.reference && <span className="block text-xs text-muted-foreground">{p.reference}</span>}
                  </td>
                  <td className="px-4 py-2 text-right"><Money cents={billPaymentAmount(p)} /></td>
                  <td className="px-2 py-1 text-right">
                    {voided ? (
                      <span className="px-2 text-xs">Void</span>
                    ) : (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="min-h-11 text-muted-foreground sm:min-h-8"
                        onClick={async () => {
                          setError(null);
                          if (!window.confirm("Void this bill payment? The bills it paid will be owed again.")) return;
                          try {
                            await voidWithFallback("This payment", (options) =>
                              updateCompany((c) => {
                                const r = voidBillPayment(c.books, c.sales, p.id, options);
                                return { ...c, books: r.books, sales: r.sales };
                              }),
                            );
                          } catch (e) {
                            setError(errorMessage(e));
                          }
                        }}
                      >
                        Void
                      </Button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
