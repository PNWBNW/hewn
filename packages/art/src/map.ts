// ---------------------------------------------------------------------------
// A business's land as a topographic map (docs/HEWN_ART.md): the terrain
// from its name, contours every twelfth of the summit, a cyan contour that
// climbs a level with each year on Hewn, the constellation in the corner,
// and below, the cross-section through the summit. Live: the hillshade is
// lit from where the sun is at the hour; at night the map turns to dark
// paper with cream lines; the season tints the land. The tint and hillshade
// are one small raster (the heightmap's own resolution), scaled up smooth
// by whoever shows the SVG; everything else is lines.
// ---------------------------------------------------------------------------

import { BRAND } from "@pnw/brand";
import { constellationSvg } from "./constellation";
import { pngDataUri } from "./png";
import { mix, rng } from "./seed";
import { SUNRISE, SUNSET, type Season, isNight } from "./sky";
import { type Pt, el, fmt, polyline, segments, text } from "./svg";

/** The heightmap's cells: columns and rows. */
export const GRID = { w: 96, h: 70 } as const;

export type Terrain = {
  /** `hm[j][i]`, rows top to bottom, (GRID.h + 1) by (GRID.w + 1). */
  hm: number[][];
  /** The summit's height, and its cell. */
  top: number;
  topAt: [number, number];
};

/** The terrain a name gives: a few peaks and soft noise. The same name, the same land. */
export function terrainOf(name: string): Terrain {
  const rnd = rng("topo:" + name);
  const peaks = Array.from({ length: 2 + Math.floor(rnd() * 3) }, () => ({ x: 0.15 + rnd() * 0.7, y: 0.15 + rnd() * 0.7, h: 0.5 + rnd() * 0.5, r: 0.12 + rnd() * 0.18 }));
  const noise = Array.from({ length: 6 }, () => [rnd() * 6.28, 1 + rnd() * 3, 1 + rnd() * 3, rnd() * 0.06] as const);
  const hm: number[][] = [];
  let top = 0;
  let topAt: [number, number] = [0, 0];
  for (let j = 0; j <= GRID.h; j++) {
    const row: number[] = [];
    for (let i = 0; i <= GRID.w; i++) {
      const u = i / GRID.w;
      const v = j / GRID.h;
      let z = 0;
      for (const p of peaks) {
        const d = Math.hypot((u - p.x) / p.r, (v - p.y) / p.r);
        z += p.h * Math.exp(-d * d);
      }
      for (const [ph, fx, fy, a] of noise) z += a * Math.sin(u * fx * 6 + ph) * Math.cos(v * fy * 6 - ph);
      row.push(z);
      if (z > top) {
        top = z;
        topAt = [i, j];
      }
    }
    hm.push(row);
  }
  return { hm, top, topAt };
}

const TINT: Record<Season, { low: [number, number, number, number]; high: [number, number, number, number] }> = {
  spring: { low: [90, 150, 95, 40], high: [245, 240, 227, 0] },
  summer: { low: [45, 115, 75, 55], high: [140, 160, 90, 30] },
  autumn: { low: [200, 150, 70, 55], high: [160, 110, 55, 35] },
  winter: { low: [120, 150, 170, 30], high: [255, 255, 255, 190] },
};

/** The tint by elevation and the hillshade lit from the sun's hour, as RGBA pixels, one a cell. */
export function tintPixels(t: Terrain, hour: number, season: Season): Uint8Array {
  const { low, high } = TINT[season];
  const night = isNight(hour);
  const az = Math.PI * (1 - (hour - SUNRISE) / (SUNSET - SUNRISE));
  const lx = Math.cos(az);
  const ly = -0.6;
  const px = new Uint8Array(GRID.w * GRID.h * 4);
  for (let j = 0; j < GRID.h; j++) {
    for (let i = 0; i < GRID.w; i++) {
      const z = t.hm[j]![i]! / t.top;
      const f = Math.max(0, Math.min(1, (z - 0.45) / 0.25));
      let c = low.map((v, k) => v + (high[k]! - v) * f);
      if (!night && i && j) {
        const sh = ((t.hm[j]![i]! - t.hm[j]![i - 1]!) * lx + (t.hm[j]![i]! - t.hm[j - 1]![i]!) * ly) * 14;
        if (sh > 0) {
          const k = Math.min(0.5, sh);
          c = [c[0]! * (1 - k) + 17 * k, c[1]! * (1 - k) + 59 * k, c[2]! * (1 - k) + 49 * k, Math.max(c[3]!, k * 120)];
        }
      }
      const q = (j * GRID.w + i) * 4;
      px[q] = Math.round(c[0]!);
      px[q + 1] = Math.round(c[1]!);
      px[q + 2] = Math.round(c[2]!);
      px[q + 3] = Math.round(night && season !== "winter" ? c[3]! * 0.4 : c[3]!);
    }
  }
  return px;
}

/** The segments of one contour at height `level`, by marching squares, in map coordinates. */
export function contour(t: Terrain, level: number, X: (i: number) => number, Y: (j: number) => number): (readonly [Pt, Pt])[] {
  const out: (readonly [Pt, Pt])[] = [];
  const e = (p: number, q: number, x1: number, y1: number, x2: number, y2: number): Pt => {
    const f = (level - p) / (q - p);
    return [x1 + (x2 - x1) * f, y1 + (y2 - y1) * f];
  };
  for (let j = 0; j < GRID.h; j++) {
    for (let i = 0; i < GRID.w; i++) {
      const a = t.hm[j]![i]!;
      const b = t.hm[j]![i + 1]!;
      const c = t.hm[j + 1]![i + 1]!;
      const d = t.hm[j + 1]![i]!;
      const pts: Pt[] = [];
      if (a < level !== b < level) pts.push(e(a, b, X(i), Y(j), X(i + 1), Y(j)));
      if (b < level !== c < level) pts.push(e(b, c, X(i + 1), Y(j), X(i + 1), Y(j + 1)));
      if (c < level !== d < level) pts.push(e(c, d, X(i + 1), Y(j + 1), X(i), Y(j + 1)));
      if (d < level !== a < level) pts.push(e(d, a, X(i), Y(j + 1), X(i), Y(j)));
      for (let q = 0; q + 1 < pts.length; q += 2) out.push([pts[q]!, pts[q + 1]!]);
    }
  }
  return out;
}

export type MapInput = {
  name: string;
  /** Hour of the day, 0 to 24, with its minutes. */
  hour: number;
  season: Season;
  /** Whole years on Hewn; the cyan contour climbs a level a year. */
  years: number;
  /** What the cross-section says beside the cyan line, e.g. "3 yr" or "new". */
  yearsLabel: string;
};

/** The map's window and the cross-section's, on the 400 by 600 card. */
export const MAP = { x: 14, y: 72, w: 372, h: 290 } as const;
export const SECTION = { x: 14, y: 372, w: 372, h: 100 } as const;

const SANS = "Inter, Helvetica, Arial, sans-serif";
const MONO = "ui-monospace, Menlo, monospace";

/** The level the cyan contour sits at: a share of the summit, higher each year, never above 0.9. */
export const tenureLevel = (years: number): number => Math.min(0.9, 0.12 + Math.max(0, years) * 0.1);

/** The map and the cross-section as one SVG group, for the business's card. */
export function mapSvg(input: MapInput): string {
  const t = terrainOf(input.name);
  const night = isNight(input.hour);
  const { green, cream, cyan } = BRAND.colors;
  const paper = night ? "#0e1b2a" : cream;
  const ink = night ? "#e9e2cf" : green;
  const X = (i: number) => MAP.x + (i / GRID.w) * MAP.w;
  const Y = (j: number) => MAP.y + (j / GRID.h) * MAP.h;
  const parts: string[] = [];

  parts.push(el("rect", { x: MAP.x, y: MAP.y, width: MAP.w, height: MAP.h, fill: paper }));
  parts.push(
    el("image", {
      x: MAP.x,
      y: MAP.y,
      width: MAP.w,
      height: MAP.h,
      preserveAspectRatio: "none",
      href: pngDataUri(GRID.w, GRID.h, tintPixels(t, input.hour, input.season)),
    }),
  );
  // Contours, every fourth one heavier.
  const levels = 12;
  for (let k = 1; k < levels; k++) {
    const d = segments(contour(t, (t.top * k) / levels, X, Y));
    if (d) parts.push(el("path", { d, fill: "none", stroke: ink, "stroke-opacity": k % 4 === 0 ? 0.9 : 0.5, "stroke-width": k % 4 === 0 ? 1.4 : 0.8 }));
  }
  const lvl = tenureLevel(input.years);
  const cyanD = segments(contour(t, t.top * lvl, X, Y));
  if (cyanD) parts.push(el("path", { d: cyanD, fill: "none", stroke: cyan, "stroke-width": 2.4 }));
  // A grid, a north arrow and a scale, as on a survey map.
  const gridLines: (readonly [Pt, Pt])[] = [];
  for (let i = 0; i <= 6; i++) gridLines.push([[MAP.x + (MAP.w * i) / 6, MAP.y], [MAP.x + (MAP.w * i) / 6, MAP.y + MAP.h]]);
  for (let j = 0; j <= 5; j++) gridLines.push([[MAP.x, MAP.y + (MAP.h * j) / 5], [MAP.x + MAP.w, MAP.y + (MAP.h * j) / 5]]);
  parts.push(el("path", { d: segments(gridLines), stroke: ink, "stroke-opacity": night ? 0.12 : 0.1, "stroke-width": 0.6, fill: "none" }));
  parts.push(text(MAP.x + 12, MAP.y + MAP.h - 30, "N", { fill: ink, "font-family": SANS, "font-weight": 600, "font-size": 10 }));
  parts.push(el("path", { d: polyline([[MAP.x + 15, MAP.y + MAP.h - 44], [MAP.x + 11, MAP.y + MAP.h - 34], [MAP.x + 19, MAP.y + MAP.h - 34]], true), fill: ink }));
  parts.push(el("rect", { x: MAP.x + 30, y: MAP.y + MAP.h - 14, width: 40, height: 2, fill: ink }));
  parts.push(text(MAP.x + 74, MAP.y + MAP.h - 10, "1 km", { fill: ink, "font-family": MONO, "font-size": 9 }));
  // The summit's height, a figure of the land's own.
  const [ti, tj] = t.topAt;
  parts.push(text(X(ti) + 12, Y(tj) + 8, `${Math.round(1200 + t.top * 800)} m`, { fill: ink, "font-family": MONO, "font-size": 9 }));
  parts.push(constellationSvg({ name: input.name, recordSeed: "topo-card:" + input.name, box: { x: MAP.x + MAP.w - 128, y: MAP.y + 12, w: 112, h: 56 }, night }));
  parts.push(el("rect", { x: MAP.x, y: MAP.y, width: MAP.w, height: MAP.h, fill: "none", stroke: green, "stroke-width": 2 }));

  // The cross-section through the summit, hatched, the cyan level across it.
  const row = t.hm[tj]!;
  const py = (i: number) => SECTION.y + SECTION.h - 8 - (row[i]! / t.top) * (SECTION.h - 26);
  parts.push(el("rect", { x: SECTION.x, y: SECTION.y, width: SECTION.w, height: SECTION.h, fill: cream }));
  const profile: Pt[] = [];
  for (let i = 0; i <= GRID.w; i++) profile.push([X(i), py(i)]);
  parts.push(el("path", { d: polyline([[X(0), SECTION.y + SECTION.h], ...profile, [X(GRID.w), SECTION.y + SECTION.h]], true), fill: green, "fill-opacity": 0.12 }));
  const hatch: (readonly [Pt, Pt])[] = [];
  for (let i = 0; i <= GRID.w; i += 2) hatch.push([[X(i), py(i)], [X(i), SECTION.y + SECTION.h]]);
  parts.push(el("path", { d: segments(hatch), stroke: green, "stroke-opacity": 0.35, "stroke-width": 0.7, fill: "none" }));
  parts.push(el("path", { d: polyline(profile), stroke: green, "stroke-width": 1.6, fill: "none" }));
  const yy = SECTION.y + SECTION.h - 8 - lvl * (SECTION.h - 26);
  const runs: (readonly [Pt, Pt])[] = [];
  let start: number | null = null;
  for (let i = 0; i <= GRID.w + 1; i++) {
    const on = i <= GRID.w && row[i]! / t.top >= lvl;
    if (on && start === null) start = i;
    if (!on && start !== null) {
      if (i - 1 > start) runs.push([[X(start), yy], [X(i - 1), yy]]);
      start = null;
    }
  }
  if (runs.length) parts.push(el("path", { d: segments(runs), stroke: cyan, "stroke-width": 2, fill: "none" }));
  // The label sits at whichever edge the hill leaves clear of hatching: the right, unless the land is high there.
  const rightClear = row[GRID.w]! / t.top < lvl;
  const leftClear = row[0]! / t.top < lvl;
  const labelX = rightClear || !leftClear ? X(GRID.w) - 40 : X(0) + 6;
  parts.push(text(labelX, yy - 4, input.yearsLabel, { fill: cyan, "font-family": SANS, "font-weight": 600, "font-size": 9 }));
  parts.push(el("rect", { x: SECTION.x, y: SECTION.y, width: SECTION.w, height: SECTION.h, fill: "none", stroke: green, "stroke-width": 1 }));

  return el("g", { class: "map" }, parts.join(""));
}

/** For tests and the checker: the summit's cell and the share of the land above the cyan level. */
export function mapFacts(name: string, years: number): { summit: [number, number]; aboveTenure: number } {
  const t = terrainOf(name);
  const lvl = tenureLevel(years) * t.top;
  let above = 0;
  for (const row of t.hm) for (const z of row) if (z >= lvl) above++;
  return { summit: t.topAt, aboveTenure: above / ((GRID.w + 1) * (GRID.h + 1)) };
}

export { fmt, mix };
