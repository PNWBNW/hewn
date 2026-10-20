"use client";

// One paystub as it arrived, in plain words. Takes the document and the
// payment line only; it never knows where either came from.

import { X } from "lucide-react";
import { Button } from "@pnw/ui/button";
import { cn } from "@pnw/ui/utils";
import { Money, formatCredits } from "@/books/display";
import { payLines, paystubFromCanonical } from "@/books/paystub_document";
import { shortAddress } from "@/books/rail";
import type { ReceivedPaystub } from "@/books/work";

export function PaystubView({ paystub, onClose }: { paystub: ReceivedPaystub; onClose: () => void }) {
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
