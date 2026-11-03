// ---------------------------------------------------------------------------
// How big a point is, and what to call it (docs/map/README.md), from its
// connections and its length, so the page and the still draw it alike
// (Joshua, 2026-11-03).
//
// Size is continuous: every connection adds to it, and so does every line of
// the file. The increments shrink as a point grows (a square-root curve), or
// a point with 157 connections would swallow the map; nothing jumps. A file
// nothing connects to stays a glint however long it is.
//
// The names are only names, for a point's panel and the filters: eight bands
// on the same scale, so there is more than one kind of sun.
//
//   dust      nothing connects to it or from it
//   comet     one or two connections, passing through
//   moon      a few
//   planet    well connected
//   giant     a gas giant: a hub of its region
//   star      what a region flows through
//   bright star
//   supergiant   what everything flows through
// ---------------------------------------------------------------------------

export const BODIES = ["dust", "comet", "moon", "planet", "giant", "star", "bright star", "supergiant"];
const BANDS = [0.001, 1.7, 3.0, 4.8, 7.0, 9.5, 13]; // the weight at which the next body begins

/** The weight of a point: 0 for dust; a point with 1 edge and no lines is 0.7; the biggest suns reach about 20. */
export function weight(degree, lines = 0) {
  if (!degree) return 0;
  const mass = Math.log2(1 + lines / 40) / 5; // 0 for no lines, ~0.36 at 100 lines, ~0.9 at 800, ~1.15 at 2000
  return Math.pow(degree, 0.55) * (0.7 + 0.8 * mass);
}

export function body(degree, lines = 0) {
  const w = weight(degree, lines);
  let i = 0;
  while (i < BANDS.length && w >= BANDS[i]) i++;
  return { weight: w, name: BODIES[i] };
}

/**
 * The size a body is drawn at (the point's size on the page): on a dense graph a power curve, so a
 * supergiant is some 25 times a comet (Joshua, 2026-11-03); on a small graph a straight line.
 */
export const drawnSize = (w, dense) => (dense ? 0.5 + 0.9 * Math.pow(w, 1.4) : 1.5 + 3 * w);

/** The room a body takes in the layout, in world units: about what its drawn size covers on screen. */
export const bodyRadius = (w, dense) => 0.29 * drawnSize(w, dense);

/** How hot a body glows, 0 to 1: dust barely, a supergiant fully. */
export const heat = (w) => Math.min(1, w / 12);
