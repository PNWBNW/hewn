// ---------------------------------------------------------------------------
// The paystub's log (docs/HEWN_ART.md): a hewn log's cross-section, one ring
// per paycheck this year, the rings still to come faint, this paycheck's
// ring cyan, a corrected or reversed paycheck's ring dashed. Ring widths come
// from the paystub's hash, never from the pay or the hours.
// ---------------------------------------------------------------------------

import { BRAND } from "@pnw/brand";
import { rng, seedOf } from "./seed";
import { type Pt, el, polyline } from "./svg";

export type LogInput = {
  cx: number;
  cy: number;
  /** The log's radius. */
  r: number;
  /** The paystub's label: what the bark and the ring widths come from. */
  seed: string;
  /** This paycheck's number in the year (1-based); the ring lit cyan. */
  n: number;
  /** Paychecks in the year. */
  of: number;
  /** The year-end log: every ring complete, none cyan. */
  whole?: boolean;
  /** A corrected or reversed paycheck's number: its ring is dashed. */
  reversed?: number;
};

/** The log as an SVG group. Needs its gradient in `<defs>`: see `logDefs`. */
export function logSvg(input: LogInput): string {
  const { cx, cy, r: R, n, of } = input;
  const rnd = rng(input.seed);
  const cyan = BRAND.colors.cyan;
  const parts: string[] = [];
  // Bark: a rough edge around the log.
  const bark: Pt[] = [];
  for (let a = 0; a <= 6.3; a += 0.05) {
    const rr = R + 8 + Math.sin(a * 7 + rnd()) * 3 + rnd() * 2;
    bark.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]);
  }
  parts.push(el("path", { d: polyline(bark, true), fill: "#3b2a1e" }));
  parts.push(el("circle", { cx, cy, r: R, fill: `url(#${logGradientId(input.seed)})` }));
  // One ring a paycheck, widths from the hash, two slow wobbles so no ring is a circle.
  const widths = Array.from({ length: Math.max(1, of) }, () => 0.6 + rnd() * 0.8);
  const sum = widths.reduce((a, b) => a + b, 0);
  const wob: [number, number] = [rnd() * 6.28, rnd() * 6.28];
  let radius = 8;
  for (let i = 0; i < Math.max(1, of); i++) {
    radius += (widths[i]! / sum) * (R - 12);
    const cur = !input.whole && i === n - 1;
    const done = input.whole || i < n;
    const ring: Pt[] = [];
    for (let a = 0; a <= 6.3; a += 0.04) {
      const rr = radius + 1.4 * Math.sin(a * 3 + wob[0]) + 1 * Math.sin(a * 5 + wob[1]);
      ring.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]);
    }
    parts.push(
      el("path", {
        d: polyline(ring, true),
        fill: "none",
        stroke: cur ? cyan : "#5c361c",
        "stroke-opacity": cur ? 1 : done ? 0.75 : 0.16,
        "stroke-width": cur ? 3 : done ? 1.2 : 0.7,
        "stroke-dasharray": input.reversed === i + 1 ? "3 3" : undefined,
      }),
    );
  }
  return el("g", { class: "log" }, parts.join(""));
}

/** The gradient's id for a log, unique to its seed so two logs on a page don't share one. */
export const logGradientId = (seed: string): string => `wood-${seedOf(seed).toString(16)}`;

/** The wood's gradient, for the document's `<defs>`. */
export function logDefs(input: Pick<LogInput, "cx" | "cy" | "r" | "seed">): string {
  return el(
    "radialGradient",
    { id: logGradientId(input.seed), gradientUnits: "userSpaceOnUse", cx: input.cx, cy: input.cy, r: input.r, fx: input.cx, fy: input.cy },
    el("stop", { offset: "0%", "stop-color": "#b9773f" }) + el("stop", { offset: "50%", "stop-color": "#e2b47a" }) + el("stop", { offset: "100%", "stop-color": "#f1d3a0" }),
  );
}
