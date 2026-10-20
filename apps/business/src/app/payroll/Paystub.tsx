"use client";

// One paycheck's paystub, in plain words. Rebuilt from the vault (the run,
// the paycheck and the person as saved), the same document the journal
// entry committed to when the run posted. Nothing here leaves the device.

import dynamic from "next/dynamic";
import { X } from "lucide-react";
import { type Paycheck, type PayRun, paystubDocument, yearToDate } from "@pnw/payroll";
import { Button } from "@pnw/ui/button";
import { cn } from "@pnw/ui/utils";
import { useOpenBooks } from "@/books/BooksProvider";
import { Money, formatCredits } from "@/books/display";
import { payLines } from "@/books/paystub_document";
import { shortAddress } from "@/books/rail";

// Only a paystub paid on the rail is sent to the person from here; nobody else downloads that code.
const PaystubDelivery = dynamic(() => import("@/chain/PaystubDelivery"), {
  ssr: false,
  loading: () => <span>Paystub delivery…</span>,
});

function paidLine(run: PayRun, p: Paycheck): string {
  const s = p.settlement;
  if (s.status === "settled") {
    if (run.mode === "rail") return s.reference ? `On the rail · ${shortAddress(s.reference)}` : "On the rail";
    return s.reference ? `${s.reference}` : "by bank";
  }
  if (s.status === "failed") return s.failure ? `Payment failed: ${s.failure}` : "Payment failed";
  return "Not yet paid";
}

export function Paystub({ run, paycheck, onClose }: { run: PayRun; paycheck: Paycheck; onClose: () => void }) {
  const { books, payroll } = useOpenBooks();
  const worker = payroll.workers.find((w) => w.id === paycheck.workerId);
  if (!worker) {
    return (
      <section aria-label="Paystub" className="rounded-lg border bg-card p-4 text-sm text-muted-foreground">
        This person is no longer in the team list, so the paystub can&apos;t be rebuilt.
      </section>
    );
  }
  const doc = paystubDocument(run, paycheck, worker, books.settings, yearToDate(payroll, worker.id, run.payDate, run.id));
  const fee = paycheck.settlement.feeMicrocredits;

  return (
    <section aria-label={`Paystub for ${doc.workerName}`} className="rounded-lg border bg-card">
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
        <Row label="Paid" value={paidLine(run, paycheck)} />
        {fee !== undefined && <Row label="Network fee" value={`${formatCredits(fee)} credits, paid by employer`} muted />}
        <Row label="Employer Social Security" cents={doc.employerSocialSecurity} muted />
        <Row label="Employer Medicare" cents={doc.employerMedicare} muted />
        <Row label="Gross this year" cents={doc.ytdGross} />
        <Row label="Withheld this year" cents={doc.ytdWithheld} />
      </dl>
      <p className="border-t px-4 py-2 text-xs text-muted-foreground">
        Employer taxes are paid by {doc.businessName}, not taken from pay.
        {paycheck.paystubHash && <> Paystub reference: {paycheck.paystubHash.slice(0, 8)}</>}
      </p>
      {run.mode === "rail" && paycheck.settlement.status === "settled" && (
        <div className="border-t px-4 py-2 text-xs text-muted-foreground">
          <PaystubDelivery runId={run.id} paycheck={paycheck} />
        </div>
      )}
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
