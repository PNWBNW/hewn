"use client";

// Pieces shared by Sales and Expenses: status badges, the aging card, money
// inputs and the "month is closed" fallback for voids.

import { type Cents, formatCents, parseCents } from "@pnw/ledger";
import { AGING_BUCKETS, type Aging, type InvoiceStatus, STATUS_LABELS } from "@pnw/sales";
import { cn } from "@pnw/ui/utils";
import { Money, todayIso } from "@/books/display";

const STATUS_TONES: Record<InvoiceStatus, string> = {
  draft: "border-dashed text-muted-foreground",
  open: "border-primary/30 bg-accent text-accent-foreground",
  partially_paid: "border-primary/30 bg-accent text-accent-foreground",
  paid: "border-success/40 bg-success/10 text-success",
  overdue: "border-warning/40 bg-warning/10 text-warning",
  void: "text-muted-foreground line-through",
};

export function StatusBadge({ status }: { status: InvoiceStatus }) {
  return (
    <span className={cn("inline-block rounded-full border px-2 py-0.5 text-xs whitespace-nowrap", STATUS_TONES[status])}>
      {STATUS_LABELS[status]}
    </span>
  );
}

/** Totals by how far past due, as of today. */
export function AgingCard({ title, aging }: { title: string; aging: Aging }) {
  return (
    <section aria-label={title} className="rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{title}</h2>
        <span className="text-xl font-semibold">
          <Money cents={aging.totals.total} />
        </span>
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-5">
        {AGING_BUCKETS.map((b) => (
          <div key={b.id}>
            <dt className="text-xs text-muted-foreground">{b.label}</dt>
            <dd className={cn("tabular-nums", b.id !== "current" && aging.totals[b.id] > 0n && "text-warning")}>
              <Money cents={aging.totals[b.id]} />
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/** Cents as a plain input value: 123450n → "1234.50". */
export const plainCents = (c: Cents) => formatCents(c).replace(/,/g, "");

/** Reads a money field. Blank counts as zero. */
export function parseMoney(text: string, label: string): Cents {
  let v: Cents;
  try {
    v = parseCents(text.trim() || "0");
  } catch {
    throw new Error(`${label}: enter an amount like 1250 or 1,250.00`);
  }
  if (v < 0n) throw new Error(`${label} can't be negative`);
  return v;
}

/** Like parseMoney, but quiet: for live totals while the user is typing. */
export function tryMoney(text: string): Cents {
  try {
    const v = parseCents(text.trim() || "0");
    return v < 0n ? 0n : v;
  } catch {
    return 0n;
  }
}

/**
 * Runs a void. If the original's month is closed, offers to date the
 * reversal today instead, the same way the journal does.
 */
export async function voidWithFallback(label: string, run: (options: { date?: string }) => Promise<unknown>): Promise<void> {
  try {
    await run({});
  } catch (e) {
    if (e instanceof Error && "code" in e && e.code === "PERIOD_CLOSED") {
      if (window.confirm(`${label} is dated in a closed month. Post the void dated today instead?`)) {
        await run({ date: todayIso() });
      }
      return;
    }
    throw e;
  }
}
