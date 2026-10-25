"use client";

// ---------------------------------------------------------------------------
// A business's card, drawn (docs/HEWN_ART.md): its land as a map from its
// name, the cyan contour at its years on Hewn, the live sky by the hour and
// the season. Pure drawing from @pnw/art: the SVG is text this component
// made itself, with every word escaped, so it is put straight into the page.
// Drawn once when shown; the hour and the season come from the device's
// clock at that moment.
// ---------------------------------------------------------------------------

import { useMemo } from "react";
import { ART_VERSION, businessCardSvg, hourOf, seasonOf } from "@pnw/art";
import type { Card } from "@/books/card";
import { BRAND } from "@/brand";

export type BusinessCardArtProps = {
  /** The bare registered name (the header shows it with the suffix). */
  name: string;
  /** What the business calls itself, for the title. */
  displayName: string;
  card: Card;
  /** For tests: the moment to draw at. */
  now?: Date;
  className?: string;
};

const YEAR_MS = 365.25 * 24 * 3600 * 1000;

/** Whole years since the card's issue, 0 when the date isn't known yet. */
export function yearsOn(card: Card, now: Date): number {
  if (!card.since) return 0;
  return Math.max(0, Math.floor((now.getTime() - Date.parse(card.since)) / YEAR_MS));
}

export const yearsLabel = (years: number): string => (years < 1 ? "new" : `${years} yr`);

/** The card's SVG for a business, as text. */
export function businessCardMarkup(p: Omit<BusinessCardArtProps, "className">): string {
  const now = p.now ?? new Date();
  const years = yearsOn(p.card, now);
  const since = p.card.since ? new Date(p.card.since).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : `block ${p.card.issuedAt.toLocaleString()}`;
  return businessCardSvg(
    { name: p.name, hour: hourOf(now), season: seasonOf(now), years, yearsLabel: yearsLabel(years) },
    {
      name: `${p.name}.${BRAND.nameSuffix}`,
      kind: "BUSINESS",
      title: p.displayName || `${p.name}.${BRAND.nameSuffix}`,
      line: `On ${BRAND.name} since ${since}`,
      mark: `art v${ART_VERSION}`,
      footer: BRAND.name,
    },
  );
}

export default function BusinessCardArt({ className, ...p }: BusinessCardArtProps) {
  const markup = useMemo(() => businessCardMarkup(p), [p.name, p.displayName, p.card.issuedAt, p.card.since, p.now]); // eslint-disable-line react-hooks/exhaustive-deps
  // Our own SVG text, every word escaped by the renderer: nothing from outside goes in unescaped.
  return <div className={className} dangerouslySetInnerHTML={{ __html: markup }} />;
}
