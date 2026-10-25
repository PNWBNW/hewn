"use client";

// ---------------------------------------------------------------------------
// A worker's card, drawn (docs/HEWN_ART.md): their land from their name,
// the cyan pine grown with their years on Hewn, their constellation in the
// sky, the live sky by the hour and the season. The land is a 3D scene
// (three.js) rendered once in the browser; the renderer loads only when a
// card is shown, so nobody else downloads it. Two views of the same card:
// the private one in the worker's own app, with their credentials as
// landmarks on the land (books/credential.ts `landmarksOf`), and the public
// one on the card page, the bare land. Nothing here is logged.
// ---------------------------------------------------------------------------

import { useEffect, useState } from "react";
import { ART_VERSION, type Landmark, hourOf, seasonOf, workerCardSvg } from "@pnw/art";
import type { Card } from "@/books/card";
import { BRAND } from "@/brand";
import { yearsLabel, yearsOn } from "./BusinessCardArt";

export type WorkerCardArtProps = {
  /** The bare registered name. */
  name: string;
  card: Card;
  /** Where it is drawn: the worker's own app (default), or the page anyone can open. */
  view?: CardView;
  /** The landmarks of their credentials, private view only; none on the public card. */
  landmarks?: Landmark[];
  className?: string;
};

export type CardView = "private" | "public";

type State = { kind: "drawing" } | { kind: "drawn"; markup: string } | { kind: "failed"; message: string };

/** The card's words, apart from the land. */
export function workerCardText(name: string, card: Card, now: Date, view: CardView = "private") {
  const years = yearsOn(card, now);
  const since = card.since ? new Date(card.since).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : `block ${card.issuedAt.toLocaleString()}`;
  return {
    years,
    text: {
      name: `${name}.${BRAND.nameSuffix}`,
      kind: years < 1 ? "NEW" : `YEAR ${years}`,
      title: `${name}.${BRAND.nameSuffix} · ${years < 1 ? "new on" : `${years} ${years === 1 ? "year" : "years"} on`} ${BRAND.name}`,
      line: `On ${BRAND.name} since ${since}`,
      mark: `art v${ART_VERSION} · ${yearsLabel(years)}`,
      footer: view === "public" ? BRAND.name : `${BRAND.name} · private view`,
    },
  };
}

export default function WorkerCardArt({ name, card, view = "private", landmarks, className }: WorkerCardArtProps) {
  const [state, setState] = useState<State>({ kind: "drawing" });
  const placed = view === "public" ? [] : (landmarks ?? []);
  const placedKey = placed.map((l) => `${l.type}:${l.seed}:${l.status}`).join("|");
  useEffect(() => {
    let gone = false;
    (async () => {
      try {
        const now = new Date();
        const { years, text } = workerCardText(name, card, now, view);
        const { renderLand } = await import("@pnw/art/land3d");
        const land = renderLand({ name, hour: hourOf(now), season: seasonOf(now), years, landmarks: placed });
        const markup = workerCardSvg({ name, recordSeed: `tenure:${name}:${card.issuedAt}`, image: land.dataUrl, skyline: land.skyline, dark: land.night || land.dusk }, text);
        if (!gone) setState({ kind: "drawn", markup });
      } catch {
        if (!gone) setState({ kind: "failed", message: `${view === "public" ? "The" : "Your"} land couldn't be drawn on this device.` });
      }
    })();
    return () => {
      gone = true;
    };
  }, [name, card.issuedAt, card.since, view, placedKey]); // eslint-disable-line react-hooks/exhaustive-deps
  if (state.kind === "drawing") return <p className={className ? `${className} text-sm text-muted-foreground` : "text-sm text-muted-foreground"}>Drawing {view === "public" ? "the" : "your"} land…</p>;
  if (state.kind === "failed") return <p className="text-sm text-muted-foreground">{state.message}</p>;
  // Our own SVG text, every word escaped by the renderer; the land is a picture this device drew.
  return <div className={className} dangerouslySetInnerHTML={{ __html: state.markup }} />;
}
