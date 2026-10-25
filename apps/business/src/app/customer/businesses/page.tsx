"use client";

// The businesses a customer deals with: requests to connect, finding one by
// name, and who's connected. Loads its Shield code only here.

import dynamic from "next/dynamic";
import { PageHeader } from "@/shell/SectionView";

const Businesses = dynamic(() => import("@/chain/customer/Businesses"), { ssr: false, loading: () => <p className="text-sm text-muted-foreground">Loading…</p> });

export default function BusinessesPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Businesses" summary="The businesses you hire. Connect with one to message them, get their invoices and pay them." />
      <Businesses />
    </div>
  );
}
