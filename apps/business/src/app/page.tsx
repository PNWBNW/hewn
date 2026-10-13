import Link from "next/link";
import { ArrowRight, Circle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@pnw/ui/card";
import { PageHeader } from "@/shell/SectionView";

const FIGURES = [
  { label: "Cash in the bank", hint: "Across your bank and card accounts" },
  { label: "Owed to you", hint: "Open invoices" },
  { label: "You owe", hint: "Open bills and withholding" },
  { label: "Profit this month", hint: "Income minus expenses" },
];

const SETUP = [
  { step: "Name your business and pick a fiscal year", href: "/transactions", phase: 1 },
  { step: "Choose a starter chart of accounts", href: "/transactions", phase: 1 },
  { step: "Enter opening balances", href: "/transactions", phase: 1 },
  { step: "Add your team and run a first payroll", href: "/payroll", phase: 2 },
  { step: "Send your first invoice", href: "/sales", phase: 3 },
];

export default function DashboardPage() {
  return (
    <div className="flex flex-col gap-8">
      <PageHeader title="Dashboard" summary="Where your business stands today." />

      <section aria-label="Key figures" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {FIGURES.map((f) => (
          <Card key={f.label}>
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                {f.label}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-semibold" aria-label="No data yet">
                —
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{f.hint}</p>
            </CardContent>
          </Card>
        ))}
      </section>

      <section aria-labelledby="setup-heading">
        <Card>
          <CardHeader>
            <CardTitle id="setup-heading" className="text-base">
              Set up your books
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              A few steps and your figures above start filling in.
            </p>
          </CardHeader>
          <CardContent>
            <ol className="divide-y">
              {SETUP.map((s) => (
                <li key={s.step}>
                  <Link
                    href={s.href}
                    className="flex min-h-12 items-center gap-3 py-2 text-sm hover:text-primary"
                  >
                    <Circle aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                    <span className="flex-1">{s.step}</span>
                    <span className="hidden text-xs text-muted-foreground sm:inline">
                      Phase {s.phase}
                    </span>
                    <ArrowRight aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                  </Link>
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
