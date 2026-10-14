import type { ReactNode } from "react";
import { BadgeDollarSign, BookOpen, HandCoins, Lock } from "lucide-react";
import { BRAND } from "@pnw/brand";
import { BrandHero, BrandLogo } from "@/components/Brand";
import { buttonClass } from "@/components/Chrome";

/* eslint-disable @next/next/no-img-element -- static brand art, served from /public */
const TILES = [
  ["books", "Books"],
  ["payroll", "Payroll"],
  ["invoices", "Invoices"],
  ["reports", "Reports"],
] as const;

function ProductTiles() {
  return (
    <ul className="mt-4 grid grid-cols-4 gap-3">
      {TILES.map(([id, label]) => (
        <li key={id} className="flex flex-col items-center gap-1.5 text-xs font-medium text-foreground">
          <img src={BRAND.assets.tiles[id]} width={56} height={56} alt="" className="size-14" />
          {label}
        </li>
      ))}
    </ul>
  );
}

function Section({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border bg-card p-6">
      <div className="flex items-center gap-3">
        <span aria-hidden className="inline-flex size-9 shrink-0 items-center justify-center rounded-md bg-accent text-accent-foreground">
          {icon}
        </span>
        <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
      </div>
      <div className="mt-3 space-y-2 text-sm leading-6 text-muted-foreground">{children}</div>
    </section>
  );
}

export default function Home() {
  return (
    <>
      {/* The whole hero, never cropped: the tagline is part of the art. On wide screens it's
          capped and fades into the ink band at the sides. */}
      <div className="bg-[var(--hewn-ink)]">
        <BrandHero className="mx-auto max-w-[1100px] lg:[mask-image:linear-gradient(to_right,transparent,black_8%,black_92%,transparent)]" />
      </div>

      <div className="mx-auto w-full max-w-5xl px-4">
        <section className="py-10 sm:py-14">
          <h1 className="flex flex-col gap-3">
            <BrandLogo height={44} />
            <span className="text-2xl font-semibold tracking-tight sm:text-3xl">{BRAND.tagline}</span>
          </h1>
          <p className="mt-5 max-w-2xl text-base leading-7 text-muted-foreground sm:text-lg">
            {BRAND.name} is bookkeeping and payroll for a small business, and it runs entirely in your
            browser. Your books are encrypted on your own computer or phone; there is no account to
            create, nothing is uploaded, and nobody but you can read them.
          </p>
          <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:items-center">
            <a href={BRAND.appUrl} className={buttonClass}>
              Open the app
            </a>
            <span className="text-sm text-muted-foreground">Free. No sign-up. Works offline.</span>
          </div>
        </section>

        <div className="grid gap-4 pb-14 sm:grid-cols-2">
          <Section icon={<Lock className="size-5" />} title="Your books stay on your device">
            <p>
              Everything you enter is kept in an encrypted vault in your browser, locked with a
              passphrase only you know. There is no server holding a copy, so there is nothing to
              breach and nothing to subpoena from us.
            </p>
            <p>
              Backups are files you download and keep: still encrypted, still yours, restorable on any
              device with your passphrase.
            </p>
          </Section>

          <Section icon={<BookOpen className="size-5" />} title="Everything a small business needs">
            <p>
              Double-entry books with a chart of accounts and a journal. Invoices and estimates for
              customers, bills for vendors, projects to see what each job earns.
            </p>
            <p>
              Payroll with federal withholding and paystubs for your team. Profit and loss, balance
              sheet and trial balance, downloadable as spreadsheets for your accountant.
            </p>
            <ProductTiles />
          </Section>

          <Section icon={<HandCoins className="size-5" />} title="Pay your team directly, if you want to">
            <p>
              The books work with your bank as usual: you pay people however you pay them today and
              record it. Optionally, you can also send pay as private payments straight from the
              app, so the amount and who received it stay between you and them.
            </p>
            <p>This is a choice you make later, per business. Nothing depends on it.</p>
          </Section>

          <Section icon={<BadgeDollarSign className="size-5" />} title="Free">
            <p>
              No subscription, no per-employee fee, no tiers. The app is free to use for as many
              businesses, people and years as you like.
            </p>
            <p>
              If you choose private payments, the payment network charges a small fee per payment,
              which the employer pays. That is the only cost, and it never goes to us.
            </p>
          </Section>
        </div>
      </div>
    </>
  );
}
