// ---------------------------------------------------------------------------
// The person's constellation (docs/HEWN_ART.md): its whole shape from their
// name, so it is the same on every card and paystub of theirs; one star lit
// by the record (a credential's commitment, a paystub's hash), which is what
// differs from card to card. Together they are the card's fingerprint.
// ---------------------------------------------------------------------------

import { BRAND } from "@pnw/brand";
import { rng } from "./seed";
import { type Pt, circle, el, polyline } from "./svg";

export type Box = { x: number; y: number; w: number; h: number };

/** The stars in the order the line joins them, in the unit square. Six to eight, apart from each other. */
export function constellationPoints(name: string): Pt[] {
  const me = rng("name:" + name);
  const n = 6 + Math.floor(me() * 3);
  const pts: Pt[] = [];
  let guard = 0;
  while (pts.length < n && guard++ < 600) {
    const x = me();
    const y = me();
    if (pts.some(([a, b]) => Math.hypot(a - x, (b - y) * 0.6) < 0.16)) continue;
    pts.push([x, y]);
  }
  // Joined nearest-first from the first star, so the line never crosses back and forth.
  const order: Pt[] = [pts[0]!];
  const left = pts.slice(1);
  while (left.length) {
    const last = order[order.length - 1]!;
    let k = 0;
    left.forEach((p, i) => {
      if (Math.hypot(p[0] - last[0], p[1] - last[1]) < Math.hypot(left[k]![0] - last[0], left[k]![1] - last[1])) k = i;
    });
    order.push(left.splice(k, 1)[0]!);
  }
  return order;
}

/** Which star the record lights: an index into the ordered points. */
export function litStar(recordSeed: string, count: number): number {
  return Math.floor(rng(recordSeed)() * count);
}

export type ConstellationOptions = {
  name: string;
  /** The record's label: what lights one star. */
  recordSeed: string;
  box: Box;
  /** Cyan on a dark sky; a deeper teal on paper. */
  night: boolean;
};

/** The constellation drawn into a box. */
export function constellationSvg({ name, recordSeed, box, night }: ConstellationOptions): string {
  const order = constellationPoints(name);
  const P = ([x, y]: Pt): Pt => [box.x + x * box.w, box.y + y * box.h];
  const pts = order.map(P);
  const lit = litStar(recordSeed, order.length);
  const cyan = BRAND.colors.cyan;
  const line = el("path", { d: polyline(pts), fill: "none", stroke: night ? cyan : "#117870", "stroke-opacity": night ? 0.75 : 0.6, "stroke-width": 1 });
  const stars = pts
    .map(([x, y], i) => {
      if (i !== lit) return circle(x, y, 1.9, { fill: night ? cyan : "#1a8f85" });
      const bright = night ? "#bffcf5" : cyan;
      return (
        circle(x, y, 7, { fill: night ? cyan : "#1a8f85", "fill-opacity": night ? 0.28 : 0.22 }) +
        circle(x, y, 3, { fill: bright }) +
        el("path", { d: `M${x - 7} ${y}L${x + 7} ${y}M${x} ${y - 7}L${x} ${y + 7}`.replace(/(\d)\.(\d{3,})/g, (m) => m.slice(0, 4)), stroke: bright, "stroke-width": 1, fill: "none" })
      );
    })
    .join("");
  return el("g", { class: "constellation" }, line + stars);
}
