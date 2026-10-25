"use client";

// A customer's bills: every invoice their connected businesses sent them, and
// one opened in full. They come from the vault; checking for new ones loads
// its Shield code only here. Paying from Shield comes next.

import { Suspense } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { formatCents } from "@pnw/ledger";
import { lineAmount } from "@pnw/sales";
import { Card, CardContent, CardHeader, CardTitle } from "@pnw/ui/card";
import { cn } from "@pnw/ui/utils";
import { useCustomer } from "@/books/BooksProvider";
import { type BillView, billsIn } from "@/books/bill";
import { todayIso } from "@/books/display";
import { BRAND } from "@/brand";
import { PageHeader } from "@/shell/SectionView";

const BillsCheck = dynamic(() => import("@/chain/customer/BillsCheck"), { ssr: false });

export default function BillsPage() {
  return (
    <Suspense>
      <Bills />
    </Suspense>
  );
}

const dollars = (cents: string) => `$${formatCents(BigInt(cents))}`;
const billKey = (b: BillView) => `${b.address}:${b.bill.id}`;

function Bills() {
  const { customer } = useCustomer();
  const selected = useSearchParams().get("bill");
  const bills = billsIn(customer.businesses);
  const open = bills.find((b) => billKey(b) === selected);
  const today = todayIso();

  if (open) return <BillDetail view={open} />;

  const owed = bills.filter((b) => b.status === "open").reduce((n, b) => n + BigInt(b.bill.total), 0n);
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Bills" summary={bills.length === 0 ? "Invoices from the businesses you're connected with." : `${dollars(owed.toString())} open across ${bills.filter((b) => b.status === "open").length} bills.`} />
      <BillsCheck />
      <Card>
        <CardContent className="pt-6">
          {bills.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No bills yet. A business you&apos;re{" "}
              <Link href="/customer/businesses" className="underline underline-offset-4">
                connected with
              </Link>{" "}
              sends its invoices here.
            </p>
          ) : (
            <ul className="divide-y">
              {bills.map((b) => {
                const late = b.status === "open" && b.bill.dueDate < today;
                return (
                  <li key={billKey(b)}>
                    <Link href={`/customer/bills?bill=${encodeURIComponent(billKey(b))}`} className="flex min-h-14 items-center gap-3 py-3">
                      <span className="min-w-0 flex-1">
                        <span className={cn("block truncate text-sm font-medium", b.status === "void" && "text-muted-foreground line-through")}>
                          {b.business}.{BRAND.nameSuffix} · {b.bill.number}
                        </span>
                        <span className={cn("block truncate text-xs", late ? "text-destructive" : "text-muted-foreground")}>
                          {b.status === "void" ? "Voided by the business" : late ? `Overdue since ${b.bill.dueDate}` : `Due ${b.bill.dueDate}`}
                        </span>
                      </span>
                      <span className="text-sm font-medium tabular-nums">{dollars(b.bill.total)}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function BillDetail({ view }: { view: BillView }) {
  const { bill } = view;
  return (
    <div className="flex flex-col gap-4">
      <Link href="/customer/bills" className="inline-flex min-h-11 items-center gap-1 self-start text-sm font-medium sm:min-h-9">
        <ChevronLeft aria-hidden className="size-4" /> All bills
      </Link>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Invoice {bill.number} from {view.business}.{BRAND.nameSuffix}
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Dated {bill.date} · due {bill.dueDate}
            {view.status === "void" && " · voided by the business: nothing is owed"}
          </p>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <ul className="divide-y border-y">
            {bill.lines.map((l, i) => (
              <li key={i} className="flex items-start gap-3 py-2 text-sm">
                <span className="min-w-0 flex-1">
                  <span className="block break-words">{l.description || "—"}</span>
                  <span className="block text-xs text-muted-foreground tabular-nums">
                    {l.quantity} × {dollars(l.unitPrice)}
                    {l.taxable ? " · taxed" : ""}
                  </span>
                </span>
                <span className="tabular-nums">{dollars(lineAmount({ quantity: l.quantity, unitPrice: BigInt(l.unitPrice) }).toString())}</span>
              </li>
            ))}
          </ul>
          <dl className="ml-auto grid w-full max-w-xs grid-cols-2 gap-y-1 text-sm">
            <dt className="text-muted-foreground">Subtotal</dt>
            <dd className="text-right tabular-nums">{dollars(bill.subtotal)}</dd>
            {bill.tax !== "0" && (
              <>
                <dt className="text-muted-foreground">Tax ({(bill.taxRateBp / 100).toFixed(2)}%)</dt>
                <dd className="text-right tabular-nums">{dollars(bill.tax)}</dd>
              </>
            )}
            <dt className="font-medium">Total</dt>
            <dd className="text-right font-medium tabular-nums">{dollars(bill.total)}</dd>
          </dl>
          {bill.memo && <p className="whitespace-pre-wrap text-sm text-muted-foreground">{bill.memo}</p>}
          {view.status === "open" && <p className="text-xs text-muted-foreground">Paying from Shield is coming next. Until then, pay the business the way you agreed.</p>}
          <Link href={`/customer/messages?with=${encodeURIComponent(view.address)}`} className="text-sm underline underline-offset-4">
            Message {view.business}
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
