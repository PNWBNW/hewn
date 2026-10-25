"use client";

// A customer's home: who they are to businesses, and the backup reminder.
// Bills, payments and conversations with businesses come next
// (docs/CUSTOMERS.md, Step 1); until then this says so plainly.

import dynamic from "next/dynamic";
import { FileText } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@pnw/ui/card";
import { BackupReminder } from "@/books/BackupReminder";
import { useCustomer } from "@/books/BooksProvider";
import { BRAND } from "@/brand";
import { PageHeader } from "@/shell/SectionView";

const ChainBackup = dynamic(() => import("@/chain/ChainBackup"), { ssr: false });

export default function CustomerHome() {
  const { books, customer, rail } = useCustomer();
  const greeting = books.settings.businessName.split(" ")[0] || books.settings.businessName;
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
        <CardContent className="text-sm text-muted-foreground">
          Invoices from businesses, paying them, and your receipts are coming next. Nothing to do here yet.
        </CardContent>
      </Card>
    </div>
  );
}
