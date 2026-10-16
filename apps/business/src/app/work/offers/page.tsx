"use client";

// Offers: every agreement in the vault, pending ones first, and "Check for
// offers", which loads the Shield-backed panel only when tapped.

import { useState } from "react";
import dynamic from "next/dynamic";
import { RefreshCw } from "lucide-react";
import { Button } from "@pnw/ui/button";
import { Card, CardContent } from "@pnw/ui/card";
import { cn } from "@pnw/ui/utils";
import { useWork } from "@/books/BooksProvider";
import { LetterSections, OfferFileList } from "@/books/OfferLetterView";
import { PageHeader } from "@/shell/SectionView";
import type { AttachmentRef } from "@pnw/sales";
import type { OfferFile } from "@/books/offer_letter";
import { RailNeeded, STATUS_LABEL, employerLabel, payLine, registeredLabel, when } from "../shared";

const OffersPanel = dynamic(() => import("@/chain/work/Offers"), {
  ssr: false,
  loading: () => <p className="text-sm text-muted-foreground">Loading…</p>,
});

const ORDER = { pending: 0, active: 1, paused: 2, terminated: 3 } as const;

export default function OffersPage() {
  const { work, rail, readAttachment } = useWork();
  const [open, setOpen] = useState(false);
  const agreements = [...work.agreements].sort((a, b) => ORDER[a.status] - ORDER[b.status]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Offers"
        summary="Offers from businesses, and the agreements you've accepted."
        action={
          !open && rail ? (
            <Button className="min-h-11 sm:min-h-9" onClick={() => setOpen(true)}>
              <RefreshCw aria-hidden />
              Check for offers
            </Button>
          ) : undefined
        }
      />

      {!rail && <RailNeeded />}
      {open && <OffersPanel onClose={() => setOpen(false)} />}

      <Card>
        <CardContent className="pt-6">
          {agreements.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing yet. When a business sends you an offer, tap Check for offers and it will appear here.</p>
          ) : (
            <ul className="divide-y">
              {agreements.map((a) => (
                <li key={a.agreementId} className="flex flex-col gap-1 py-3 text-sm">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="font-medium">{employerLabel(a)}</span>
                    <span className={cn("shrink-0 text-xs", a.status === "pending" ? "text-primary" : "text-muted-foreground")}>{STATUS_LABEL[a.status]}</span>
                  </div>
                  {a.terms?.businessName && <div className="text-xs text-muted-foreground">{registeredLabel(a)}</div>}
                  {a.terms ? (
                    <>
                      <div className="text-xs text-muted-foreground">
                        {payLine(a.terms)} · starts {a.terms.startDate}
                      </div>
                      <p className="whitespace-pre-wrap text-xs">{a.terms.termsText}</p>
                      {a.terms.version === 2 && (
                        <div className="mt-2 flex flex-col gap-3">
                          <LetterSections letter={a.terms.letter} />
                          <SavedFiles files={a.terms.files} saved={a.files} read={readAttachment} />
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="text-xs text-muted-foreground">{a.status === "pending" ? "Tap Check for offers to read the terms." : "Terms not on this device."}</div>
                  )}
                  {a.acceptedAt && <div className="text-xs text-muted-foreground">Accepted {when(a.acceptedAt)}</div>}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/** The letter's files from this vault, in the order the offer listed them. */
function SavedFiles({ files, saved, read }: { files: OfferFile[]; saved: AttachmentRef[] | undefined; read: (ref: AttachmentRef) => Promise<Blob> }) {
  const bySha = new Map((saved ?? []).map((f) => [f.sha256, f]));
  const all = files.every((f) => bySha.has(f.sha256));
  return (
    <OfferFileList
      files={files}
      {...(all ? { read: (i: number) => read(bySha.get(files[i]!.sha256)!) } : {})}
      missing="Tap Check for offers to collect the files."
    />
  );
}
