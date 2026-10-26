"use client";

// ---------------------------------------------------------------------------
// How the books' Shield account compares with Shield (books/reconcile.ts), as the Dashboard's
// Shield card shows it: a quiet line when the two agree or the difference is explained, a flag when
// nothing explains it. Only the Shield account is compared; cash and other bank accounts never are.
// ---------------------------------------------------------------------------

import type { ReactNode } from "react";
import Link from "next/link";
import { CircleCheck, TriangleAlert } from "lucide-react";
import { Money } from "./display";
import type { Reconciliation } from "./reconcile";

const ReviewLink = () => (
  <Link href="/transactions?tab=review" className="underline underline-offset-2 hover:text-primary">
    For review
  </Link>
);

/** `record`: what the flag offers to record the difference with (books/RecordDifference.tsx), when the books can be changed. */
export function ShieldCheckView({ result, record }: { result: Reconciliation; record?: ReactNode }) {
  switch (result.kind) {
    case "not_started":
    case "unread":
      return null;
    case "matches":
      return (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <CircleCheck aria-hidden className="size-4 shrink-0 text-money-positive" />
          <span>
            Matches the books&apos; Shield account (<Money cents={result.books} />).
          </span>
        </p>
      );
    case "waiting":
      return (
        <p className="text-xs text-muted-foreground">
          The books&apos; Shield account shows <Money cents={result.books} />. The difference is {result.count}{" "}
          {result.count === 1 ? "transaction" : "transactions"} waiting in{" "}
          <ReviewLink />.
        </p>
      );
    case "settling":
      return (
        <p className="text-xs text-muted-foreground">
          Pay is still settling ({result.count} {result.count === 1 ? "paycheck" : "paychecks"}), so the books and Shield are compared again once it has.
        </p>
      );
    case "off":
      return (
        <div role="status" className="flex items-start gap-3 rounded-md border border-money-negative/50 bg-money-negative/5 p-3 text-sm">
          <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-money-negative" />
          <div className="flex flex-col gap-1">
            <p className="font-medium">The books don&apos;t match Shield</p>
            <p className="text-xs text-muted-foreground">
              The books&apos; Shield account shows <Money cents={result.books} />; Shield holds <Money cents={result.shield} />. Nothing waiting
              or settling explains it. Check{" "}
              <ReviewLink />{" "}
              for anything new, and any entry posted to the Shield account by hand. Cash and other bank accounts aren&apos;t part of this.
            </p>
            {record}
          </div>
        </div>
      );
  }
}
