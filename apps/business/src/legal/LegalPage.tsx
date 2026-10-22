// The frame the terms and the privacy page share: a title, the date they were last changed, and
// sections of plain paragraphs. Public: read with or without an account (shell/AppShell.tsx). The
// text lives here, not in app/, because it has to name the chain and the wallet to be honest about
// where data goes: src/legal is the one folder outside src/chain the chain-word check skips.

import { PageHeader } from "@/shell/SectionView";

export type LegalSection = { heading: string; body: React.ReactNode };

export function LegalPage({ title, summary, updated, sections }: { title: string; summary: string; updated: string; sections: LegalSection[] }) {
  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <PageHeader title={title} summary={summary} />
      {sections.map((s) => (
        <section key={s.heading} className="flex flex-col gap-2">
          <h2 className="text-base font-semibold">{s.heading}</h2>
          <div className="flex flex-col gap-2 text-sm leading-relaxed text-muted-foreground [&_strong]:text-foreground">{s.body}</div>
        </section>
      ))}
      <p className="text-xs text-muted-foreground">Last updated: {updated}</p>
    </div>
  );
}

/** When the terms and the privacy page last changed. */
export const LEGAL_UPDATED = "October 22, 2026";
