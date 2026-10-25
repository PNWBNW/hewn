"use client";

// ---------------------------------------------------------------------------
// A paystub's card, drawn (docs/HEWN_ART.md): a hewn log's cross-section, one
// ring a paycheck this year, this one cyan, the rings still to come faint, and
// the person's constellation in the corner with this paystub's star lit. The
// rings' widths come from the paystub's hash, never from the pay or the hours,
// and no amount is on the face. The card is private: it is drawn only in the
// person's own app and in the business's copy of the paystub, and both draw
// the same card because both hold the hash. Pure drawing from @pnw/art: the
// SVG is text this component made itself, every word escaped.
// ---------------------------------------------------------------------------

import { useMemo } from "react";
import { ART_VERSION, paystubCardSvg } from "@pnw/art";
import type { RingPlace } from "@/books/paystub_rings";
import { BRAND } from "@/brand";

export type PaystubCardArtProps = {
  /** The person's registered name when known (their constellation is drawn from it), else what the books call them. */
  name: string;
  /** Whether `name` is a registered name, shown with the suffix. */
  registered: boolean;
  /** The paystub document's hash, which both sides hold: lights the star, shapes the rings. */
  paystubHash: string;
  /** Who paid, as the paystub names them. */
  businessName: string;
  payDate: string;
  periodStart: string;
  periodEnd: string;
  place: RingPlace;
  /** The check line, once the app knows the paystub came sealed from that business and was paid. */
  check?: string;
  className?: string;
};

/** The card's SVG for a paystub, as text. */
export function paystubCardMarkup(p: Omit<PaystubCardArtProps, "className">): string {
  return paystubCardSvg(
    { name: p.name, recordSeed: `paystub:${p.paystubHash}`, n: p.place.n, of: p.place.of, check: p.check },
    {
      name: p.registered ? `${p.name}.${BRAND.nameSuffix}` : p.name,
      kind: "PAYSTUB",
      title: `${p.place.n} of ${p.place.of} · ${p.payDate.slice(0, 4)}`,
      line: p.businessName,
      line2: `${p.periodStart} to ${p.periodEnd} · paid ${p.payDate}`,
      mark: `art v${ART_VERSION} · ${p.paystubHash.slice(0, 8)}`,
      footer: BRAND.name,
    },
  );
}

export default function PaystubCardArt({ className, ...p }: PaystubCardArtProps) {
  const markup = useMemo(() => paystubCardMarkup(p), [p.name, p.registered, p.paystubHash, p.businessName, p.payDate, p.periodStart, p.periodEnd, p.place.n, p.place.of, p.check]); // eslint-disable-line react-hooks/exhaustive-deps
  // Our own SVG text, every word escaped by the renderer: nothing from outside goes in unescaped.
  return <div className={className} dangerouslySetInnerHTML={{ __html: markup }} />;
}
