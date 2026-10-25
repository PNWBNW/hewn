"use client";

// A customer's home: who they are to businesses, what's owed, and the backup
// reminder. Paying from Shield comes next (docs/CUSTOMERS.md, Step 1).

import dynamic from "next/dynamic";
import Link from "next/link";
import { FileText } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@pnw/ui/card";
import { formatCents } from "@pnw/ledger";
import { BackupReminder } from "@/books/BackupReminder";
import { billsIn } from "@/books/bill";
import { useCustomer } from "@/books/BooksProvider";
import { BRAND } from "@/brand";
import { PageHeader } from "@/shell/SectionView";

const ChainBackup = dynamic(() => import("@/chain/ChainBackup"), { ssr: false });

export default function CustomerHome() {
  const { books, customer, rail } = useCustomer();
  const greeting = books.settings.businessName.split(" ")[0] || books.settings.businessName;
  const open = billsIn(customer.businesses).filter((b) => b.status === "open");
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={`Hi, ${greeting}`} summary="The businesses you hire, their invoices, and every receipt, kept on this device." />
      <BackupReminder account={rail ? <ChainBackup /> : undefined} />
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Your name</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 text-sm">
          {customer.name ? (
            <p>
              Businesses find you as <span className="font-medium">{customer.name.name}.{BRAND.nameSuffix}</span>. Give them this name so they can
              send you invoices.
            </p>
          ) : (
            <p className="text-muted-foreground">Finish setup to register your name.</p>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <FileText aria-hidden className="size-4" />
            Bills
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 text-sm text-muted-foreground">
          {open.length > 0 ? (
            <p>
              <Link href="/customer/bills" className="font-medium text-foreground underline underline-offset-4">
                {open.length} open {open.length === 1 ? "bill" : "bills"}
              </Link>
              , ${formatCents(open.reduce((n, b) => n + BigInt(b.bill.total), 0n))} in all.
            </p>
          ) : (
            <p>
              No open bills.{" "}
              <Link href="/customer/businesses" className="text-foreground underline underline-offset-4">
                Connect with the businesses you hire
              </Link>{" "}
              and their invoices arrive under Bills.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
