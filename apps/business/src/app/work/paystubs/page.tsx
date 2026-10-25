"use client";

// Paystubs: every one that has arrived, newest first, each opening in plain
// words, and "Check for new paystubs", which loads the mailbox scan only
// when tapped.

import { useState } from "react";
import dynamic from "next/dynamic";
import { RefreshCw } from "lucide-react";
import { Button } from "@pnw/ui/button";
import { Card, CardContent } from "@pnw/ui/card";
import { useWork } from "@/books/BooksProvider";
import { paystubFromCanonical } from "@/books/paystub_document";
import { receivedPlace } from "@/books/paystub_rings";
import type { ReceivedPaystub } from "@/books/work";
import { PageHeader } from "@/shell/SectionView";
import { PaystubView } from "../PaystubView";
import { dollars } from "../shared";

const InboxPanel = dynamic(() => import("@/chain/work/Inbox"), {
  ssr: false,
  loading: () => <p className="text-sm text-muted-foreground">Loading…</p>,
});

function summary(p: ReceivedPaystub): { payDate: string; net: string } {
  try {
    const doc = paystubFromCanonical(p.document);
    return { payDate: doc.payDate, net: dollars(doc.net) };
  } catch {
    return { payDate: p.receivedAt.slice(0, 10), net: "—" };
  }
}

export default function PaystubsPage() {
  const { work } = useWork();
  const [checking, setChecking] = useState(false);
  const [open, setOpen] = useState<string | null>(null); // agreementId:seq
  const paystubs = [...work.paystubs].sort((a, b) => (a.receivedAt < b.receivedAt ? 1 : -1));
  const key = (p: ReceivedPaystub) => `${p.agreementId}:${p.seq}`;
  const shown = paystubs.find((p) => key(p) === open);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Paystubs"
        summary="Every paystub sent to you, kept on this device."
        action={
          !checking ? (
            <Button className="min-h-11 sm:min-h-9" onClick={() => setChecking(true)}>
              <RefreshCw aria-hidden />
              Check for new paystubs
            </Button>
          ) : undefined
        }
      />

      {checking && <InboxPanel onClose={() => setChecking(false)} />}
      {shown && <PaystubView paystub={shown} place={receivedPlace(shown, work.paystubs)} name={work.profile?.name} onClose={() => setOpen(null)} />}

      <Card>
        <CardContent className="pt-6">
          {paystubs.length === 0 ? (
            <p className="text-sm text-muted-foreground">No paystubs yet. After a payday, tap Check for new paystubs.</p>
          ) : (
            <ul className="divide-y">
              {paystubs.map((p) => {
                const s = summary(p);
                return (
                  <li key={key(p)}>
                    <button
                      type="button"
                      className="flex min-h-12 w-full items-center justify-between gap-3 py-2 text-left text-sm hover:text-primary"
                      aria-expanded={open === key(p)}
                      onClick={() => setOpen(open === key(p) ? null : key(p))}
                    >
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{p.businessName}</span>
                        <span className="block text-xs text-muted-foreground">Paid {s.payDate}</span>
                      </span>
                      <span className="font-semibold tabular-nums">{s.net}</span>
                    </button>
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
