"use client";

// ---------------------------------------------------------------------------
// A counter-offer on screen, the same on both sides: each field that changes,
// as "was → wants". Short fields sit on one line; long text (the terms, the
// letter's sections) opens to show both versions in full.
// ---------------------------------------------------------------------------

import type { Change } from "./thread";

const LONG = new Set<Change["field"]>(["termsText", "letter.description", "letter.requirements", "letter.handbook", "letter.other"]);

export function ChangeList({ changes, wantsLabel = "Wants" }: { changes: readonly Change[]; wantsLabel?: string }) {
  if (changes.length === 0) return <p className="text-xs text-muted-foreground">No changes to the terms.</p>;
  return (
    <ul className="flex flex-col gap-2 text-sm">
      {changes.map((c) =>
        LONG.has(c.field) ? (
          <li key={c.field}>
            <details>
              <summary className="min-h-11 cursor-pointer sm:min-h-0">
                <span className="font-medium">{c.label}</span> <span className="text-muted-foreground">changed: show both</span>
              </summary>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                <div className="rounded-md bg-muted/40 p-2">
                  <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Was</div>
                  <p className="whitespace-pre-wrap text-xs">{c.was || "(empty)"}</p>
                </div>
                <div className="rounded-md border border-primary/40 p-2">
                  <div className="text-xs font-semibold uppercase tracking-wide text-primary">{wantsLabel}</div>
                  <p className="whitespace-pre-wrap text-xs">{c.wants || "(empty)"}</p>
                </div>
              </div>
            </details>
          </li>
        ) : (
          <li key={c.field} className="flex flex-wrap items-baseline gap-x-2">
            <span className="font-medium">{c.label}:</span>
            <span className="text-muted-foreground line-through">{c.was}</span>
            <span aria-hidden>→</span>
            <span className="font-medium text-primary">{c.wants}</span>
          </li>
        ),
      )}
    </ul>
  );
}

/** A note from one side, quoted. */
export function QuotedNote({ who, text }: { who: string; text: string }) {
  if (!text.trim()) return null;
  return (
    <blockquote className="border-l-2 pl-3 text-xs">
      <span className="text-muted-foreground">{who}: </span>
      <span className="whitespace-pre-wrap">{text}</span>
    </blockquote>
  );
}
