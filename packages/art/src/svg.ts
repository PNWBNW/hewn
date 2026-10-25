// ---------------------------------------------------------------------------
// Building SVG as text. Every number is rounded to two decimals and every
// string escaped, so the same drawing is the same bytes on every machine and
// a card can be tested byte for byte.
// ---------------------------------------------------------------------------

/** A coordinate or length, rounded so the text is stable (and `-0` never appears). */
export function fmt(n: number): string {
  const r = Math.round(n * 100) / 100;
  return (Object.is(r, -0) ? 0 : r).toString();
}

/** Text safe inside an element or an attribute. */
export function esc(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export type Attrs = Record<string, string | number | undefined>;

/** One element; attributes left undefined are left out. */
export function el(tag: string, attrs: Attrs, inner?: string): string {
  const a = Object.entries(attrs)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => ` ${k}="${typeof v === "number" ? fmt(v) : esc(v!)}"`)
    .join("");
  return inner === undefined ? `<${tag}${a}/>` : `<${tag}${a}>${inner}</${tag}>`;
}

export type Pt = readonly [number, number];

/** A path through the points, closed when asked. */
export function polyline(points: readonly Pt[], close = false): string {
  if (points.length === 0) return "";
  const d = points.map(([x, y], i) => `${i ? "L" : "M"}${fmt(x)} ${fmt(y)}`).join("");
  return close ? `${d}Z` : d;
}

/** Separate segments (pairs of points) as one path: `M a L b M c L d …`. */
export function segments(pairs: readonly (readonly [Pt, Pt])[]): string {
  return pairs.map(([a, b]) => `M${fmt(a[0])} ${fmt(a[1])}L${fmt(b[0])} ${fmt(b[1])}`).join("");
}

/** A circle's path, so a drawing never depends on `<circle>` rendering differences. */
export function circle(cx: number, cy: number, r: number, attrs: Attrs = {}): string {
  return el("circle", { cx, cy, r, ...attrs });
}

/** Text at a baseline. `anchor` is start unless given. */
export function text(x: number, y: number, s: string, attrs: Attrs = {}): string {
  return el("text", { x, y, ...attrs }, esc(s));
}

/** The document: a fixed viewBox, scaled by whoever shows it. */
export function svgDocument(width: number, height: number, inner: string, attrs: Attrs = {}): string {
  return el("svg", { xmlns: "http://www.w3.org/2000/svg", viewBox: `0 0 ${fmt(width)} ${fmt(height)}`, width, height, ...attrs }, inner);
}
