"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { Plus } from "lucide-react";
import {
  type Estimate,
  type Invoice,
  TERMS,
  addCustomer,
  arAging,
  convertEstimateToInvoice,
  customerBalance,
  deleteDraftInvoice,
  deleteEstimate,
  estimateStatus,
  estimateTotals,
  invoiceBalance,
  invoicePaid,
  invoiceStatus,
  invoiceTotals,
  markEstimate,
  sendInvoice,
  unappliedAmount,
  updateCustomer,
  voidInvoice,
  voidPayment,
} from "@pnw/sales";
import { Button, buttonVariants } from "@pnw/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@pnw/ui/tabs";
import { cn } from "@pnw/ui/utils";
import { FormError, errorMessage } from "@/books/AuthCard";
import { useOpenBooks } from "@/books/BooksProvider";
import { Money, todayIso } from "@/books/display";
import { PageHeader } from "@/shell/SectionView";
import { LinkBadge } from "@/books/LinkBadge";
import { linkStatus } from "@/books/rail";
import { invoicesToDeliver } from "@/books/bill";
import { connectedIn } from "@/books/connections";
import { PartyForm, partyLinkView, withRegistered } from "./PartyForm";
import { ReceivePaymentForm } from "./ReceivePaymentForm";
import { AgingCard, EstimateBadge, StatusBadge, voidWithFallback } from "./parts";

// Customers on the app (connecting, sealed messages): loaded only on the Customers tab, with a linked Shield account.
const BusinessClients = dynamic(() => import("@/chain/clients/BusinessClients"), { ssr: false });
// Sent invoices a connected customer hasn't had yet: loaded only when there are some.
const DeliverInvoices = dynamic(() => import("@/chain/clients/DeliverInvoices"), { ssr: false });
// Customers' payments from Shield, to record: loaded only once a customer is connected.
const ClientPayments = dynamic(() => import("@/chain/clients/ClientPayments"), { ssr: false });

type Receiving = { customerId?: string; invoiceId?: string } | null;

const TABS = ["invoices", "estimates", "customers", "payments"];

export default function SalesPage() {
  return (
    <Suspense>
      <Sales />
    </Suspense>
  );
}

function Sales() {
  const { sales } = useOpenBooks();
  const asked = useSearchParams().get("tab");
  const [tab, setTab] = useState(asked && TABS.includes(asked) ? asked : sales.customers.length === 0 ? "customers" : "invoices");
  const [receiving, setReceiving] = useState<Receiving>(null);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Sales"
        summary="What customers owe you, and what they've paid."
        action={
          sales.customers.some((c) => c.active) ? (
            <div className="flex flex-wrap gap-2">
              <Link href="/sales/estimates/new" className={cn(buttonVariants({ variant: "outline" }), "min-h-11 sm:min-h-9")}>
                <Plus aria-hidden />
                New estimate
              </Link>
              <Link href="/sales/invoices/new" className={cn(buttonVariants(), "min-h-11 sm:min-h-9")}>
                <Plus aria-hidden />
                New invoice
              </Link>
            </div>
          ) : (
            <span className="text-xs text-muted-foreground">Add a customer to send an invoice.</span>
          )
        }
      />
      {receiving && (
        <ReceivePaymentForm
          key={`${receiving.customerId}-${receiving.invoiceId}`}
          {...receiving}
          onDone={() => setReceiving(null)}
        />
      )}
      <Tabs value={tab} onValueChange={setTab} className="flex flex-col gap-4">
        <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          <TabsList className="h-auto sm:h-9">
            <TabsTrigger value="invoices" className="min-h-11 sm:min-h-7">Invoices</TabsTrigger>
            <TabsTrigger value="estimates" className="min-h-11 sm:min-h-7">Estimates</TabsTrigger>
            <TabsTrigger value="customers" className="min-h-11 sm:min-h-7">Customers</TabsTrigger>
            <TabsTrigger value="payments" className="min-h-11 whitespace-nowrap sm:min-h-7">Payments received</TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="invoices">
          <Invoices onReceive={setReceiving} />
        </TabsContent>
        <TabsContent value="estimates">
          <Estimates onConverted={() => setTab("invoices")} />
        </TabsContent>
        <TabsContent value="customers">
          <Customers />
        </TabsContent>
        <TabsContent value="payments">
          <Payments onReceive={() => setReceiving({})} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ---- Invoices --------------------------------------------------------------

function Invoices({ onReceive }: { onReceive: (r: Receiving) => void }) {
  const { sales, clients, rail, updateCompany } = useOpenBooks();
  const toDeliver = rail ? invoicesToDeliver(sales, clients ?? undefined).length : 0;
  const anyConnected = rail ? connectedIn(clients ?? undefined).length > 0 : false;
  const [error, setError] = useState<string | null>(null);
  const today = todayIso();
  const names = new Map(sales.customers.map((c) => [c.id, c.name]));
  const invoices = [...sales.invoices].sort((a, b) => b.date.localeCompare(a.date) || b.number.localeCompare(a.number));

  async function act(run: () => Promise<unknown>) {
    setError(null);
    try {
      await run();
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  const send = (inv: Invoice) =>
    act(() =>
      updateCompany((c) => {
        const r = sendInvoice(c.books, c.sales, inv.id);
        return { ...c, books: r.books, sales: r.sales };
      }),
    );

  const remove = (inv: Invoice) =>
    act(async () => {
      if (!window.confirm(`Delete draft ${inv.number}? Drafts were never posted, so nothing changes in your books.`)) return;
      await updateCompany((c) => ({ ...c, sales: deleteDraftInvoice(c.sales, inv.id) }));
    });

  const cancel = (inv: Invoice) =>
    act(async () => {
      if (!window.confirm(`Void ${inv.number}? A reversing entry is added; the original stays in your history.`)) return;
      await voidWithFallback(inv.number, (options) =>
        updateCompany((c) => {
          const r = voidInvoice(c.books, c.sales, inv.id, options);
          return { ...c, books: r.books, sales: r.sales };
        }),
      );
    });

  return (
    <div className="flex flex-col gap-4">
      {toDeliver > 0 && <DeliverInvoices />}
      {anyConnected && <ClientPayments />}
      <AgingCard title="Owed to you, by age" aging={arAging(sales, today)} />
      <FormError message={error} />
      <div className="relative overflow-x-auto rounded-lg border bg-card">
        <table className="w-full min-w-[46rem] text-sm">
          <thead className="border-b bg-muted text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-2 text-left font-medium">No.</th>
              <th className="px-4 py-2 text-left font-medium">Customer</th>
              <th className="px-4 py-2 text-left font-medium">Date</th>
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
            {invoices.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-muted-foreground">
                  No invoices yet. A sent invoice posts to Accounts Receivable; payments bring its balance down to paid.
                </td>
              </tr>
            )}
            {invoices.map((inv) => {
              const status = invoiceStatus(sales, inv, today);
              const live = inv.state === "sent" && status !== "paid";
              return (
                <tr key={inv.id} className={cn(inv.state === "void" && "text-muted-foreground")}>
                  <td className="px-4 py-2 font-medium whitespace-nowrap">{inv.number}</td>
                  <td className="px-4 py-2">{names.get(inv.customerId) ?? inv.customerId}</td>
                  <td className="px-4 py-2 tabular-nums whitespace-nowrap">{inv.date}</td>
                  <td className="px-4 py-2 tabular-nums whitespace-nowrap">{inv.dueDate}</td>
                  <td className="px-4 py-2 text-right"><Money cents={invoiceTotals(inv).total} /></td>
                  <td className="px-4 py-2 text-right font-medium"><Money cents={invoiceBalance(sales, inv)} /></td>
                  <td className="px-4 py-2"><StatusBadge status={status} /></td>
                  <td className="px-2 py-1 text-right whitespace-nowrap">
                    {inv.state === "draft" && (
                      <>
                        <Link
                          href={`/sales/invoices/new?edit=${inv.id}`}
                          className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "min-h-11 sm:min-h-8")}
                        >
                          Edit
                        </Link>
                        <Button variant="ghost" size="sm" className="min-h-11 sm:min-h-8" onClick={() => send(inv)}>
                          Send
                        </Button>
                        <Button variant="ghost" size="sm" className="min-h-11 text-muted-foreground sm:min-h-8" onClick={() => remove(inv)}>
                          Delete
                        </Button>
                      </>
                    )}
                    {live && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="min-h-11 sm:min-h-8"
                        onClick={() => onReceive({ customerId: inv.customerId, invoiceId: inv.id })}
                      >
                        Receive payment
                      </Button>
                    )}
                    {inv.state === "sent" && invoicePaid(sales, inv.id) === 0n && (
                      <Button variant="ghost" size="sm" className="min-h-11 text-muted-foreground sm:min-h-8" onClick={() => cancel(inv)}>
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
      <p className="text-xs text-muted-foreground">
        Sales tax on sent invoices is held in Sales Tax Payable until you pay it to your state.
      </p>
    </div>
  );
}

// ---- Estimates -------------------------------------------------------------

function Estimates({ onConverted }: { onConverted: () => void }) {
  const { sales, updateCompany } = useOpenBooks();
  const [error, setError] = useState<string | null>(null);
  const today = todayIso();
  const names = new Map(sales.customers.map((c) => [c.id, c.name]));
  const invoiceNumbers = new Map(sales.invoices.map((i) => [i.id, i.number]));
  const estimates = [...sales.estimates].sort((a, b) => b.date.localeCompare(a.date) || b.number.localeCompare(a.number));

  async function act(run: () => Promise<unknown>) {
    setError(null);
    try {
      await run();
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  const mark = (est: Estimate, state: "sent" | "accepted" | "declined") =>
    act(() => updateCompany((c) => ({ ...c, sales: markEstimate(c.sales, est.id, state) })));

  const convert = (est: Estimate) =>
    act(async () => {
      await updateCompany((c) => ({ ...c, sales: convertEstimateToInvoice(c.books, c.sales, est.id, { date: todayIso() }).sales }));
      onConverted();
    });

  const remove = (est: Estimate) =>
    act(async () => {
      if (!window.confirm(`Delete ${est.number}? Estimates never post, so nothing changes in your books.`)) return;
      await updateCompany((c) => ({ ...c, sales: deleteEstimate(c.sales, est.id) }));
    });

  const action = (label: string, onClick: () => void, muted = false) => (
    <Button key={label} variant="ghost" size="sm" className={cn("min-h-11 sm:min-h-8", muted && "text-muted-foreground")} onClick={onClick}>
      {label}
    </Button>
  );

  return (
    <div className="flex flex-col gap-4">
      <FormError message={error} />
      <div className="relative overflow-x-auto rounded-lg border bg-card">
        <table className="w-full min-w-[46rem] text-sm">
          <thead className="border-b bg-muted text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-2 text-left font-medium">No.</th>
              <th className="px-4 py-2 text-left font-medium">Customer</th>
              <th className="px-4 py-2 text-left font-medium">Date</th>
              <th className="px-4 py-2 text-left font-medium">Expires</th>
              <th className="px-4 py-2 text-right font-medium">Total</th>
              <th className="px-4 py-2 text-left font-medium">Status</th>
              <th className="px-4 py-2 text-right font-medium">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {estimates.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-muted-foreground">
                  No estimates yet. Quote the work first; an accepted estimate becomes an invoice in one step. Estimates never touch your books.
                </td>
              </tr>
            )}
            {estimates.map((est) => {
              const status = estimateStatus(est, today);
              const pending = est.state === "draft" || est.state === "sent";
              return (
                <tr key={est.id} className={cn(est.state === "declined" && "text-muted-foreground")}>
                  <td className="px-4 py-2 font-medium whitespace-nowrap">{est.number}</td>
                  <td className="px-4 py-2">{names.get(est.customerId) ?? est.customerId}</td>
                  <td className="px-4 py-2 tabular-nums whitespace-nowrap">{est.date}</td>
                  <td className="px-4 py-2 tabular-nums whitespace-nowrap">{est.expiryDate}</td>
                  <td className="px-4 py-2 text-right"><Money cents={estimateTotals(est).total} /></td>
                  <td className="px-4 py-2">
                    <EstimateBadge status={status} />
                    {est.invoiceId && (
                      <span className="block text-xs text-muted-foreground">{invoiceNumbers.get(est.invoiceId) ?? "Invoice deleted"}</span>
                    )}
                  </td>
                  <td className="px-2 py-1 text-right whitespace-nowrap">
                    {pending && (
                      <Link
                        href={`/sales/estimates/new?edit=${est.id}`}
                        className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "min-h-11 sm:min-h-8")}
                      >
                        Edit
                      </Link>
                    )}
                    {est.state === "draft" && action("Mark sent", () => mark(est, "sent"))}
                    {(pending || est.state === "declined") && action("Accepted", () => mark(est, "accepted"))}
                    {(est.state === "sent" || est.state === "accepted") && action("Declined", () => mark(est, "declined"), true)}
                    {(pending || est.state === "accepted") && action("Convert to invoice", () => convert(est))}
                    {est.state !== "converted" && action("Delete", () => remove(est), true)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">
        Converting makes a draft invoice with the same lines, projects and tax rate, dated today. Send it from Invoices when you&apos;re ready.
      </p>
    </div>
  );
}

// ---- Customers -------------------------------------------------------------

function Customers() {
  const { sales, rail, updateCompany } = useOpenBooks();
  const [editing, setEditing] = useState<string | "new" | null>(sales.customers.length === 0 ? "new" : null);
  const [error, setError] = useState<string | null>(null);
  const termsLabel = (id: string) => TERMS.find((t) => t.id === id)?.label ?? id;

  return (
    <div className="flex flex-col gap-4">
      {editing !== "new" && (
        <Button variant="outline" className="min-h-11 self-start sm:min-h-9" onClick={() => setEditing("new")}>
          <Plus aria-hidden />
          Add customer
        </Button>
      )}
      {editing === "new" && (
        <PartyForm
          kind="customer"
          link={partyLinkView(rail, "customer", undefined)}
          onCancel={() => setEditing(null)}
          onSave={async (input, registered) => {
            await updateCompany((c) => {
              const added = addCustomer(c.sales, input);
              return withRegistered({ ...c, sales: added.sales }, "customer", added.customer.id, registered);
            });
            setEditing(null);
          }}
        />
      )}
      <FormError message={error} />
      {rail && <BusinessClients />}
      {sales.customers.length > 0 && (
        <ul className="divide-y overflow-hidden rounded-lg border bg-card">
          {sales.customers.map((cust) =>
            editing === cust.id ? (
              <li key={cust.id} className="p-2">
                <PartyForm
                  kind="customer"
                  initial={cust}
                  link={partyLinkView(rail, "customer", cust.id)}
                  onCancel={() => setEditing(null)}
                  onSave={async (input, registered) => {
                    await updateCompany((c) => withRegistered({ ...c, sales: updateCustomer(c.sales, cust.id, input) }, "customer", cust.id, registered));
                    setEditing(null);
                  }}
                />
              </li>
            ) : (
              <li key={cust.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className={cn("truncate text-sm font-medium", !cust.active && "text-muted-foreground line-through")}>{cust.name}</span>
                    <LinkBadge status={linkStatus(rail, "customer", cust.id)} />
                  </div>
                  <div className="truncate text-xs text-muted-foreground">
                    {[cust.email, termsLabel(cust.terms), !cust.active && "Inactive"].filter(Boolean).join(" · ")}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-xs text-muted-foreground">Open balance</div>
                  <Money cents={customerBalance(sales, cust.id)} className="text-sm" />
                </div>
                <Button variant="ghost" size="sm" className="min-h-11 sm:min-h-8" onClick={() => setEditing(cust.id)}>
                  Edit
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="min-h-11 text-muted-foreground sm:min-h-8"
                  onClick={async () => {
                    setError(null);
                    try {
                      await updateCompany((c) => ({ ...c, sales: updateCustomer(c.sales, cust.id, { active: !cust.active }) }));
                    } catch (e) {
                      setError(errorMessage(e));
                    }
                  }}
                >
                  {cust.active ? "Deactivate" : "Reactivate"}
                </Button>
              </li>
            ),
          )}
        </ul>
      )}
      <p className="text-xs text-muted-foreground">Customer names and contact details are stored only in your encrypted books on this device.</p>
    </div>
  );
}

// ---- Payments received -----------------------------------------------------

function Payments({ onReceive }: { onReceive: () => void }) {
  const { sales, updateCompany } = useOpenBooks();
  const [error, setError] = useState<string | null>(null);
  const names = new Map(sales.customers.map((c) => [c.id, c.name]));
  const numbers = new Map(sales.invoices.map((i) => [i.id, i.number]));
  const payments = [...sales.payments].sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));

  return (
    <div className="flex flex-col gap-4">
      {sales.customers.length > 0 && (
        <Button variant="outline" className="min-h-11 self-start sm:min-h-9" onClick={onReceive}>
          <Plus aria-hidden />
          Receive payment
        </Button>
      )}
      <FormError message={error} />
      <div className="relative overflow-x-auto rounded-lg border bg-card">
        <table className="w-full min-w-[40rem] text-sm">
          <thead className="border-b bg-muted text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-2 text-left font-medium">Date</th>
              <th className="px-4 py-2 text-left font-medium">Customer</th>
              <th className="px-4 py-2 text-left font-medium">Applied to</th>
              <th className="px-4 py-2 text-left font-medium">Reference</th>
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
                  No payments yet. Money in is applied to one or more invoices and deposited to a bank account.
                </td>
              </tr>
            )}
            {payments.map((p) => {
              const voided = !!p.voidEntryId;
              const credit = unappliedAmount(p);
              return (
                <tr key={p.id} className={cn(voided && "text-muted-foreground line-through")}>
                  <td className="px-4 py-2 tabular-nums whitespace-nowrap">{p.date}</td>
                  <td className="px-4 py-2">{names.get(p.customerId) ?? p.customerId}</td>
                  <td className="px-4 py-2">
                    {p.applications.map((a) => numbers.get(a.invoiceId) ?? a.invoiceId).join(", ") || "Unapplied"}
                    {!voided && credit > 0n && p.applications.length > 0 && (
                      <span className="block text-xs text-muted-foreground">
                        <Money cents={credit} /> credit
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2">{p.reference}</td>
                  <td className="px-4 py-2 text-right"><Money cents={p.amount} /></td>
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
                          if (!window.confirm("Void this payment? The invoices it paid will be owed again.")) return;
                          try {
                            await voidWithFallback("This payment", (options) =>
                              updateCompany((c) => {
                                const r = voidPayment(c.books, c.sales, p.id, options);
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
