// ---------------------------------------------------------------------------
// The viewer (docs/map/README.md): a laid-out graph drawn as glowing points
// in a dark field, lines between them coloured by what crosses, a legend of
// regions, labels, and a details panel for the point tapped. Everything it
// loads is next to it: three.js from ./vendor, the graphs from ./data.
// It keeps nothing: no storage, no cookies, no requests to any other host.
// ---------------------------------------------------------------------------

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";

const SOURCE = "https://github.com/PNWBNW/hewn/blob/main";
const REDUCED = matchMedia("(prefers-reduced-motion: reduce)").matches;

const $ = (id) => document.getElementById(id);
const el = (tag, attrs = {}, ...children) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) (k === "class" ? (e.className = v) : k.startsWith("on") ? e.addEventListener(k.slice(2), v) : e.setAttribute(k, v));
  for (const c of children) e.append(c);
  return e;
};

const meta = await (await fetch("./meta.json")).json();
// The address names the view and, after a colon, a point to open: #data-flow:d.vault
const [wanted, wantedNode] = location.hash.slice(1).split(":");
const view = meta.views.find((v) => v.id === wanted) ?? meta.views[0];
const graph = await (await fetch(`./data/${view.id}.json`)).json();
const CLASS_COLOUR = Object.fromEntries(Object.entries(graph.classes).map(([id, c]) => [id, c.colour]));
const BIG = graph.edges.length > 800;
// A dense graph is drawn quieter, or bloom turns it into one white cloud.
const LINE_OPACITY = BIG ? 0.07 : 0.3;
const LOBE_OPACITY = BIG ? 0.07 : 0.16;
/** Where a point's file lives on GitHub: Hewn's tree, or the submodule's at its pinned commit. */
function sourceUrl(n) {
  if (!n.path) return null;
  const sub = meta.submodule;
  if (sub && n.path.startsWith(`${sub.path}/`)) return `https://github.com/PNWBNW/${sub.path}/blob/${sub.commit}/${n.path.slice(sub.path.length + 1)}`;
  if (n.kind === "submodule") return `https://github.com/PNWBNW/${n.path}`;
  return `${SOURCE}/${n.path}`;
}

// ---- The data, indexed -----------------------------------------------------
const nodes = graph.nodes;
const byId = new Map(nodes.map((n, i) => [n.id, i]));
const regions = new Map(graph.regions.map((r) => [r.id, r]));
const edges = graph.edges.map((e) => ({ ...e, a: byId.get(e.from), b: byId.get(e.to) }));
const incident = nodes.map(() => []);
edges.forEach((e, i) => {
  incident[e.a].push(i);
  incident[e.b].push(i);
});
const maxDegree = Math.max(1, ...nodes.map((n) => n.degree));

// ---- State -----------------------------------------------------------------
let selected = -1;
let focus = null; // a region id
let labels = "regions";
let flowing = !REDUCED && !BIG;
const hiddenPoints = new Set(); // node kinds switched off
const hiddenLines = new Set(); // edge kinds switched off
const shown = (i) => !hiddenPoints.has(nodes[i].kind);
const edgeShown = (e) => !hiddenLines.has(e.kind) && shown(e.a) && shown(e.b);
let interacted = false;

// ---- Scene -----------------------------------------------------------------
const canvas = $("scene");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x04070d);
const camera = new THREE.PerspectiveCamera(50, 1, 1, 5000);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.autoRotate = !REDUCED;
controls.autoRotateSpeed = 0.35;
controls.addEventListener("start", () => {
  interacted = true;
  controls.autoRotate = false;
});

// Points: one glowing disc per node, sized by how connected it is.
const nodeCount = nodes.length;
const positions = new Float32Array(nodeCount * 3);
const colours = new Float32Array(nodeCount * 3);
const sizes = new Float32Array(nodeCount);
const dims = new Float32Array(nodeCount).fill(1);
nodes.forEach((n, i) => {
  positions.set([n.x, n.y, n.z], i * 3);
  const c = new THREE.Color(regions.get(n.region).colour);
  colours.set([c.r, c.g, c.b], i * 3);
  // A point's size is its connections, on a log scale: nothing pointing at it or from it, next to nothing;
  // one edge, a small point; the hubs everything flows through, planets (Joshua, 2026-11-03).
  sizes[i] = BIG ? 0.6 + 2.4 * Math.log2(1 + n.degree) : 1.5 + 2.6 * Math.log2(1 + n.degree);
});
const pointGeometry = new THREE.BufferGeometry();
pointGeometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
pointGeometry.setAttribute("colour", new THREE.BufferAttribute(colours, 3));
pointGeometry.setAttribute("size", new THREE.BufferAttribute(sizes, 1));
pointGeometry.setAttribute("dim", new THREE.BufferAttribute(dims, 1));
const pointMaterial = new THREE.ShaderMaterial({
  // `reach` is how far a point keeps its size: a dense graph is looked at from further away, so its
  // points shrink more slowly with distance, or every planet is a pixel at the overview.
  uniforms: { scale: { value: 1 }, reach: { value: BIG ? 560 : 240 } },
  vertexShader: `
    attribute vec3 colour; attribute float size; attribute float dim;
    varying vec3 vColour; varying float vDim; uniform float scale; uniform float reach;
    void main() {
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      gl_PointSize = size * scale * (reach / -mv.z);
      gl_Position = projectionMatrix * mv;
      vColour = colour; vDim = dim;
    }`,
  fragmentShader: `
    varying vec3 vColour; varying float vDim;
    void main() {
      float d = length(gl_PointCoord - 0.5);
      if (d > 0.5) discard;
      float halo = smoothstep(0.5, 0.12, d);
      float core = smoothstep(0.22, 0.0, d);
      vec3 c = vColour * (0.55 + 0.9 * core) + vec3(0.25) * core;
      gl_FragColor = vec4(c * vDim, (halo * 0.85 + core) * vDim);
    }`,
  transparent: true,
  depthWrite: false,
  // Additive glow for a small graph; a dense one would pile up to white, so it blends normally.
  blending: BIG ? THREE.NormalBlending : THREE.AdditiveBlending,
});
const points = new THREE.Points(pointGeometry, pointMaterial);
scene.add(points);

// Lines: one per edge, coloured by its class, dimmed when not in focus.
const linePositions = new Float32Array(edges.length * 6);
const lineColours = new Float32Array(edges.length * 6);
edges.forEach((e, i) => {
  linePositions.set([nodes[e.a].x, nodes[e.a].y, nodes[e.a].z, nodes[e.b].x, nodes[e.b].y, nodes[e.b].z], i * 6);
});
const lineGeometry = new THREE.BufferGeometry();
lineGeometry.setAttribute("position", new THREE.BufferAttribute(linePositions, 3));
lineGeometry.setAttribute("color", new THREE.BufferAttribute(lineColours, 3));
const lines = new THREE.LineSegments(lineGeometry, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: LINE_OPACITY, blending: THREE.AdditiveBlending, depthWrite: false }));
scene.add(lines);

// Flow: a few motes travelling along each edge, from its source to its target.
const PER_EDGE = 2;
const moteCount = edges.length * PER_EDGE;
const motePositions = new Float32Array(moteCount * 3);
const moteColours = new Float32Array(moteCount * 3);
const moteSizes = new Float32Array(moteCount).fill(1.3);
const moteDims = new Float32Array(moteCount).fill(1);
const moteT = new Float32Array(moteCount);
edges.forEach((e, i) => {
  const c = new THREE.Color(CLASS_COLOUR[e.class]);
  for (let k = 0; k < PER_EDGE; k++) {
    moteColours.set([c.r, c.g, c.b], (i * PER_EDGE + k) * 3);
    moteT[i * PER_EDGE + k] = (k + 0.37 * (i % 3)) / PER_EDGE;
  }
});
const moteGeometry = new THREE.BufferGeometry();
moteGeometry.setAttribute("position", new THREE.BufferAttribute(motePositions, 3));
moteGeometry.setAttribute("colour", new THREE.BufferAttribute(moteColours, 3));
moteGeometry.setAttribute("size", new THREE.BufferAttribute(moteSizes, 1));
moteGeometry.setAttribute("dim", new THREE.BufferAttribute(moteDims, 1));
const motes = new THREE.Points(moteGeometry, pointMaterial);
scene.add(motes);

// Lobes: a soft glow behind each region's points, so a region reads as a cloud.
const glowTexture = (() => {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const ctx = c.getContext("2d");
  const g = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
  g.addColorStop(0, "rgba(255,255,255,0.55)");
  g.addColorStop(0.35, "rgba(255,255,255,0.18)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
})();
const lobes = new Map();
for (const r of regions.values()) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture, color: r.colour, transparent: true, opacity: LOBE_OPACITY, depthWrite: false, blending: THREE.AdditiveBlending }));
  s.position.set(...r.at);
  s.scale.setScalar(r.radius * 3.2);
  s.renderOrder = -1;
  scene.add(s);
  lobes.set(r.id, s);
}

// Labels: sprites drawn from a canvas, in the same small uppercase as the chrome. They keep
// one size on screen whatever the distance (`px` tall), so the overview and a close look
// read the same.
let pxToWorld = 1; // world units per pixel at unit distance; set on resize
function labelSprite(text, { size = 22, colour = "#f5f0e3", sub = "", px = 13 } = {}) {
  const c = document.createElement("canvas");
  const ctx = c.getContext("2d");
  const font = `500 ${size}px ui-monospace, Menlo, Consolas, monospace`;
  ctx.font = font;
  ctx.letterSpacing = "0.12em";
  const w = Math.ceil(Math.max(ctx.measureText(text).width, sub ? ctx.measureText(sub).width * 0.8 : 0)) + 24;
  const h = sub ? size * 2.4 : size * 1.5;
  c.width = w * 2;
  c.height = h * 2;
  ctx.scale(2, 2);
  ctx.font = font;
  ctx.letterSpacing = "0.12em";
  ctx.textBaseline = "top";
  ctx.fillStyle = colour;
  ctx.fillText(text, 12, 2);
  if (sub) {
    ctx.font = `400 ${size * 0.8}px ui-monospace, Menlo, Consolas, monospace`;
    ctx.fillStyle = "rgba(245,240,227,0.55)";
    ctx.fillText(sub, 12, size * 1.3);
  }
  const texture = new THREE.CanvasTexture(c);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false, depthTest: false, sizeAttenuation: false }));
  sprite.userData.px = { w: (w / h) * px * (h / size), h: px * (h / size) };
  sprite.center.set(0.5, 0);
  sprite.renderOrder = 2;
  return sprite;
}
const allLabels = [];
function sizeLabels() {
  for (const s of allLabels) s.scale.set(s.userData.px.w * pxToWorld, s.userData.px.h * pxToWorld, 1);
}
const regionLabels = new Map();
for (const r of regions.values()) {
  const s = labelSprite(r.name.toUpperCase(), { size: 26, colour: r.colour, sub: `${r.count} ${r.count === 1 ? "point" : "points"}`, px: 12 });
  s.position.set(r.at[0], r.at[1] + r.radius * 0.9, r.at[2]);
  scene.add(s);
  regionLabels.set(r.id, s);
  allLabels.push(s);
}
// A point's label is drawn the first time it is shown (a big graph has more points than a phone wants textures for).
const nodeLabels = new Map();
function nodeLabel(i) {
  if (!nodeLabels.has(i)) {
    const n = nodes[i];
    const s = labelSprite(n.label, { size: 18, px: 11 });
    s.position.set(n.x, n.y + 2.5, n.z);
    scene.add(s);
    allLabels.push(s);
    sizeLabels();
    nodeLabels.set(i, s);
  }
  return nodeLabels.get(i);
}

// Bloom, so the points glow the way a lit thing does.
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), BIG ? 0.4 : 0.9, BIG ? 0.35 : 0.55, BIG ? 0.5 : 0.12);
composer.addPass(bloom);
composer.addPass(new OutputPass());

// ---- Fit and focus -----------------------------------------------------------
const bounds = new THREE.Box3().setFromBufferAttribute(pointGeometry.getAttribute("position"));
const centre = bounds.getCenter(new THREE.Vector3());
const radius = bounds.getBoundingSphere(new THREE.Sphere()).radius;
let flight = null;
function flyTo(target, distance, duration = 700) {
  const from = { pos: camera.position.clone(), target: controls.target.clone() };
  const dir = camera.position.clone().sub(controls.target);
  if (dir.lengthSq() < 1e-6) dir.set(0.35, 0.28, 1);
  dir.normalize();
  const to = { pos: target.clone().add(dir.multiplyScalar(distance)), target: target.clone() };
  if (REDUCED || duration === 0) {
    camera.position.copy(to.pos);
    controls.target.copy(to.target);
    return;
  }
  flight = { from, to, start: performance.now(), duration };
}
function fit(instant = false) {
  const vertical = radius / Math.sin((camera.fov * Math.PI) / 360);
  const aspect = innerWidth / innerHeight;
  const distance = Math.max(vertical, vertical / aspect) * 0.92;
  flyTo(centre, distance, instant ? 0 : 700);
}

// ---- Dimming: what's lit depends on the focus region and the selected point ----
function relight() {
  const lit = (i) => {
    const n = nodes[i];
    if (!shown(i)) return 0;
    const inRegion = !focus || n.region === focus;
    if (selected < 0) return inRegion ? 1 : 0.18;
    if (i === selected) return 1;
    const near = incident[selected].some((ei) => edgeShown(edges[ei]) && (edges[ei].a === i || edges[ei].b === i));
    return near ? 0.95 : inRegion ? 0.3 : 0.12;
  };
  for (let i = 0; i < nodeCount; i++) dims[i] = lit(i);
  pointGeometry.getAttribute("dim").needsUpdate = true;
  edges.forEach((e, i) => {
    const c = new THREE.Color(CLASS_COLOUR[e.class]);
    let k = 0.5;
    if (!edgeShown(e)) k = 0;
    else if (selected >= 0) k = e.a === selected || e.b === selected ? (BIG ? 4 : 1) : BIG ? 0.25 : 0.1;
    else if (focus) k = nodes[e.a].region === focus || nodes[e.b].region === focus ? (BIG ? 1.6 : 0.8) : 0.1;
    lineColours.set([c.r * k, c.g * k, c.b * k, c.r * k, c.g * k, c.b * k], i * 6);
    for (let m = 0; m < PER_EDGE; m++) moteDims[i * PER_EDGE + m] = k;
  });
  lineGeometry.getAttribute("color").needsUpdate = true;
  moteGeometry.getAttribute("dim").needsUpdate = true;
  // Which points carry a label: "All" means every point of the focused region, or the best-connected ones
  // of the whole map; a selected point and its neighbours always do.
  const hubs = BIG ? Math.max(3, Math.ceil(maxDegree * 0.35)) : 0;
  for (let i = 0; i < nodeCount; i++) {
    const n = nodes[i];
    const near = selected >= 0 && (i === selected || incident[selected].some((ei) => edgeShown(edges[ei]) && (edges[ei].a === i || edges[ei].b === i)));
    const wanted = shown(i) && (labels === "all" ? (focus ? n.region === focus : n.degree >= hubs) || near : near);
    if (!wanted && !nodeLabels.has(i)) continue;
    const s = nodeLabel(i);
    s.visible = wanted;
    s.material.opacity = i === selected ? 1 : 0.85;
  }
  for (const [id, s] of regionLabels) s.visible = labels !== "none" && (!focus || id === focus);
  for (const [id, s] of lobes) s.material.opacity = !focus || id === focus ? LOBE_OPACITY : LOBE_OPACITY / 4;
  // The legend counts what is shown.
  const visible = new Map();
  for (let i = 0; i < nodeCount; i++) if (shown(i)) visible.set(nodes[i].region, (visible.get(nodes[i].region) ?? 0) + 1);
  for (const b of $("regions").querySelectorAll("button")) {
    const r = regions.get(b.dataset.region);
    const v = visible.get(r.id) ?? 0;
    b.querySelector(".count").textContent = v === r.count ? String(r.count) : `${v} of ${r.count}`;
  }
}

// ---- Picking -----------------------------------------------------------------
const raycaster = new THREE.Raycaster();
raycaster.params.Points.threshold = 3.5;
let down = null;
canvas.addEventListener("pointerdown", (e) => (down = [e.clientX, e.clientY]));
canvas.addEventListener("pointerup", (e) => {
  if (!down) return;
  const moved = Math.hypot(e.clientX - down[0], e.clientY - down[1]);
  down = null;
  if (moved > 6) return;
  const ndc = new THREE.Vector2((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  const hits = raycaster.intersectObject(points).filter((h) => dims[h.index] > 0.2).sort((p, q) => p.distanceToRay - q.distanceToRay || p.distance - q.distance);
  select(hits.length ? hits[0].index : -1);
});
addEventListener("keydown", (e) => e.key === "Escape" && select(-1));

// ---- The chrome -----------------------------------------------------------------
function ruleLink(id) {
  const file = id.startsWith("T") ? "docs/THREAT_MODEL.md" : "docs/INVARIANTS.md";
  return el("a", { href: `${SOURCE}/${file}`, target: "_blank", rel: "noopener" }, id);
}
function select(i) {
  selected = i;
  relight();
  const panel = $("details");
  if (i < 0) {
    panel.hidden = true;
    return;
  }
  const n = nodes[i];
  const r = regions.get(n.region);
  $("d-region").textContent = r.name;
  $("d-region-dot").style.color = r.colour;
  $("d-kind").textContent = n.kind;
  $("d-label").textContent = n.label;
  $("d-holds").textContent = n.holds ?? "";
  const cls = graph.classes[n.class];
  $("d-class").textContent = cls.label;
  $("d-class").style.color = CLASS_COLOUR[n.class];
  $("d-class").title = cls.description;
  const url = sourceUrl(n);
  $("d-rules").replaceChildren(
    ...(n.rules ?? []).filter((id) => id !== n.id).map(ruleLink),
    ...(url ? [el("a", { href: url, target: "_blank", rel: "noopener" }, n.kind === "submodule" ? "open the repository" : "open on GitHub")] : []),
    ...(n.lines ? [el("span", { class: "muted" }, ` ${n.lines} lines`)] : []),
  );
  const list = $("d-edges");
  const listed = incident[i].filter((ei) => edgeShown(edges[ei])).slice(0, 80);
  list.replaceChildren(
    ...listed.map((ei) => {
      const e = edges[ei];
      const out = e.a === i;
      const other = out ? e.b : e.a;
      return el(
        "li",
        {},
        el("span", { class: "arrow" }, out ? "→" : "←"),
        el(
          "div",
          {},
          el("button", { onclick: () => select(other) }, nodes[other].label),
          el("div", { class: "what" }, e.what, " ", el("span", { class: "cls", style: `color:${CLASS_COLOUR[e.class]}` }, graph.classes[e.class].label)),
        ),
      );
    }),
    ...(incident[i].length > listed.length ? [el("li", { class: "more" }, `and ${incident[i].length - listed.length} more${hiddenLines.size || hiddenPoints.size ? ", some behind the filters" : ""}`)] : []),
  );
  panel.hidden = false;
  // Close enough to read the neighbours; on a phone the sheet covers the lower half, so aim a little below the point.
  const distance = r.radius * 3.4 + 70;
  const target = new THREE.Vector3(n.x, n.y - (innerWidth < 760 ? distance * 0.22 : 0), n.z);
  if (!REDUCED) flyTo(target, distance, 600);
}

function focusRegion(id) {
  focus = focus === id ? null : id;
  for (const b of $("regions").querySelectorAll("button")) b.classList.toggle("on", b.dataset.region === focus);
  select(-1);
  if (focus) {
    const r = regions.get(focus);
    flyTo(new THREE.Vector3(...r.at), r.radius * 3.2 + 40);
  } else fit();
}

$("title").textContent = graph.title;
$("description").textContent = graph.description;
$("crumb").textContent = `HEWN — MAP · ${view.id.replace("-", " ")} · ${nodes.length} points`;
document.title = `Hewn map · ${graph.title}`;
$("regions").replaceChildren(
  ...graph.regions.map((r) =>
    el(
      "li",
      {},
      el(
        "button",
        { "data-region": r.id, onclick: () => focusRegion(r.id), title: r.description },
        el("span", { class: "swatch", style: `color:${r.colour}` }),
        el("span", {}, r.name),
        el("span", { class: "count" }, String(r.count)),
      ),
    ),
  ),
);
$("classes").replaceChildren(
  ...Object.entries(graph.classes).map(([id, c]) => el("li", { title: c.description }, el("span", { class: "bar-swatch", style: `color:${CLASS_COLOUR[id]}` }), c.label)),
);
$("legend-toggle").addEventListener("click", () => {
  const legend = $("legend");
  const folded = legend.toggleAttribute("data-folded");
  $("legend-toggle").setAttribute("aria-expanded", String(!folded));
});
if (innerWidth < 760) $("legend").toggleAttribute("data-folded", true);
for (const b of document.querySelectorAll("[data-labels]")) {
  b.addEventListener("click", () => {
    labels = b.dataset.labels;
    for (const o of document.querySelectorAll("[data-labels]")) o.classList.toggle("on", o === b);
    relight();
  });
}
$("flow").classList.toggle("on", flowing);
$("flow").setAttribute("aria-pressed", String(flowing));
$("flow").addEventListener("click", () => {
  flowing = !flowing;
  motes.visible = flowing;
  $("flow").classList.toggle("on", flowing);
  $("flow").setAttribute("aria-pressed", String(flowing));
});
$("fit").addEventListener("click", () => {
  focus = null;
  for (const b of $("regions").querySelectorAll("button")) b.classList.remove("on");
  select(-1);
  fit();
});
$("close").addEventListener("click", () => select(-1));

// Filters: a chip per kind of point and per kind of line, with counts, built from this graph.
function chips(list, items, hidden, colourOf) {
  list.replaceChildren(
    ...items.map(([kind, count, colour]) =>
      el(
        "li",
        {},
        el(
          "button",
          {
            "data-kind": kind,
            "aria-pressed": String(!hidden.has(kind)),
            onclick: (ev) => {
              const b = ev.currentTarget;
              if (hidden.has(kind)) hidden.delete(kind);
              else hidden.add(kind);
              b.setAttribute("aria-pressed", String(!hidden.has(kind)));
              relight();
            },
          },
          el("span", { class: colourOf ? "bar-swatch" : "swatch", style: `color:${colour}` }),
          kind,
          el("span", { class: "count" }, String(count)),
        ),
      ),
    ),
  );
}
const pointKinds = [...nodes.reduce((m, n) => m.set(n.kind, (m.get(n.kind) ?? 0) + 1), new Map())].sort((p, q) => q[1] - p[1]).map(([k, c]) => [k, c, "#f5f0e3"]);
const lineKinds = [...edges.reduce((m, e) => m.set(e.kind, (m.get(e.kind) ?? 0) + 1), new Map())].sort((p, q) => q[1] - p[1]).map(([k, c]) => [k, c, CLASS_COLOUR[edges.find((e) => e.kind === k).class]]);
chips($("point-kinds"), pointKinds, hiddenPoints, false);
chips($("line-kinds"), lineKinds, hiddenLines, true);
for (const b of $("filters").querySelectorAll("[data-all],[data-none]")) {
  b.addEventListener("click", () => {
    const points = (b.dataset.all ?? b.dataset.none) === "points";
    const hidden = points ? hiddenPoints : hiddenLines;
    const kinds = (points ? pointKinds : lineKinds).map(([k]) => k);
    hidden.clear();
    if (b.dataset.none !== undefined) for (const k of kinds) hidden.add(k);
    for (const chip of (points ? $("point-kinds") : $("line-kinds")).querySelectorAll("button")) chip.setAttribute("aria-pressed", String(!hidden.has(chip.dataset.kind)));
    relight();
  });
}
$("filters-toggle").addEventListener("click", () => {
  const open = $("filters").hidden;
  $("filters").hidden = !open;
  $("filters-toggle").setAttribute("aria-expanded", String(open));
  $("filters-toggle").classList.toggle("on", open);
});
$("filters-close").addEventListener("click", () => $("filters-toggle").click());
if (meta.views.length > 1) {
  const pick = el("select", { "aria-label": "View", onchange: (e) => (location.hash = e.target.value) });
  for (const v of meta.views) pick.append(el("option", { value: v.id, ...(v.id === view.id ? { selected: "" } : {}) }, `View: ${v.id.replace("-", " ")}`));
  $("views").append(pick);
  $("views").hidden = false;
  addEventListener("hashchange", () => location.reload());
}
$("foot").replaceChildren(
  `built from ${meta.commit} on ${meta.built}${meta.submodule ? ` · ${meta.submodule.path} at ${meta.submodule.commit.slice(0, 12)}` : ""} · three ${meta.three} · `,
  el("a", { href: `${SOURCE}/docs/map/README.md`, target: "_blank", rel: "noopener" }, "how this is made"),
  " · ",
  el("a", { href: `${SOURCE}/docs/security/DATA_FLOW.md`, target: "_blank", rel: "noopener" }, "the written companion"),
);

// ---- Loop -----------------------------------------------------------------------
function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  composer.setSize(w, h);
  bloom.resolution.set(w / 2, h / 2);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  // A dense graph on a narrow screen piles its points and lines up; draw both fainter there.
  const narrow = BIG ? Math.min(1, w / 900) : 1;
  pointMaterial.uniforms.scale.value = renderer.getPixelRatio() * Math.min(1, h / 700) * narrow;
  lines.material.opacity = LINE_OPACITY * (BIG ? Math.max(0.4, narrow) : 1);
  pxToWorld = (2 * Math.tan((camera.fov * Math.PI) / 360)) / h;
  sizeLabels();
}
addEventListener("resize", resize);
resize();
fit(true);
motes.visible = flowing;
relight();
if (wantedNode && byId.has(wantedNode)) select(byId.get(wantedNode));

let last = performance.now();
renderer.setAnimationLoop((now) => {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (flight) {
    const t = Math.min(1, (now - flight.start) / flight.duration);
    const k = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
    camera.position.lerpVectors(flight.from.pos, flight.to.pos, k);
    controls.target.lerpVectors(flight.from.target, flight.to.target, k);
    if (t >= 1) flight = null;
  }
  if (flowing) {
    for (let i = 0; i < edges.length; i++) {
      const e = edges[i];
      for (let k = 0; k < PER_EDGE; k++) {
        const m = i * PER_EDGE + k;
        moteT[m] = (moteT[m] + dt * 0.22) % 1;
        const t = moteT[m];
        motePositions[m * 3] = nodes[e.a].x + (nodes[e.b].x - nodes[e.a].x) * t;
        motePositions[m * 3 + 1] = nodes[e.a].y + (nodes[e.b].y - nodes[e.a].y) * t;
        motePositions[m * 3 + 2] = nodes[e.a].z + (nodes[e.b].z - nodes[e.a].z) * t;
      }
    }
    moteGeometry.getAttribute("position").needsUpdate = true;
  }
  controls.update();
  composer.render();
});
