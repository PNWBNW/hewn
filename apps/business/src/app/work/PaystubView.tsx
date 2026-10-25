"use client";

// One paystub as it arrived, in plain words, with its card above the figures
// (docs/HEWN_ART.md: the log of rings, this paycheck's cyan). Takes the
// document, the payment line and the paystub's place in its year; it never
// knows where any of them came from.

import { X } from "lucide-react";
import { Button } from "@pnw/ui/button";
import { cn } from "@pnw/ui/utils";
import { Money, formatCredits } from "@/books/display";
import { payLines, paystubFromCanonical } from "@/books/paystub_document";
import type { RingPlace } from "@/books/paystub_rings";
import { shortAddress } from "@/books/rail";
import type { ReceivedPaystub } from "@/books/work";
import PaystubCardArt from "@/cards/PaystubCardArt";
import { FiguresNote } from "@/legal/LegalNotes";

export type PaystubViewProps = {
  paystub: ReceivedPaystub;
  /** Where this paycheck sits in its year, for the card; the card is left out without it. */
  place?: RingPlace | null;
  /** The person's registered name, for their constellation; the paystub's name otherwise. */
  name?: string;
  onClose: () => void;
};

export function PaystubView({ paystub, place, name, onClose }: PaystubViewProps) {
  let doc;
  try {
    doc = paystubFromCanonical(paystub.document);
  } catch {
    return (
      <section aria-label="Paystub" className="rounded-lg border bg-card p-4 text-sm text-muted-foreground">
        This paystub couldn&apos;t be read.
      </section>
    );
  }
  const { transactionId, feeMicrocredits } = paystub.settlement;

  return (
    <section aria-label={`Paystub from ${doc.businessName}`} className="rounded-lg border bg-card">
      <div className="flex items-start justify-between gap-3 border-b px-4 py-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">Paystub</h3>
          <p className="text-xs text-muted-foreground">
            {doc.businessName} · {doc.workerName} · paid {doc.payDate}
          </p>
        </div>
        <Button type="button" variant="ghost" size="sm" className="min-h-11 sm:min-h-8" onClick={onClose} aria-label="Close paystub">
          <X aria-hidden className="size-4" />
        </Button>
      </div>
      {place && (
        <div className="px-4 pt-3">
          <PaystubCardArt
            name={name || doc.workerName}
            registered={!!name}
            paystubHash={paystub.paystubHash}
            businessName={doc.businessName}
            payDate={doc.payDate}
            periodStart={doc.periodStart}
            periodEnd={doc.periodEnd}
            place={place}
            check={`Sealed by ${doc.businessName} · paid on the rail`}
            className="w-full max-w-[220px]"
          />
        </div>
      )}
      <dl className="grid gap-x-6 gap-y-2 px-4 py-3 text-sm sm:grid-cols-2">
        <Row label="Pay period" value={`${doc.periodStart} to ${doc.periodEnd}`} />
        {payLines(doc).map((l) => (
          <Row key={l.label} label={l.label} value={l.value} />
        ))}
        <Row label="Gross pay" cents={doc.gross} />
        <Row label="Federal income tax" cents={doc.federalIncomeTax} />
        <Row label="Social Security" cents={doc.socialSecurity} />
        <Row label="Medicare" cents={doc.medicare} />
        {doc.additionalMedicare > 0n && <Row label="Additional Medicare" cents={doc.additionalMedicare} />}
        <Row label="Net pay" cents={doc.net} strong />
        <Row label="Paid" value={`Paid on the rail · ${shortAddress(transactionId)}`} />
        {feeMicrocredits !== undefined && <Row label="Network fee" value={`${formatCredits(BigInt(feeMicrocredits))} credits, paid by employer`} muted />}
        <Row label="Employer Social Security" cents={doc.employerSocialSecurity} muted />
        <Row label="Employer Medicare" cents={doc.employerMedicare} muted />
        <Row label="Gross this year" cents={doc.ytdGross} />
        <Row label="Withheld this year" cents={doc.ytdWithheld} />
      </dl>
      <p className="border-t px-4 py-2 text-xs text-muted-foreground">
        Employer taxes are paid by {doc.businessName}, not taken from pay. Paystub reference: {paystub.paystubHash.slice(0, 8)}
      </p>
      <FiguresNote className="border-t px-4 py-2" />
    </section>
  );
}

function Row({ label, value, cents, strong, muted }: { label: string; value?: string; cents?: bigint; strong?: boolean; muted?: boolean }) {
  return (
    <div className={cn("flex items-baseline justify-between gap-4", muted && "text-muted-foreground")}>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={cn("text-right", strong && "font-semibold")}>{cents !== undefined ? <Money cents={cents} /> : value}</dd>
    </div>
  );
}
