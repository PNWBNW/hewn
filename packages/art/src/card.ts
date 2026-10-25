// ---------------------------------------------------------------------------
// The cards, as whole SVG documents on the 400 by 600 layout: a green header
// with the name and the card's kind, the art, the title and a line under it,
// and the footer with the record's mark and the app's own line. Every word on
// a card is passed in: this package knows no product name.
// ---------------------------------------------------------------------------

import { BRAND } from "@pnw/brand";
import { type Box, constellationSvg } from "./constellation";
import { type MapInput, mapSvg } from "./map";
import { logDefs, logSvg } from "./rings";
import { el, svgDocument, text } from "./svg";

export const CARD = { w: 400, h: 600 } as const;

const SANS = "Inter, Helvetica, Arial, sans-serif";
const MONO = "ui-monospace, Menlo, monospace";

export type CardText = {
  /** The name in the header, e.g. "dayco.hewn". */
  name: string;
  /** The kind in the header's corner, e.g. "BUSINESS". */
  kind: string;
  title: string;
  line: string;
  /** The footer's left side: the record's mark or date. */
  mark: string;
  /** The footer's right side: the app's own line. */
  footer: string;
};

type Rows = { title: number; line: number };
const ROWS: Rows = { title: 505, line: 528 };

function frame(t: CardText, inner: string, defs = "", rows: Rows = ROWS): string {
  const { green, cream, ink, cyan } = BRAND.colors;
  const body =
    (defs ? el("defs", {}, defs) : "") +
    el("rect", { x: 0, y: 0, width: CARD.w, height: CARD.h, fill: cream }) +
    el("rect", { x: 0, y: 0, width: CARD.w, height: 58, fill: green }) +
    text(20, 36, t.name, { fill: cream, "font-family": SANS, "font-weight": 600, "font-size": 18 }) +
    text(CARD.w - 20, 36, t.kind, { fill: cyan, "font-family": SANS, "font-weight": 500, "font-size": 11, "text-anchor": "end" }) +
    inner +
    text(20, rows.title, t.title, { fill: ink, "font-family": SANS, "font-weight": 600, "font-size": 16 }) +
    text(20, rows.line, t.line, { fill: "#43514c", "font-family": SANS, "font-size": 13 }) +
    text(20, 575, t.mark, { fill: "#6b7a74", "font-family": MONO, "font-size": 11 }) +
    text(CARD.w - 20, 575, t.footer, { fill: green, "font-family": SANS, "font-weight": 600, "font-size": 11, "text-anchor": "end" });
  return svgDocument(CARD.w, CARD.h, body, { role: "img", "aria-label": `${t.name}: ${t.title}` });
}

/** A business's card: its map and cross-section. */
export function businessCardSvg(map: MapInput, t: CardText): string {
  return frame(t, mapSvg(map));
}

export type PaystubCardInput = {
  /** The person's name, for their constellation. */
  name: string;
  /** The paystub's label: lights the star, shapes the log. */
  recordSeed: string;
  n: number;
  of: number;
  whole?: boolean;
  reversed?: number;
  /** The check line under the title, e.g. "Issued by dayco.hewn"; left out when not checked yet. */
  check?: string;
};

/** The paystub's face: the log and the constellation, with only what is safe to show. The log sits higher than a map, so the words do too. */
export function paystubCardSvg(p: PaystubCardInput, t: CardText & { line2?: string }): string {
  const { green } = BRAND.colors;
  const log = { cx: CARD.w / 2, cy: 300, r: 132, seed: p.recordSeed, n: p.n, of: p.of, whole: p.whole, reversed: p.reversed };
  const inner =
    constellationSvg({ name: p.name, recordSeed: p.recordSeed, box: { x: CARD.w - 150, y: 72, w: 130, h: 58 }, night: false }) +
    logSvg(log) +
    (t.line2 ? text(20, 516, t.line2, { fill: "#43514c", "font-family": SANS, "font-size": 13 }) : "") +
    (p.check ? text(20, 546, `✓ ${p.check}`, { fill: green, "font-family": SANS, "font-weight": 600, "font-size": 12 }) : "");
  return frame(t, inner, logDefs(log), { title: 470, line: 494 });
}

/** The art window a land is drawn into, on the card. */
export const LAND_WINDOW = { x: 14, y: 72, w: 372, h: 408 } as const;

export type WorkerCardInput = {
  /** The bare name, for the constellation. */
  name: string;
  /** The record's label: lights one star. */
  recordSeed: string;
  /** The rendered land, a PNG data URI (land3d.ts). */
  image: string;
  /** The lowest sky pixel per card column, so the constellation stays in the sky. */
  skyline: readonly number[];
  /** Night or dusk: the constellation in cyan. */
  dark: boolean;
};

/** Where the constellation fits in the sky: the first box, largest first, with sky under all of it. Null when none. */
export function constellationSpot(skyline: readonly number[]): Box | null {
  for (const sc of [1, 0.8, 0.62, 0.5]) {
    for (const by of [86, 100]) {
      for (const f of [0, 0.25, 0.5, 0.75, 1]) {
        const bw = 140 * sc;
        const bh = 70 * sc;
        const bx = Math.round(36 + f * (328 - bw));
        let ok = true;
        for (let x = bx; x <= bx + bw; x += 3) if (by + bh > (skyline[x] ?? 480) - 22) ok = false;
        if (ok) return { x: bx, y: by, w: bw, h: bh };
      }
    }
  }
  return null;
}

/** A worker's card: their land, rendered, with their constellation in its sky. */
export function workerCardSvg(w: WorkerCardInput, t: CardText): string {
  const { green } = BRAND.colors;
  const spot = constellationSpot(w.skyline);
  const inner =
    el("image", { x: LAND_WINDOW.x, y: LAND_WINDOW.y, width: LAND_WINDOW.w, height: LAND_WINDOW.h, preserveAspectRatio: "none", href: w.image }) +
    (spot ? constellationSvg({ name: w.name, recordSeed: w.recordSeed, box: spot, night: w.dark }) : "") +
    el("rect", { x: LAND_WINDOW.x, y: LAND_WINDOW.y, width: LAND_WINDOW.w, height: LAND_WINDOW.h, fill: "none", stroke: green, "stroke-width": 2 });
  return frame(t, inner, "", { title: 510, line: 533 });
}

