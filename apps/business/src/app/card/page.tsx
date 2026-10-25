"use client";

// A card, for anyone (docs/HEWN_ART.md): a business's land as a map, or a
// person's land, drawn from their registered name. Public, with or without
// an account: the card is drawn from public records only, and the code that
// reads them loads only here. The name comes from the address
// (/card?name=dayco), so a card's link can be shared.

import { Suspense } from "react";
import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { BRAND } from "@/brand";
import { PageHeader } from "@/shell/SectionView";

const loading = () => <p className="text-sm text-muted-foreground">Loading…</p>;
const PublicCard = dynamic(() => import("@/chain/PublicCard"), { ssr: false, loading });

export default function CardPage() {
  return (
    <Suspense>
      <CardQuery />
    </Suspense>
  );
}

function CardQuery() {
  const name = useSearchParams().get("name") ?? "";
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Cards"
        summary={`A card is drawn from a registered name and shows that name and its time on ${BRAND.name}, nothing else. A business's card is public; a person's shows here only while they choose to.`}
      />
      <PublicCard name={name} />
    </div>
  );
}
