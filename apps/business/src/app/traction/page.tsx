"use client";

// Traction: where people have opened Hewn since launch, by country (Joshua,
// 2026-10-19). Public, with or without an account. Totals only: countries
// appear from five visitors, and the numbers refresh once a day
// (app/api/traction/counts.ts).

import { TractionMap } from "@/traction/TractionMap";
import { PageHeader } from "@/shell/SectionView";

export default function TractionPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Hewn around the world" summary="Where people have opened Hewn since launch, by country. Totals only: nothing about anyone, and no dates." />
      <TractionMap />
    </div>
  );
}
