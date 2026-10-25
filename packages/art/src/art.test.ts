import { createHash } from "node:crypto";
import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { BRAND } from "@pnw/brand";
import { businessCardSvg, paystubCardSvg } from "./card";
import { constellationPoints, constellationSvg, litStar } from "./constellation";
import { GRID, MAP, contour, mapFacts, mapSvg, tenureLevel, terrainOf, tintPixels } from "./map";
import { adler32, base64, crc32, pngFromRgba, zlibStored } from "./png";
import { ART_VERSION, mix, mulberry, rng, seedOf } from "./seed";
import { hourOf, isNight, seasonOf, skyAt } from "./sky";
import { el, esc, fmt, polyline, segments, svgDocument } from "./svg";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

describe("the seed", () => {
  it("is the same for the same label and differs between labels", () => {
    expect(seedOf("ana_w")).toBe(seedOf("ana_w"));
    expect(seedOf("ana_w")).not.toBe(seedOf("ana_x"));
    const a = mulberry(seedOf("x"));
    const b = mulberry(seedOf("x"));
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
    for (let i = 0; i < 1000; i++) {
      const v = a();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
    expect(ART_VERSION).toBe(1);
  });

  it("mixes colours in hex", () => {
    expect(mix("#000000", "#ffffff", 0.5)).toBe("#808080");
    expect(mix("#113b31", "#113b31", 0.3)).toBe("#113b31");
    expect(rng("a")()).toBe(rng("a")());
  });
});

describe("svg text", () => {
  it("writes stable numbers and escapes text", () => {
    expect(fmt(1.005)).toBe("1");
    expect(fmt(1.2349)).toBe("1.23");
    expect(fmt(-0.001)).toBe("0");
    expect(esc(`<a href="x">&`)).toBe("&lt;a href=&quot;x&quot;&gt;&amp;");
    expect(el("rect", { x: 1, y: 2.555, fill: "red", stroke: undefined })).toBe('<rect x="1" y="2.56" fill="red"/>');
    expect(polyline([[0, 0], [1.5, 2]], true)).toBe("M0 0L1.5 2Z");
    expect(segments([[[0, 0], [1, 1]], [[2, 2], [3, 3]]])).toBe("M0 0L1 1M2 2L3 3");
    expect(svgDocument(10, 20, "")).toContain('viewBox="0 0 10 20"');
  });
});

describe("the png writer", () => {
  it("writes a png whose stored stream inflates back to the rows", () => {
    const w = 3;
    const h = 2;
    const px = new Uint8Array(w * h * 4).map((_, i) => (i * 37) & 255);
    const png = pngFromRgba(w, h, px);
    expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    // IHDR at 8: length 13, "IHDR", width, height, 8-bit RGBA.
    expect([...png.subarray(8, 16)]).toEqual([0, 0, 0, 13, 73, 72, 68, 82]);
    expect([...png.subarray(16, 24)]).toEqual([0, 0, 0, 3, 0, 0, 0, 2]);
    expect([...png.subarray(24, 29)]).toEqual([8, 6, 0, 0, 0]);
    const idatLen = (png[33]! << 24) | (png[34]! << 16) | (png[35]! << 8) | png[36]!;
    expect(String.fromCharCode(...png.subarray(37, 41))).toBe("IDAT");
    const raw = inflateSync(Buffer.from(png.subarray(41, 41 + idatLen)));
    expect(raw.length).toBe((w * 4 + 1) * h);
    expect(raw[0]).toBe(0);
    expect([...raw.subarray(1, 1 + w * 4)]).toEqual([...px.subarray(0, w * 4)]);
    expect(String.fromCharCode(...png.subarray(png.length - 8, png.length - 4))).toBe("IEND");
  });

  it("agrees with the known checksums and base64", () => {
    const abc = new TextEncoder().encode("abc");
    expect(crc32(abc).toString(16)).toBe("352441c2");
    expect(adler32(new TextEncoder().encode("Wikipedia")).toString(16)).toBe("11e60398");
    expect(base64(new TextEncoder().encode("Man"))).toBe("TWFu");
    expect(base64(new TextEncoder().encode("Ma"))).toBe("TWE=");
    expect(base64(new TextEncoder().encode("M"))).toBe("TQ==");
    expect(inflateSync(Buffer.from(zlibStored(abc))).toString()).toBe("abc");
    const big = new Uint8Array(70_000).map((_, i) => i & 255);
    expect(Buffer.compare(inflateSync(Buffer.from(zlibStored(big))), Buffer.from(big))).toBe(0);
  });
});

describe("the sky", () => {
  it("is ink at night, blue by day, and warm at the edges", () => {
    expect(isNight(3)).toBe(true);
    expect(isNight(12)).toBe(false);
    expect(skyAt(12)[0]).toBe("#5aa6c2");
    expect(skyAt(0)).toEqual(["#060f1a", "#14273c"]);
    expect(skyAt(6.5)).toEqual(["#7fa4c0", "#f6c886"]);
    expect(skyAt(7.5)[0]).not.toBe(skyAt(6.5)[0]);
    expect(seasonOf(new Date(2026, 0, 15))).toBe("winter");
    expect(seasonOf(new Date(2026, 3, 15))).toBe("spring");
    expect(seasonOf(new Date(2026, 6, 15))).toBe("summer");
    expect(seasonOf(new Date(2026, 9, 25))).toBe("autumn");
    expect(hourOf(new Date(2026, 9, 25, 14, 30))).toBe(14.5);
  });
});

describe("the constellation", () => {
  it("is the person's: the same shape from the same name, six to eight stars apart from each other", () => {
    const a = constellationPoints("ana_w");
    expect(a).toEqual(constellationPoints("ana_w"));
    expect(a).not.toEqual(constellationPoints("kwame"));
    for (const name of ["ana_w", "kwame", "olu_works", "x"]) {
      const pts = constellationPoints(name);
      expect(pts.length).toBeGreaterThanOrEqual(6);
      expect(pts.length).toBeLessThanOrEqual(8);
      for (let i = 0; i < pts.length; i++) {
        for (let j = i + 1; j < pts.length; j++) expect(Math.hypot(pts[i]![0] - pts[j]![0], (pts[i]![1] - pts[j]![1]) * 0.6)).toBeGreaterThanOrEqual(0.16);
      }
    }
  });

  it("lights one star by the record, and draws the lit one larger", () => {
    const n = constellationPoints("ana_w").length;
    expect(litStar("paystub:2026-18", n)).toBe(litStar("paystub:2026-18", n));
    const seen = new Set<number>();
    for (let i = 0; i < 40; i++) seen.add(litStar(`rec-${i}`, n));
    expect(seen.size).toBeGreaterThan(1);
    const svg = constellationSvg({ name: "ana_w", recordSeed: "r", box: { x: 0, y: 0, w: 100, h: 50 }, night: false });
    expect(svg.match(/<circle /g)?.length).toBe(n + 1);
    expect(svg).toContain(BRAND.colors.cyan);
  });
});

describe("the map", () => {
  it("gives the same land to the same name and a different one to another", () => {
    const a = terrainOf("dayco");
    expect(a.hm.length).toBe(GRID.h + 1);
    expect(a.hm[0]!.length).toBe(GRID.w + 1);
    expect(a).toEqual(terrainOf("dayco"));
    expect(terrainOf("dayco").topAt).not.toEqual(terrainOf("brothers").topAt);
    expect(a.hm[a.topAt[1]]![a.topAt[0]]).toBe(a.top);
  });

  it("tints by season and shades by the sun, and turns dark at night", () => {
    const t = terrainOf("dayco");
    const day = tintPixels(t, 12, "summer");
    expect(day.length).toBe(GRID.w * GRID.h * 4);
    expect(tintPixels(t, 12, "summer")).toEqual(day);
    expect(tintPixels(t, 12, "winter")).not.toEqual(day);
    expect(tintPixels(t, 8, "summer")).not.toEqual(day);
    const night = tintPixels(t, 23, "summer");
    let dayAlpha = 0;
    let nightAlpha = 0;
    for (let i = 3; i < day.length; i += 4) {
      dayAlpha += day[i]!;
      nightAlpha += night[i]!;
    }
    expect(nightAlpha).toBeLessThan(dayAlpha);
  });

  it("draws contours inside the grid, and a cyan one that climbs a level a year", () => {
    const t = terrainOf("dayco");
    const X = (i: number) => i;
    const Y = (j: number) => j;
    const segs = contour(t, t.top / 2, X, Y);
    expect(segs.length).toBeGreaterThan(20);
    for (const [a, b] of segs) {
      for (const p of [a, b]) {
        expect(p[0]).toBeGreaterThanOrEqual(0);
        expect(p[0]).toBeLessThanOrEqual(GRID.w);
        expect(p[1]).toBeGreaterThanOrEqual(0);
        expect(p[1]).toBeLessThanOrEqual(GRID.h);
      }
    }
    expect(contour(t, t.top * 2, X, Y)).toEqual([]);
    expect(tenureLevel(0)).toBeCloseTo(0.12);
    expect(tenureLevel(3)).toBeCloseTo(0.42);
    expect(tenureLevel(20)).toBe(0.9);
    expect(mapFacts("dayco", 0).aboveTenure).toBeGreaterThan(mapFacts("dayco", 5).aboveTenure);
  });

  it("is one deterministic group with the raster, the contours, the constellation and the section", () => {
    const input = { name: "dayco", hour: 14, season: "autumn" as const, years: 2, yearsLabel: "2 yr" };
    const svg = mapSvg(input);
    expect(mapSvg(input)).toBe(svg);
    expect(svg.startsWith('<g class="map">')).toBe(true);
    expect(svg).toContain('href="data:image/png;base64,');
    expect(svg).toContain(`stroke="${BRAND.colors.cyan}" stroke-width="2.4"`);
    expect(svg).toContain('class="constellation"');
    expect(svg).toContain(">2 yr<");
    expect(svg).toContain(">1 km<");
    expect(svg).toContain(" m<");
    expect(svg).toContain(`x="${MAP.x}" y="${MAP.y}"`);
    expect(svg).not.toContain("NaN");
    expect(svg).not.toContain("undefined");
    expect(svg).not.toBe(mapSvg({ ...input, name: "brothers" }));
    expect(mapSvg({ ...input, hour: 23 })).toContain('fill="#0e1b2a"');
  });
});

describe("the cards", () => {
  const map = { name: "dayco", hour: 10, season: "spring" as const, years: 1, yearsLabel: "1 yr" };
  const text = { name: "dayco.hewn", kind: "BUSINESS", title: "Dayco Builders", line: "Construction · Portland", mark: "since 2026-10-25", footer: "this app · on a chain" };

  it("draws a business's card as one document, the same every time", () => {
    const svg = businessCardSvg(map, text);
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 600"')).toBe(true);
    expect(svg.endsWith("</svg>")).toBe(true);
    expect(sha(svg)).toBe(sha(businessCardSvg(map, text)));
    for (const s of [">dayco.hewn<", ">BUSINESS<", ">Dayco Builders<", ">Construction · Portland<", ">since 2026-10-25<", ">this app · on a chain<"]) expect(svg).toContain(s);
    expect(svg).toContain('aria-label="dayco.hewn: Dayco Builders"');
    expect(svg.length).toBeLessThan(200_000);
  });

  it("escapes what it is given", () => {
    const svg = businessCardSvg(map, { ...text, title: `<script>alert("x")</script>` });
    expect(svg).not.toContain("<script>");
    expect(svg).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
  });

  it("draws a paystub's face: this paycheck's ring cyan, the rings to come faint, a reversed one dashed", () => {
    const p = { name: "ana_w", recordSeed: "paystub:ana:2026-18", n: 18, of: 26 };
    const t = { name: "ana_w.hewn", kind: "PAYSTUB", title: "18 of 26 · 2026", line: "Dayco Builders", mark: "0x5c01…a2", footer: "this app" };
    const svg = paystubCardSvg(p, t);
    expect(svg).toBe(paystubCardSvg(p, t));
    expect(svg.match(/class="log"/g)?.length).toBe(1);
    expect(svg).toContain('<radialGradient id="wood-');
    expect(svg.match(/stroke="#18dccb" stroke-opacity="1" stroke-width="3"/g)?.length).toBe(1);
    expect(svg.match(/stroke-opacity="0.16"/g)?.length).toBe(26 - 18);
    expect(svg).not.toContain("stroke-dasharray");
    expect(paystubCardSvg({ ...p, reversed: 3 }, t)).toContain('stroke-dasharray="3 3"');
    expect(paystubCardSvg({ ...p, whole: true }, t)).not.toContain('stroke-width="3"');
    expect(paystubCardSvg({ ...p, check: "Issued by dayco.hewn" }, t)).toContain(">✓ Issued by dayco.hewn<");
    expect(svg).not.toBe(paystubCardSvg({ ...p, recordSeed: "paystub:ana:2026-19", n: 19 }, t));
  });
});
