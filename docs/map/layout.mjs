// ---------------------------------------------------------------------------
// Where every node sits (docs/map/README.md). Regions are placed by the data
// (`at`), like the lobes of a brain; the nodes of a region settle inside its
// lobe by a small force simulation: they push each other apart, edges pull
// their ends together, and every node is drawn back toward its region's
// centre. Seeded, so the same graph always lays out the same way; pure, so
// it runs in Node at build time and could run in a browser unchanged.
// ---------------------------------------------------------------------------

import { body, bodyRadius } from "./bodies.mjs";

/** mulberry32: a small seeded generator, enough for scatter. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The lobe's radius: grows with its population, and never less than the sphere its bodies need
 * (`room` is the sum of their (radius + gap)³; a loose packing fills about a third of a sphere).
 */
export function regionRadius(count, room = 0) {
  return Math.max(16 + 9 * Math.sqrt(count), 1.5 * Math.cbrt(room / 0.35));
}

/** The gap kept around every body, in world units, beyond its radius. */
export const GAP = 2.5;

/**
 * Lays out `graph` (regions with `at`, nodes with `region`, edges with `from` and `to`) and
 * returns `{ nodes, regions }`: each node with `x`, `y`, `z` and `degree`; each region with
 * `count` and `radius`. The input is not changed.
 */
export function layout(graph, { iterations = 320, seed = 7 } = {}) {
  const random = rng(seed);
  const regions = new Map(graph.regions.map((r) => [r.id, { ...r, count: 0, room: 0 }]));
  for (const n of graph.nodes) regions.get(n.region).count += 1;

  const index = new Map(graph.nodes.map((n, i) => [n.id, i]));
  const n = graph.nodes.length;
  const dense = graph.edges.length > 800;
  const pos = new Float64Array(n * 3);
  const vel = new Float64Array(n * 3);
  const degree = new Uint32Array(n);
  const edges = graph.edges.map((e) => [index.get(e.from), index.get(e.to)]);
  for (const [a, b] of edges) {
    degree[a] += 1;
    degree[b] += 1;
  }
  // Every body's radius, and the room each region's bodies take together.
  const radius = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    radius[i] = bodyRadius(body(degree[i], graph.nodes[i].lines ?? 0).weight, dense);
    regions.get(graph.nodes[i].region).room += (radius[i] + GAP) ** 3;
  }
  for (const r of regions.values()) r.radius = regionRadius(r.count, r.room);
  for (let i = 0; i < n; i++) {
    const r = regions.get(graph.nodes[i].region);
    const spread = r.radius * 0.6;
    pos[i * 3] = r.at[0] + (random() - 0.5) * spread;
    pos[i * 3 + 1] = r.at[1] + (random() - 0.5) * spread;
    pos[i * 3 + 2] = r.at[2] + (random() - 0.5) * spread;
  }

  const REPEL = 260; // between any two nodes, falling with the square of the distance
  const SPRING_SAME = 0.012; // an edge inside a region
  const SPRING_CROSS = 0.0025; // an edge between regions: a nudge toward the other lobe, not a tow
  const REST = 9;
  const HOME = 0.03; // the pull back to the region's centre
  const DAMP = 0.82;

  for (let step = 0; step < iterations; step++) {
    const cool = 1 - step / iterations;
    for (let i = 0; i < n; i++) {
      let fx = 0, fy = 0, fz = 0;
      const ix = pos[i * 3], iy = pos[i * 3 + 1], iz = pos[i * 3 + 2];
      for (let j = 0; j < n; j++) {
        if (j === i) continue;
        const dx = ix - pos[j * 3], dy = iy - pos[j * 3 + 1], dz = iz - pos[j * 3 + 2];
        const d2 = dx * dx + dy * dy + dz * dz + 1;
        const d = Math.sqrt(d2);
        let f = REPEL / d2;
        // Bodies don't overlap: inside both radii and the gap, push hard.
        const apart = radius[i] + radius[j] + GAP;
        if (d < apart) f += (apart - d) * 0.9;
        fx += (dx / d) * f;
        fy += (dy / d) * f;
        fz += (dz / d) * f;
      }
      const r = regions.get(graph.nodes[i].region);
      fx += (r.at[0] - ix) * HOME;
      fy += (r.at[1] - iy) * HOME;
      fz += (r.at[2] - iz) * HOME;
      // Stay inside the lobe: a soft wall at the region's radius.
      const hx = ix - r.at[0], hy = iy - r.at[1], hz = iz - r.at[2];
      const h = Math.sqrt(hx * hx + hy * hy + hz * hz);
      if (h > r.radius) {
        const over = (h - r.radius) * 0.2;
        fx -= (hx / h) * over;
        fy -= (hy / h) * over;
        fz -= (hz / h) * over;
      }
      vel[i * 3] = (vel[i * 3] + fx) * DAMP;
      vel[i * 3 + 1] = (vel[i * 3 + 1] + fy) * DAMP;
      vel[i * 3 + 2] = (vel[i * 3 + 2] + fz) * DAMP;
    }
    for (const [a, b] of edges) {
      const dx = pos[b * 3] - pos[a * 3], dy = pos[b * 3 + 1] - pos[a * 3 + 1], dz = pos[b * 3 + 2] - pos[a * 3 + 2];
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz) + 0.001;
      const same = graph.nodes[a].region === graph.nodes[b].region;
      const k = same ? SPRING_SAME : SPRING_CROSS;
      const f = (d - REST) * k;
      const ux = (dx / d) * f, uy = (dy / d) * f, uz = (dz / d) * f;
      vel[a * 3] += ux; vel[a * 3 + 1] += uy; vel[a * 3 + 2] += uz;
      vel[b * 3] -= ux; vel[b * 3 + 1] -= uy; vel[b * 3 + 2] -= uz;
    }
    for (let i = 0; i < n * 3; i++) pos[i] += vel[i] * cool;
  }

  // Whatever still touches is parted outright: each pair moved apart by half its overlap, until none is left.
  let overlaps = 0;
  for (let pass = 0; pass < 80; pass++) {
    overlaps = 0;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const dx = pos[j * 3] - pos[i * 3], dy = pos[j * 3 + 1] - pos[i * 3 + 1], dz = pos[j * 3 + 2] - pos[i * 3 + 2];
        const apart = radius[i] + radius[j] + GAP;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 >= apart * apart) continue;
        overlaps++;
        const d = Math.sqrt(d2) || 0.001;
        const push = (apart - d) / 2 + 0.01;
        const ux = dx / d, uy = dy / d, uz = dz / d;
        pos[i * 3] -= ux * push; pos[i * 3 + 1] -= uy * push; pos[i * 3 + 2] -= uz * push;
        pos[j * 3] += ux * push; pos[j * 3 + 1] += uy * push; pos[j * 3 + 2] += uz * push;
      }
    }
    if (!overlaps) break;
  }
  if (overlaps) throw new Error(`layout: ${overlaps} pairs of bodies still overlap after the parting passes`);

  const nodes = graph.nodes.map((node, i) => ({
    ...node,
    x: round(pos[i * 3]),
    y: round(pos[i * 3 + 1]),
    z: round(pos[i * 3 + 2]),
    degree: degree[i],
    radius: round(radius[i]),
  }));
  return { nodes, regions: [...regions.values()] };
}

const round = (v) => Math.round(v * 100) / 100;
