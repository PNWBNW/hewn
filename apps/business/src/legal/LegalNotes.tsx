// The small print every screen shares (Joshua, 2026-10-22): the footer line under the front page and
// the rail, and the note beside figures the software works out (payroll, taxes, paystubs).

import Link from "next/link";
import { cn } from "@pnw/ui/utils";

/** "Testnet · provided as is · Terms · Privacy", in the footer of the front page and the rail. */
export function LegalLinks({ className, linkClassName }: { className?: string; linkClassName?: string }) {
  const link = cn("underline underline-offset-4", linkClassName);
  return (
    <span className={className}>
      Testnet · provided as is ·{" "}
      <Link href="/terms" className={link}>
        Terms
      </Link>
      {" · "}
      <Link href="/privacy" className={link}>
        Privacy
      </Link>
    </span>
  );
}

export const FIGURES_NOTE = "Testnet software. Check these figures before you rely on them; this isn't tax advice.";

/** Beside figures the software works out: a payroll run, the tax pages, a paystub. */
export function FiguresNote({ className }: { className?: string }) {
  return <p className={cn("text-xs text-muted-foreground", className)}>{FIGURES_NOTE}</p>;
}
