"use client";

// Check a period proof (docs/AUDIT_DESIGN.md §4): public, with or without an account. The file is
// read on this device; the code that reads the explorer loads only here.

import dynamic from "next/dynamic";
import { BRAND } from "@/brand";
import { PageHeader } from "@/shell/SectionView";

const loading = () => <p className="text-sm text-muted-foreground">Loading…</p>;
const VerifyProof = dynamic(() => import("@/chain/VerifyProof"), { ssr: false, loading });

export default function VerifyPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Check a proof"
        summary={`A period proof from ${BRAND.name} shows a closed range of a business's books is complete and unchanged: every entry recomputes to the fingerprint the business anchored in public when it closed the range.`}
      />
      <VerifyProof />
    </div>
  );
}
