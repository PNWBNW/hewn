import { describe, expect, it } from "vitest";
import { genome, grassOf, groundColour, landFacts, landIsDusk, landIsNight, landOf, landSkyAt, makeNoise, placeLandmarks, rocksOf, sstep, treesOf } from "./land";
import { constellationSpot } from "./card";

const NAMES = ["ana_w", "kwame15", "olu_works", "sato", "bea", "marco", "dayco_works", "june_builds", "ravi", "mei_works", "x", "zz_top99"];
const LANDMARKS = [
  { type: "employment" as const, seed: "emp-1", status: "active" as const },
  { type: "skills" as const, seed: "sk-1", status: "pending" as const },
  { type: "clearance" as const, seed: "cl-1", status: "active" as const },
  { type: "custom" as const, seed: "cu-1", status: "active" as const },
];

describe("the genome", () => {
  it("is the name's: the same every time, different for another name, every value in its range", () => {
    expect(genome("ana_w")).toEqual(genome("ana_w"));
    expect(genome("ana_w")).not.toEqual(genome("ana_x"));
    for (const n of NAMES) {
      const g = genome(n);
      expect(g.forest).toBeGreaterThanOrEqual(0.2);
      expect(g.forest).toBeLessThanOrEqual(0.55);
      expect(g.rangeH).toBeGreaterThanOrEqual(170);
      expect(g.rW).toBeGreaterThanOrEqual(4);
      expect([-1, 0, 1]).toContain(g.entry);
      expect(["lake", "bend"]).toContain(g.head);
      expect(g.lake === null).toBe(g.head === "bend");
    }
  });

  it("gives the river every entry and a lake to about one name in five", () => {
    const many = Array.from({ length: 200 }, (_, i) => genome(`name_${i}`));
    const entries = new Set(many.map((g) => g.entry));
    expect(entries.size).toBe(3);
    const lakes = many.filter((g) => g.head === "lake").length;
    expect(lakes).toBeGreaterThan(20);
    expect(lakes).toBeLessThan(80);
  });
});

describe("the terrain", () => {
  it("is smooth noise in -1..1 and a smooth step", () => {
    const n = makeNoise(7);
    for (let i = 0; i < 500; i++) {
      const v = n(i * 0.37, i * 0.11);
      expect(Math.abs(v)).toBeLessThanOrEqual(1);
    }
    expect(n(1.5, 2.5)).toBe(makeNoise(7)(1.5, 2.5));
    expect(sstep(0, 1, -1)).toBe(0);
    expect(sstep(0, 1, 2)).toBe(1);
    expect(sstep(0, 1, 0.5)).toBe(0.5);
  });

  it("keeps the water below the banks the whole way up the valley", () => {
    for (const n of NAMES) {
      const land = landOf(n);
      // At a lake the river ends; past its head the valley closes over by design.
      const until = land.G.lake ? land.G.lake.d - land.G.lake.l : 400;
      for (let d = 40; d < until; d += 10) {
        const z = -d;
        const rx = land.riverX(z);
        const w = land.riverW(z);
        expect(land.H(rx, z)).toBeLessThan(land.H(rx + w + 12, z));
        expect(land.H(rx, z)).toBeLessThan(land.H(rx - w - 12, z));
        expect(land.H(rx, z)).toBeLessThan(0.4);
      }
    }
  });

  it("scales the range so the top of the card stays sky, never below a quarter", () => {
    for (const n of NAMES) {
      const land = landOf(n);
      expect(land.mk).toBeGreaterThanOrEqual(0.25);
      expect(land.mk).toBeLessThanOrEqual(1);
    }
  });

  it("colours the ground by season: snow in winter, rock on steep slopes", () => {
    const land = landOf("ana_w");
    const winter = groundColour(land, "winter", 10, 30, -200, 0.95);
    expect(winter[0]).toBeGreaterThan(0.8);
    const steep = groundColour(land, "summer", 10, 3, -200, 0.5);
    const flat = groundColour(land, "summer", 10, 3, -200, 0.98);
    expect(steep).not.toEqual(flat);
    expect(groundColour(land, "summer", 10, 3, -200, 0.98)).toEqual(flat);
  });
});

describe("placing the landmarks", () => {
  it("gives every name a pine, and each landmark a spot on the card, apart, out of the water", () => {
    for (const n of NAMES) {
      const f = landFacts(n, LANDMARKS);
      expect(f.placed.map((p) => p.kind)).toEqual(["pine", "cabin", "bridge", "lookout", "cairn"]);
      expect(f.inFrame).toBe(true);
      expect(f.dry).toBe(true);
      for (let i = 0; i < f.placed.length; i++) {
        for (let j = i + 1; j < f.placed.length; j++) {
          const a = f.placed[i]!;
          const b = f.placed[j]!;
          if (a.kind === "lookout" || b.kind === "lookout") continue;
          expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThan(Math.min(a.clear, b.clear));
        }
      }
    }
  });

  it("puts the bridge on the river and the lookout on high ground", () => {
    for (const n of NAMES) {
      const land = landOf(n);
      const placed = placeLandmarks(land, LANDMARKS);
      const bridge = placed.find((p) => p.kind === "bridge")!;
      expect(Math.abs(bridge.x - land.riverX(bridge.z))).toBeLessThan(0.01);
      const lookout = placed.find((p) => p.kind === "lookout")!;
      expect(land.H(lookout.x, lookout.z)).toBeGreaterThan(land.H(0, -100));
    }
  });

  it("is the record's: the same records, the same spots; another record, another spot", () => {
    const a = placeLandmarks(landOf("ana_w"), LANDMARKS);
    expect(placeLandmarks(landOf("ana_w"), LANDMARKS)).toEqual(a);
    const b = placeLandmarks(landOf("ana_w"), [{ ...LANDMARKS[0]!, seed: "emp-2" }]);
    expect(b[1]!.x !== a[1]!.x || b[1]!.z !== a[1]!.z).toBe(true);
  });
});

describe("the forest, the rocks and the grass", () => {
  it("are many, deterministic, on the ground, and clear of the landmarks", () => {
    const land = landOf("ana_w");
    const placed = placeLandmarks(land, LANDMARKS);
    const trees = treesOf(land, "summer", placed);
    expect(trees.length).toBeGreaterThan(500);
    expect(trees).toEqual(treesOf(land, "summer", placed));
    for (const t of trees.slice(0, 300)) {
      expect(t.y).toBeGreaterThanOrEqual(0.2);
      for (const p of placed) expect(Math.hypot(t.x - p.x, t.z - p.z)).toBeGreaterThanOrEqual(p.clear);
    }
    expect(treesOf(land, "winter", placed).every((t) => t.kind !== 2)).toBe(true);
    const rocks = rocksOf(land, placed);
    expect(rocks.length).toBeGreaterThan(0);
    expect(rocks.length).toBeLessThanOrEqual(land.G.rocks);
    expect(grassOf(land, "winter")).toEqual([]);
    const grass = grassOf(land, "spring", 2000);
    expect(grass.length).toBe(2000);
    expect(grass.every((b) => b.h > 0)).toBe(true);
  });
});

describe("the land's sky", () => {
  it("knows night and dusk, and blends between its keys", () => {
    expect(landIsNight(2)).toBe(true);
    expect(landIsNight(12)).toBe(false);
    expect(landIsDusk(7)).toBe(true);
    expect(landIsDusk(12)).toBe(false);
    expect(landIsDusk(23)).toBe(false);
    expect(landSkyAt(12)[0][2]).toBeCloseTo(0.8, 1);
    expect(landSkyAt(0)).toEqual([[0.02, 0.05, 0.1], [0.06, 0.11, 0.19]]);
  });

  it("finds the constellation a box with sky under all of it, or none", () => {
    expect(constellationSpot(new Array(400).fill(300))).toEqual({ x: 36, y: 86, w: 140, h: 70 });
    expect(constellationSpot(new Array(400).fill(100))).toBeNull();
    const ridge = new Array(400).fill(300).map((v, x) => (x < 200 ? 120 : v));
    const spot = constellationSpot(ridge)!;
    expect(spot.x).toBeGreaterThanOrEqual(200);
  });
});
