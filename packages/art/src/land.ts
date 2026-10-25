// ---------------------------------------------------------------------------
// A worker's land (docs/HEWN_ART.md), as data: everything about the scene
// that comes from the name and the records, with no renderer in sight. The
// genome a name gives (range, foothills, river course and width, a lake or a
// bend at its head, where it enters, the valley's width and asymmetry, the
// forest in groves, the tree mix, the rocks); the terrain, which the river
// carves so the water never climbs a hill; the mountains scaled so the top
// third of the card stays sky; each landmark's best spot (off the card,
// crowding or hiding behind another, in the water or out of sight behind the
// ground all cost); the trees, rocks and grass. All of it deterministic and
// tested as data; the pixels come from land3d.ts, in a browser.
// ---------------------------------------------------------------------------

import { mulberry, rng, seedOf } from "./seed";
import type { Season } from "./sky";

export type Noise = (x: number, y: number) => number;

/** Seeded gradient noise in the unit lattice, -1 to 1. */
export function makeNoise(seed: number): Noise {
  const r = mulberry(seed);
  const p = new Uint16Array(512);
  const gx = new Float32Array(256);
  const gy = new Float32Array(256);
  const perm = [...Array(256).keys()];
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    const t = perm[i]!;
    perm[i] = perm[j]!;
    perm[j] = t;
  }
  for (let i = 0; i < 512; i++) p[i] = perm[i & 255]!;
  for (let i = 0; i < 256; i++) {
    const a = r() * Math.PI * 2;
    gx[i] = Math.cos(a);
    gy[i] = Math.sin(a);
  }
  const f = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
  return (x, y) => {
    const X = Math.floor(x);
    const Y = Math.floor(y);
    const xf = x - X;
    const yf = y - Y;
    const u = f(xf);
    const v = f(yf);
    const h = (i: number, j: number) => p[p[(X + i) & 255]! + ((Y + j) & 255)]!;
    const d = (i: number, j: number) => {
      const k = h(i, j);
      return gx[k]! * (xf - i) + gy[k]! * (yf - j);
    };
    const a = d(0, 0) + (d(1, 0) - d(0, 0)) * u;
    const b = d(0, 1) + (d(1, 1) - d(0, 1)) * u;
    return a + (b - a) * v;
  };
}

/** A fractal sum of the noise. */
export const fbm = (n: Noise, x: number, y: number, o = 5): number => {
  let s = 0;
  let a = 1;
  let f = 1;
  let t = 0;
  for (let i = 0; i < o; i++) {
    s += a * n(x * f, y * f);
    t += a;
    a *= 0.5;
    f *= 2.03;
  }
  return s / t;
};

/** Ridged noise: sharp crests, for the range. */
export const ridged = (n: Noise, x: number, y: number, o = 6): number => {
  let s = 0;
  let a = 1;
  let f = 1;
  let t = 0;
  for (let i = 0; i < o; i++) {
    let v = 1 - Math.abs(n(x * f, y * f));
    v *= v;
    s += a * v;
    t += a;
    a *= 0.5;
    f *= 2.1;
  }
  return s / t;
};

/** Smooth step from `a` to `b`. */
export const sstep = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export type Rgb = [number, number, number];

/** The land's colours by season: the grass's two tones and the trees'. */
export const LAND_SEASONS: Record<Season, { grass: Rgb; grass2: Rgb; tree: Rgb }> = {
  spring: { grass: [0.3, 0.48, 0.26], grass2: [0.4, 0.55, 0.3], tree: [0.1, 0.24, 0.17] },
  summer: { grass: [0.24, 0.42, 0.22], grass2: [0.33, 0.48, 0.24], tree: [0.08, 0.21, 0.15] },
  autumn: { grass: [0.47, 0.43, 0.22], grass2: [0.58, 0.5, 0.26], tree: [0.09, 0.21, 0.15] },
  winter: { grass: [0.86, 0.89, 0.92], grass2: [0.93, 0.95, 0.97], tree: [0.08, 0.18, 0.14] },
};

/** The 3D sky by the hour: the zenith and the horizon, in linear RGB. */
const SKY3D: readonly (readonly [number, Rgb, Rgb])[] = [
  [0, [0.02, 0.05, 0.1], [0.06, 0.11, 0.19]],
  [5.2, [0.03, 0.07, 0.13], [0.1, 0.17, 0.28]],
  [6.6, [0.45, 0.58, 0.72], [0.98, 0.78, 0.52]],
  [8.5, [0.32, 0.58, 0.8], [0.8, 0.89, 0.92]],
  [16.5, [0.3, 0.56, 0.79], [0.84, 0.91, 0.92]],
  [18.6, [0.24, 0.32, 0.5], [0.98, 0.62, 0.4]],
  [20.2, [0.05, 0.09, 0.17], [0.13, 0.2, 0.32]],
  [24, [0.02, 0.05, 0.1], [0.06, 0.11, 0.19]],
];

export function landSkyAt(hour: number): [Rgb, Rgb] {
  const h = Math.max(0, Math.min(24, hour));
  for (let i = 0; i < SKY3D.length - 1; i++) {
    const [a, a1, a2] = SKY3D[i]!;
    const [b, b1, b2] = SKY3D[i + 1]!;
    if (h >= a && h <= b) {
      const t = (h - a) / (b - a);
      const lerp = (p: Rgb, q: Rgb): Rgb => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, p[2] + (q[2] - p[2]) * t];
      return [lerp(a1, b1), lerp(a2, b2)];
    }
  }
  return [SKY3D[0]![1], SKY3D[0]![2]];
}

export const LAND_SUNRISE = 5.8;
export const LAND_SUNSET = 19.8;
export const landIsNight = (hour: number): boolean => hour < LAND_SUNRISE || hour > LAND_SUNSET;
export const landIsDusk = (hour: number): boolean => !landIsNight(hour) && (hour < 8 || hour > 17.4);

export type Genome = {
  forest: number;
  grove: number;
  open: number;
  rangeH: number;
  rangeD: number;
  sharp: number;
  far: boolean;
  farH: number;
  foot: number;
  side: number;
  rAmp: number;
  rFreq: number;
  rOff: number;
  rW: number;
  broad: number;
  fir: number;
  treeH: number;
  rocks: number;
  head: "lake" | "bend";
  bendSide: -1 | 1;
  bendD: number;
  lakeW: number;
  lakeL: number;
  lakeD: number;
  vw: number;
  asym: number;
  /** Where the river enters the card: left, middle or right. */
  entry: -1 | 0 | 1;
  /** The lake at the river's head, when the head is one. */
  lake: { d: number; w: number; l: number } | null;
};

/** What a name gives its land. The same name, the same genome. */
export function genome(name: string): Genome {
  const r = rng("genome:" + name);
  const g = {
    forest: 0.2 + r() * 0.35,
    grove: 0.6 + r() * 1.2,
    open: -0.05 + r() * 0.25,
    rangeH: 170 + r() * 140,
    rangeD: 470 + r() * 150,
    sharp: 0.9 + r() * 0.9,
    far: r() < 0.65,
    farH: 110 + r() * 120,
    foot: 20 + r() * 90,
    side: 0.5 + r() * 1.0,
    rAmp: 10 + r() * 45,
    rFreq: 0.007 + r() * 0.01,
    rOff: (r() - 0.5) * 50,
    rW: 4 + r() * 7,
  };
  // Two draws the first version made and no longer uses, kept so every land stays as it was.
  if (r() < 0.35) {
    r();
    r();
  }
  const broad = r() < 0.4 ? 0 : r() * 0.45;
  const rest = {
    broad,
    fir: r(),
    treeH: 0.8 + r() * 0.5,
    rocks: 20 + Math.floor(r() * 120),
    head: (r() < 0.2 ? "lake" : "bend") as "lake" | "bend",
    bendSide: (r() < 0.5 ? -1 : 1) as -1 | 1,
    bendD: 170 + r() * 90,
    lakeW: 45 + r() * 55,
    lakeL: 45 + r() * 35,
    lakeD: 215 + r() * 80,
    vw: 0.7 + r() * 1.4,
    asym: 0.6 + r() * 0.8,
    entry: [-1, 0, 1][Math.floor(r() * 3)] as -1 | 0 | 1,
  };
  const lake = rest.head === "lake" ? { d: rest.lakeD, w: rest.lakeW, l: rest.lakeL } : null;
  return { ...g, ...rest, lake };
}

export type Land = {
  name: string;
  G: Genome;
  /** Height at a point; the camera looks down -z. */
  H: (x: number, z: number) => number;
  /** The river's centre and half-width at a depth. */
  riverX: (z: number) => number;
  riverW: (z: number) => number;
  /** The mountains' scale that keeps the top third of the card sky. */
  mk: number;
  noise: { n1: Noise; n2: Noise; n3: Noise };
};

/** The land a name gives: its terrain and river as functions. */
export function landOf(name: string): Land {
  const G = genome(name);
  const n1 = makeNoise(seedOf("terrain:" + name));
  const n2 = makeNoise(seedOf("detail:" + name));
  const n3 = makeNoise(seedOf("river:" + name));
  const base = (d: number) => G.rAmp * 0.8 * n3(d * 0.005, 0.3) + G.rAmp * 0.5 * Math.sin(d * G.rFreq + 0.8) + G.rOff * sstep(0, 120, d);
  const b0 = base(0);
  const riverX = (z: number) => {
    const d = -z;
    const raw = base(d) - b0 * (1 - sstep(0, 220, d)) + G.entry * 21 * (1 - sstep(70, 300, d));
    const lim = 24 + d * 0.1;
    const e = Math.max(0, d - G.bendD);
    const bend = G.head === "bend" ? G.bendSide * (e < 160 ? (e * e) / 320 : e - 80) * 0.9 : 0;
    return lim * Math.tanh(raw / lim) + bend;
  };
  const riverW = (z: number) => {
    const d = -z;
    let w = Math.max(G.rW * 0.6, G.rW - d * 0.005);
    if (G.lake) w += G.lake.w * Math.exp(-(((d - G.lake.d) / G.lake.l) ** 2));
    return w;
  };
  const Hm = (x: number, z: number) => {
    const d = -z;
    let h = sstep(G.rangeD, G.rangeD + 240, d) * Math.pow(ridged(n1, x * 0.0026 + 10, z * 0.0026, 7), G.sharp) * G.rangeH;
    if (G.far) h += sstep(880, 1100, d) * ridged(n2, x * 0.0018 + 3, z * 0.0018, 6) * G.farH;
    return h;
  };
  const Hb = (x: number, z: number) => {
    const d = -z;
    return (
      fbm(n2, x * 0.02, z * 0.02, 3) * 1.6 +
      sstep(150, 380, d) * (fbm(n1, x * 0.005, z * 0.005, 5) * 0.5 + 0.5) * G.foot +
      sstep(140, 300, (Math.abs(x) - d * 0.12) * G.side) * (fbm(n2, x * 0.006, z * 0.006, 4) * 0.5 + 0.5) * 70
    );
  };
  // The mountains are scaled so the skyline always leaves the top third of the card to the sky.
  let mk = 1;
  {
    const camY = Hb(0, 30) + 19;
    const lim = 0.25;
    for (let d = 300; d < 1300; d += 12) {
      for (let t = -1; t <= 1; t += 0.04) {
        const x = t * (30 + d) * 0.36;
        const z = -d;
        const m = Hm(x, z);
        if (m < 1) continue;
        const room = lim * (30 + d) + camY - Hb(x, z);
        mk = Math.min(mk, Math.max(0.25, room / m));
      }
    }
  }
  // The river shapes the valley; it ends in a lake at the foot of the range, or bends out of sight.
  const H = (x: number, z: number) => {
    const d = -z;
    const rx = riverX(z);
    const sl = (riverX(z - 1) - riverX(z + 1)) / 2;
    const rd = Math.abs(x - rx) / Math.sqrt(1 + sl * sl);
    const w = riverW(z);
    const floor = fbm(n2, x * 0.02, z * 0.02, 3) * 1.6;
    const vw = G.vw * (x > rx ? G.asym : 1 / G.asym);
    const end = G.lake ? sstep(G.lake.d + G.lake.l * 0.4, G.lake.d + G.lake.l * 1.6, d) : 0;
    const hf = end + (1 - end) * sstep(w + 3, w + (16 + d * 0.1) * vw, rd);
    const pf = end + (1 - end) * sstep(w + 6, w + (40 + d * 0.22) * vw, rd);
    return floor + (Hb(x, z) - floor) * hf + mk * Hm(x, z) * pf - (1 - sstep(w, w + 7, rd)) * 3.6 * (1 - end);
  };
  return { name, G, H, riverX, riverW, mk, noise: { n1, n2, n3 } };
}

export type LandmarkKind = "employment" | "skills" | "clearance" | "custom";
export type LandmarkStatus = "active" | "pending" | "revoked";
export type Landmark = {
  type: LandmarkKind;
  /** The record's label: where the landmark stands comes from it. */
  seed: string;
  status: LandmarkStatus;
};

export type Placed = {
  kind: "pine" | "cabin" | "bridge" | "cairn" | "lookout";
  x: number;
  z: number;
  /** Ground kept clear of trees around it. */
  clear: number;
  lm?: Landmark;
  rot?: number;
};

/** The camera's height above the ground at the card's foot. */
export const camYOf = (land: Land): number => land.H(0, 30) + 19;

/**
 * Where the pine and each landmark stand. Each keeps its best spot: off the card, crowding or
 * hiding behind another, in the water or out of sight behind the ground all cost.
 */
export function placeLandmarks(land: Land, landmarks: readonly Landmark[]): Placed[] {
  const { H, riverX, riverW, name } = land;
  const out: Placed[] = [];
  const camY = camYOf(land);
  const pen = (x: number, z: number, h: number, cl = 6) => {
    let s = 0;
    const a = x / (30 - z);
    if (Math.abs(a) > 0.25) s += 10 + Math.abs(a) * 40;
    for (const p of out) {
      if (Math.hypot(p.x - x, p.z - z) < p.clear + 6) s += 5;
      const da = Math.abs(p.x / (30 - p.z) - a);
      const need = (p.clear * 0.6) / (30 - p.z) + (cl * 0.6) / (30 - z) + 0.02;
      if (da < need) s += (z < p.z ? 14 : 4) * (1 - da / need);
    }
    if (H(x, z) < 0.4) s += 6;
    const ty = H(x, z) + h * 0.6;
    for (let t = 0.15; t < 0.97; t += 0.04) {
      const ry = camY + (ty - camY) * t;
      if (H(x * t, 30 + (z - 30) * t) + 1.0 > ry) {
        s += 4;
        break;
      }
    }
    return s;
  };
  type Spot = { x: number; z: number; s: number; extra?: number };
  const pick = (r: () => number, gen: (r: () => number, f: number) => [number, number, number?], h: number, cl: number, tries = 400): Spot => {
    let best: Spot | null = null;
    for (let g = 0; g < tries; g++) {
      const [x, z, extra] = gen(r, g / tries);
      const s = pen(x, z, h, cl);
      if (!best || s < best.s) best = { x, z, s, extra };
      if (s === 0) break;
    }
    return best!;
  };
  {
    const pr = rng("pine:" + name);
    const b = pick(
      pr,
      (r, f) => {
        const z = -(68 + r() * (22 + f * 30));
        return [riverX(z) + (r() < 0.5 ? -1 : 1) * (riverW(z) + 8 + r() * (14 + f * 20)), z];
      },
      8,
      7,
    );
    out.push({ kind: "pine", x: b.x, z: b.z, clear: 7 });
  }
  for (const lm of landmarks) {
    const lr = rng(lm.seed);
    if (lm.type === "employment") {
      const b = pick(
        lr,
        (r, f) => {
          const z = -(92 + r() * (70 + f * 40));
          return [riverX(z) + (r() < 0.5 ? -1 : 1) * (riverW(z) + 10 + r() * 40), z, (r() - 0.5) * 0.8];
        },
        5,
        11,
      );
      out.push({ kind: "cabin", lm, x: b.x, z: b.z, rot: b.extra ?? 0, clear: 11 });
    }
    if (lm.type === "skills") {
      let best: [number, number, number] | null = null;
      for (let k = 0; k < 120; k++) {
        const zz = -(96 + k * 1.1);
        const xx = riverX(zz);
        if (riverW(zz) > 9) continue;
        const sc = pen(xx, zz, 3, 12) * 10 + Math.abs(k - 25 + lr() * 20);
        if (!best || sc < best[2]) best = [xx, zz, sc];
      }
      const b = best ?? [riverX(-120), -120, 0];
      out.push({ kind: "bridge", lm, x: b[0], z: b[1], clear: 12 });
    }
    if (lm.type === "custom") {
      const b = pick(
        lr,
        (r, f) => {
          const z = -(58 + r() * (44 + f * 30));
          return [riverX(z) + (r() < 0.5 ? -1 : 1) * (riverW(z) + 4 + r() * 30), z];
        },
        2.5,
        4,
      );
      out.push({ kind: "cairn", lm, x: b.x, z: b.z, clear: 4 });
    }
    if (lm.type === "clearance") {
      let best: [number, number, number] | null = null;
      for (let k = 0; k < 700; k++) {
        const zz = -(260 + lr() * 160);
        const xx = (lr() - 0.5) * (zz * -0.5);
        const y = H(xx, zz);
        if (!best || y > best[1]) best = [xx, y, zz];
      }
      out.push({ kind: "lookout", lm, x: best![0], z: best![2], clear: 9 });
    }
  }
  return out;
}

/** Whether a point lies in the sight line between the camera and a placed thing (the lookout stands above it all). */
export function inSight(placed: readonly Placed[], x: number, z: number, lat: number, from: number): boolean {
  return placed.some((p) => {
    if (p.kind === "lookout") return false;
    const t = (30 - z) / (30 - p.z);
    return t > from && t < 1.02 && Math.abs(x - p.x * t) < lat * (0.5 + p.clear / 12);
  });
}

/** A tree: where, how tall, which way it faces, its own variation, and its kind (0 spruce, 1 fir, 2 broadleaf). */
export type Tree = { x: number; y: number; z: number; scale: number; rot: number; v: number; kind: 0 | 1 | 2 };

/** The forest, in groves, on gentle ground below the treeline, clear of the river and the landmarks. */
export function treesOf(land: Land, season: Season, placed: readonly Placed[]): Tree[] {
  const { H, G, name } = land;
  const { n1, n2 } = land.noise;
  const tr = rng("trees:" + name);
  const out: Tree[] = [];
  const max = Math.round(1200 + G.forest * 7000);
  for (let k = 0; k < 60000 && out.length < max; k++) {
    const d = 40 + Math.pow(tr(), 0.9) * 760;
    const x = (tr() - 0.5) * (160 + d * 0.85);
    const z = -d;
    const y = H(x, z);
    if (y > 165 + fbm(n2, x * 0.02, z * 0.02, 2) * 40) continue;
    if (fbm(n1, x * 0.004 * G.grove + 7, z * 0.004 * G.grove, 3) < G.open) continue;
    const e = 1.5;
    const sl = Math.hypot(H(x + e, z) - y, H(x, z + e) - y) / e;
    if (sl > 0.85) continue;
    if (y < 0.2) continue;
    if (placed.some((p) => Math.hypot(x - p.x, z - p.z) < p.clear)) continue;
    if (inSight(placed, x, z, 9, 0.35)) continue;
    if (d < 165 && Math.abs(x - 6) < 62 + d * 0.25 + fbm(n2, x * 0.02, z * 0.02, 2) * 30) continue;
    if (d < 170 && tr() < 0.5) continue;
    const kind: 0 | 1 | 2 = season !== "winter" && y < 70 && tr() < G.broad ? 2 : tr() < G.fir ? 1 : 0;
    out.push({ x, y, z, scale: (0.75 + tr() * 0.7) * G.treeH, rot: tr() * 6.28, v: tr(), kind });
  }
  return out;
}

export type Rock = { x: number; y: number; z: number; scale: number; rx: number; ry: number; rz: number; sx: number };

/** Boulders along the river, out of the landmarks' sight lines. */
export function rocksOf(land: Land, placed: readonly Placed[]): Rock[] {
  const { H, G, riverX, name } = land;
  const br = rng("rocks:" + name);
  const out: Rock[] = [];
  for (let k = 0; k < 3000 && out.length < G.rocks; k++) {
    const d = 40 + br() * 120;
    const x = riverX(-d) + (br() - 0.5) * (br() < 0.6 ? 40 : 160 + d * 0.7);
    const z = -d;
    if (H(x, z) < -1.2 || inSight(placed, x, z, 3, 0.6)) continue;
    const sc = 0.4 + br() * br() * 2.4;
    const y = H(x, z) - sc * 0.3;
    out.push({ x, y, z, scale: sc, rx: br() * 3, ry: br() * 3, rz: br() * 3, sx: 1 + br() * 0.5 });
  }
  return out;
}

export type Blade = { x: number; y: number; z: number; d: number; h: number; rx: number; ry: number; rz: number; colour: Rgb };

/** The grass near the camera, up to `max` blades (none in winter). */
export function grassOf(land: Land, season: Season, max = 56000): Blade[] {
  if (season === "winter") return [];
  const { H, name } = land;
  const S = LAND_SEASONS[season];
  const gr = rng("grass:" + name);
  const out: Blade[] = [];
  for (let k = 0; k < 130000 && out.length < max; k++) {
    const d = 24 + Math.pow(gr(), 1.7) * 260;
    const x = (gr() - 0.5) * (40 + d * 0.95);
    const z = -d;
    if (H(x, z) < -1.0) continue;
    const h = (0.3 + gr() * 0.5) * (1 + d * 0.002);
    const rx = (gr() - 0.5) * 0.6;
    const ry = gr() * 6;
    const rz = (gr() - 0.5) * 0.6;
    const t = gr();
    let colour: Rgb = [S.grass2[0] * (0.95 + t * 0.45), S.grass2[1] * (0.95 + t * 0.45), S.grass2[2] * (0.95 + t * 0.45)];
    if (season === "autumn" && t > 0.6) colour = [0.62, 0.52, 0.28];
    if (season === "spring" && gr() < 0.012) colour = gr() < 0.5 ? [0.95, 0.85, 0.35] : [0.6, 0.5, 0.85];
    out.push({ x, y: H(x, z) - 0.05, z, d, h, rx, ry, rz, colour });
  }
  return out;
}

/** The ground's colour at a vertex: grass by season, rock on steep slopes, snow above the line, the river's bank. */
export function groundColour(land: Land, season: Season, x: number, y: number, z: number, ny: number): Rgb {
  const S = LAND_SEASONS[season];
  const { n1, n2 } = land.noise;
  const peak = land.mk * land.G.rangeH * 0.75 + 40;
  const snowLine = season === "winter" ? 14 : peak * { spring: 0.55, summer: 0.8, autumn: 0.68 }[season];
  const v = fbm(n2, x * 0.05, z * 0.05, 3) * 0.5 + 0.5;
  const v2 = fbm(n1, x * 0.012 + 5, z * 0.012, 3) * 0.5 + 0.5;
  let c: Rgb = [0, 0, 0];
  for (let k = 0; k < 3; k++) c[k] = (S.grass[k]! + (S.grass2[k]! - S.grass[k]!) * v) * (0.82 + v2 * 0.36);
  const rock: Rgb = [0.36 + v * 0.08, 0.34 + v * 0.07, 0.31 + v * 0.06];
  const rockT = sstep(0.86, 0.66, ny);
  c = [c[0] + (rock[0] - c[0]) * rockT, c[1] + (rock[1] - c[1]) * rockT, c[2] + (rock[2] - c[2]) * rockT];
  const sn = sstep(snowLine - 12 + v * 30, snowLine + 18 + v * 30, y) * sstep(0.45, 0.7, ny);
  c = [c[0] + (0.94 - c[0]) * sn, c[1] + (0.94 - c[1]) * sn, c[2] + (0.94 - c[2]) * sn];
  const bank = (1 - sstep(-1.8, 0.4, y)) * (season === "winter" ? 0 : 0.55);
  return [c[0] + (0.52 - c[0]) * bank, c[1] + (0.48 - c[1]) * bank, c[2] + (0.38 - c[2]) * bank];
}

/** Facts about a land for tests and the checker: the river's entry, its head, and where things stand (on the card, out of the water). */
export function landFacts(name: string, landmarks: readonly Landmark[] = []): { entry: -1 | 0 | 1; head: "lake" | "bend"; placed: Placed[]; inFrame: boolean; dry: boolean } {
  const land = landOf(name);
  const placed = placeLandmarks(land, landmarks);
  const inFrame = placed.every((p) => Math.abs(p.x / (30 - p.z)) <= 0.25);
  // The water lies at -2.2; a pine on the bank stands above it.
  const dry = placed.every((p) => p.kind === "bridge" || land.H(p.x, p.z) > -1.0);
  return { entry: land.G.entry, head: land.G.head, placed, inFrame, dry };
}
