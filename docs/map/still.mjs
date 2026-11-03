// ---------------------------------------------------------------------------
// A still of a laid-out graph as SVG (docs/map/README.md): the view from one
// fixed angle, drawn deterministically in Node, so the README can show the
// current map without a browser having rendered it. No scripts, no
// external references: GitHub's image proxy can serve it as it is.
// ---------------------------------------------------------------------------

const W = 1200, H = 630, PAD = 56;

/** Rotates a point about Y then X, then drops depth: an orthographic look from front-right, slightly above. */
function project([x, y, z], ay = -0.55, ax = 0.3) {
  const cy = Math.cos(ay), sy = Math.sin(ay);
  const x1 = x * cy + z * sy, z1 = -x * sy + z * cy;
  const cx = Math.cos(ax), sx = Math.sin(ax);
  const y2 = y * cx - z1 * sx, z2 = y * sx + z1 * cx;
  return [x1, -y2, z2];
}
const n2 = (v) => Math.round(v * 100) / 100;
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");

export function stillSvg(graph, laid, meta = {}) {
  const regions = new Map(laid.regions.map((r) => [r.id, r]));
  const pts = laid.nodes.map((n) => ({ n, p: project([n.x, n.y, n.z]) }));
  const regionPts = laid.regions.map((r) => ({ r, p: project(r.at) }));
  const all = [...pts.map((q) => q.p), ...regionPts.map((q) => q.p)];
  const minX = Math.min(...all.map((p) => p[0])), maxX = Math.max(...all.map((p) => p[0]));
  const minY = Math.min(...all.map((p) => p[1])), maxY = Math.max(...all.map((p) => p[1]));
  const scale = Math.min((W - 2 * PAD) / (maxX - minX || 1), (H - 2 * PAD - 30) / (maxY - minY || 1));
  const ox = (W - (maxX - minX) * scale) / 2 - minX * scale;
  const oy = (H - 30 - (maxY - minY) * scale) / 2 - minY * scale;
  const sx = (p) => n2(p[0] * scale + ox), sy = (p) => n2(p[1] * scale + oy);
  const index = new Map(laid.nodes.map((n, i) => [n.id, i]));

  const out = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(graph.title)}">`);
  out.push(`<title>${esc(graph.title)}</title>`);
  out.push(`<defs><radialGradient id="g"><stop offset="0" stop-color="#fff" stop-opacity=".5"/><stop offset=".4" stop-color="#fff" stop-opacity=".16"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient><filter id="b" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="2.2"/></filter></defs>`);
  out.push(`<rect width="${W}" height="${H}" fill="#04070d"/>`);
  // Lobes.
  for (const { r, p } of regionPts) out.push(`<circle cx="${sx(p)}" cy="${sy(p)}" r="${n2(r.radius * scale * 1.5)}" fill="url(#g)" style="color:${r.colour}" opacity=".9"><animate attributeName="r" dur="0s"/></circle>`);
  // The gradient is white; tint each lobe by drawing it through its colour.
  out.length -= regionPts.length;
  for (const { r, p } of regionPts) {
    out.push(`<radialGradient id="g-${r.id}"><stop offset="0" stop-color="${r.colour}" stop-opacity=".42"/><stop offset=".45" stop-color="${r.colour}" stop-opacity=".12"/><stop offset="1" stop-color="${r.colour}" stop-opacity="0"/></radialGradient>`);
    out.push(`<circle cx="${sx(p)}" cy="${sy(p)}" r="${n2(r.radius * scale * 1.5)}" fill="url(#g-${r.id})"/>`);
  }
  // Edges, by class, back to front doesn't matter at this opacity.
  const byClass = new Map();
  for (const e of graph.edges) {
    const a = pts[index.get(e.from)], b = pts[index.get(e.to)];
    if (!a || !b) continue;
    const c = graph.classes[e.class]?.colour ?? "#f5f0e3";
    if (!byClass.has(c)) byClass.set(c, []);
    byClass.get(c).push(`M${sx(a.p)} ${sy(a.p)}L${sx(b.p)} ${sy(b.p)}`);
  }
  const edgeOpacity = Math.max(0.05, Math.min(0.22, 220 / Math.max(1, graph.edges.length)));
  for (const [c, d] of byClass) out.push(`<path d="${d.join("")}" stroke="${c}" stroke-opacity="${edgeOpacity}" stroke-width=".7" fill="none"/>`);
  // Points: a blurred halo, then the point, far to near.
  pts.sort((a, b) => b.p[2] - a.p[2]);
  const halo = [], dots = [];
  for (const { n, p } of pts) {
    const r = 0.25 + 0.62 * Math.log2(1 + (n.degree ?? 0)); // the same log scale as the page: no edges, almost nothing; hubs, planets
    const c = regions.get(n.region)?.colour ?? "#f5f0e3";
    halo.push(`<circle cx="${sx(p)}" cy="${sy(p)}" r="${n2(r * 1.8)}" fill="${c}" opacity=".3"/>`);
    dots.push(`<circle cx="${sx(p)}" cy="${sy(p)}" r="${n2(r)}" fill="${c}"/>`);
  }
  out.push(`<g filter="url(#b)">${halo.join("")}</g>`, `<g>${dots.join("")}</g>`);
  // Region labels, above each lobe.
  for (const { r, p } of regionPts) {
    const x = sx(p), y = n2(sy(p) - r.radius * scale * 0.95 - 6);
    out.push(`<text x="${x}" y="${y}" fill="${r.colour}" font-family="ui-monospace,Menlo,Consolas,monospace" font-size="11" letter-spacing="1.6" text-anchor="middle">${esc(r.name.toUpperCase())}</text>`);
    out.push(`<text x="${x}" y="${y + 13}" fill="#f5f0e3" fill-opacity=".5" font-family="ui-monospace,Menlo,Consolas,monospace" font-size="9" letter-spacing="1" text-anchor="middle">${r.count}</text>`);
  }
  const foot = `HEWN — MAP · ${graph.id.toUpperCase().replace("-", " ")} · ${laid.nodes.length} POINTS · ${graph.edges.length} EDGES${meta.commit ? ` · BUILT FROM ${meta.commit}` : ""}${meta.built ? ` ON ${meta.built}` : ""}`;
  out.push(`<circle cx="22" cy="${H - 18}" r="3" fill="#18dccb"/><text x="32" y="${H - 14}" fill="#f5f0e3" fill-opacity=".7" font-family="ui-monospace,Menlo,Consolas,monospace" font-size="10" letter-spacing="1.4">${esc(foot)}</text>`);
  out.push(`<text x="${W - 22}" y="${H - 14}" fill="#f5f0e3" fill-opacity=".45" font-family="ui-monospace,Menlo,Consolas,monospace" font-size="10" letter-spacing="1.4" text-anchor="end">PNWBNW.GITHUB.IO/HEWN</text>`);
  out.push("</svg>");
  return out.join("\n");
}
