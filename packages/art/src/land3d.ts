// ---------------------------------------------------------------------------
// A worker's land, drawn: the three.js scene built from land.ts's data, and
// one render of it for a card. Browser only (WebGL); loaded only by the pages
// that show a land. The scene is deterministic as data (land.ts); the pixels
// may differ slightly between graphics chips, so a saved or printed card is
// rendered once and kept as an image.
// ---------------------------------------------------------------------------

import * as THREE from "three";
import { Water } from "three/addons/objects/Water.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { type Land, type Landmark, type LandmarkStatus, type Placed, LAND_SEASONS, LAND_SUNRISE, LAND_SUNSET, grassOf, groundColour, landIsDusk, landIsNight, landOf, landSkyAt, placeLandmarks, rocksOf, treesOf } from "./land";
import { mulberry, rng } from "./seed";
import type { Season } from "./sky";

const CYAN = 0x18dccb;

/** The render's size: twice the card's art window (372 by 408). */
export const RENDER = { w: 744, h: 816 } as const;

export type LandSceneInput = {
  name: string;
  hour: number;
  season: Season;
  /** Whole years on Hewn: the pine grows with them. */
  years: number;
  landmarks: readonly Landmark[];
};

function rippleNormals(): THREE.DataTexture {
  const N = 256;
  const hgt = new Float32Array(N * N);
  const wr = mulberry(77);
  const waves: [number, number, number, number][] = [];
  for (let i = 0; i < 14; i++) waves.push([Math.round((wr() - 0.5) * 12), Math.round((wr() - 0.5) * 12), wr() * 6.28, 1 / (1 + i * 0.4)]);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      let h = 0;
      for (const [a, b, ph, amp] of waves) h += amp * Math.sin((6.2832 * (a * x + b * y)) / N + ph);
      hgt[y * N + x] = h;
    }
  }
  const d = new Uint8Array(N * N * 4);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const hx = hgt[y * N + ((x + 1) % N)]! - hgt[y * N + ((x + N - 1) % N)]!;
      const hy = hgt[((y + 1) % N) * N + x]! - hgt[((y + N - 1) % N) * N + x]!;
      const v = new THREE.Vector3(-hx * 0.6, -hy * 0.6, 1).normalize();
      d.set([(v.x * 0.5 + 0.5) * 255, (v.y * 0.5 + 0.5) * 255, (v.z * 0.5 + 0.5) * 255, 255], (y * N + x) * 4);
    }
  }
  const t = new THREE.DataTexture(d, N, N);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.needsUpdate = true;
  return t;
}

const mat = (c: THREE.ColorRepresentation, opt: Partial<THREE.MeshStandardMaterialParameters> = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.85, ...opt });

const glowMat = (night: boolean, st: LandmarkStatus) =>
  new THREE.MeshStandardMaterial({
    color: st === "active" ? CYAN : 0x7a8a88,
    emissive: st === "active" ? CYAN : 0x000000,
    emissiveIntensity: st === "active" ? (night ? 2.6 : 0.9) : 0,
    roughness: 0.4,
  });

/** A revoked landmark fades to a ghost. */
function fade(group: THREE.Group, st: LandmarkStatus): THREE.Group {
  if (st !== "revoked") return group;
  group.traverse((m) => {
    if (m instanceof THREE.Mesh) {
      const mm = (m.material as THREE.MeshStandardMaterial).clone();
      mm.transparent = true;
      mm.opacity = 0.38;
      mm.emissiveIntensity = 0;
      m.material = mm;
      m.castShadow = false;
    }
  });
  return group;
}

function shadows(g: THREE.Group): THREE.Group {
  g.traverse((m) => {
    if (m instanceof THREE.Mesh) {
      m.castShadow = true;
      m.receiveShadow = true;
    }
  });
  return g;
}

function addLight(scene: THREE.Scene, night: boolean, st: LandmarkStatus, p: THREE.Vector3, dist: number) {
  if (night && st === "active") {
    const l = new THREE.PointLight(CYAN, 40, dist, 1.6);
    l.position.copy(p);
    scene.add(l);
  }
}

function cabinModel(st: LandmarkStatus, night: boolean, r: () => number): THREE.Group {
  const g = new THREE.Group();
  const L = 9;
  const W = 6;
  const Hh = 4.2;
  const logs = 7;
  const logR = Hh / logs / 2;
  const wood = mat(night ? 0x4a3322 : 0x8a6038);
  if (st === "pending") {
    const f = mat(0x9a6b42);
    for (const [x, z] of [[-L / 2, -W / 2], [L / 2, -W / 2], [-L / 2, W / 2], [L / 2, W / 2], [0, -W / 2], [0, W / 2]] as const) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.35, Hh, 0.35), f);
      p.position.set(x, Hh / 2, z);
      g.add(p);
    }
    for (const z of [-W / 2, W / 2]) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(L, 0.35, 0.35), f);
      b.position.set(0, Hh, z);
      g.add(b);
    }
    const ridge = new THREE.Mesh(new THREE.BoxGeometry(L + 1, 0.3, 0.3), f);
    ridge.position.set(0, Hh + 2.6, 0);
    g.add(ridge);
    return shadows(g);
  }
  for (let i = 0; i < logs; i++) {
    const y = logR + i * logR * 2;
    for (const z of [-W / 2, W / 2]) {
      const l = new THREE.Mesh(new THREE.CylinderGeometry(logR, logR, L + 0.8, 10).rotateZ(Math.PI / 2), wood);
      l.position.set(0, y, z);
      g.add(l);
    }
    for (const x of [-L / 2, L / 2]) {
      const l = new THREE.Mesh(new THREE.CylinderGeometry(logR, logR, W + 0.8, 10).rotateX(Math.PI / 2), wood);
      l.position.set(x, y + logR * 0.5, 0);
      g.add(l);
    }
  }
  const fill = new THREE.Mesh(new THREE.BoxGeometry(L - 0.2, Hh, W - 0.2), wood);
  fill.position.y = Hh / 2;
  g.add(fill);
  const pitch = 2.8 + r() * 0.8;
  const roofM = mat(night ? 0x2c2622 : 0x4f4640, { roughness: 0.95 });
  const half = Math.hypot(W / 2 + 0.8, pitch);
  for (const s of [-1, 1]) {
    const rf = new THREE.Mesh(new THREE.BoxGeometry(L + 1.6, 0.3, half), roofM);
    rf.position.set(0, Hh + pitch / 2, s * (W / 4 + 0.2));
    rf.rotation.x = s * Math.atan2(pitch, W / 2 + 0.8);
    g.add(rf);
  }
  const gable = new THREE.Shape([new THREE.Vector2(-W / 2, 0), new THREE.Vector2(W / 2, 0), new THREE.Vector2(0, pitch)]);
  for (const x of [-L / 2, L / 2]) {
    const gm = new THREE.Mesh(new THREE.ShapeGeometry(gable), wood.clone());
    gm.rotation.y = Math.PI / 2;
    gm.position.set(x + (x > 0 ? 0.01 : -0.01), Hh, 0);
    (gm.material as THREE.MeshStandardMaterial).side = THREE.DoubleSide;
    g.add(gm);
  }
  const ch = new THREE.Mesh(new THREE.BoxGeometry(0.9, 2.6, 0.9), mat(0x6f6a62));
  ch.position.set(L * 0.28, Hh + pitch * 0.7, -W * 0.15);
  g.add(ch);
  const win = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 1.2), glowMat(night, st));
  win.position.set(-L * 0.22, Hh * 0.55, W / 2 + logR + 0.02);
  g.add(win);
  const win2 = win.clone();
  win2.position.x = L * 0.25;
  g.add(win2);
  const door = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 2.4), mat(0x231710));
  door.position.set(L * 0.02, 1.2, W / 2 + logR + 0.02);
  g.add(door);
  return fade(shadows(g), st);
}

function lookoutModel(st: LandmarkStatus, night: boolean, r: () => number): THREE.Group {
  const g = new THREE.Group();
  const h = 15 + r() * 4;
  const b = 3.2;
  const t = 1.8;
  const wood = mat(night ? 0x2b1e15 : 0x4a3324);
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
    const a = new THREE.Vector3(sx * b, 0, sz * b);
    const c = new THREE.Vector3(sx * t, h, sz * t);
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, a.distanceTo(c), 6), wood);
    m.position.copy(a.clone().add(c).multiplyScalar(0.5));
    m.lookAt(c);
    m.rotateX(Math.PI / 2);
    g.add(m);
  }
  for (let i = 0; i < 4; i++) {
    const y0 = (i * h) / 4;
    const y1 = ((i + 1) * h) / 4;
    const w0 = b - ((b - t) * i) / 4;
    const w1 = b - ((b - t) * (i + 1)) / 4;
    for (const s of [-1, 1]) {
      for (const [p, q] of [
        [new THREE.Vector3(-w0, y0, s * w0), new THREE.Vector3(w1, y1, s * w1)],
        [new THREE.Vector3(s * w0, y0, -w0), new THREE.Vector3(s * w1, y1, w1)],
      ] as const) {
        const m = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, p.distanceTo(q), 4), wood);
        m.position.copy(p.clone().add(q).multiplyScalar(0.5));
        m.lookAt(q);
        m.rotateX(Math.PI / 2);
        g.add(m);
      }
    }
  }
  if (st !== "pending") {
    const deck = new THREE.Mesh(new THREE.BoxGeometry(5.2, 0.25, 5.2), wood);
    deck.position.y = h;
    g.add(deck);
    const cab = new THREE.Mesh(new THREE.BoxGeometry(3.6, 1.2, 3.6), mat(night ? 0x3a2818 : 0x6b4a2e));
    cab.position.y = h + 0.75;
    g.add(cab);
    const band = new THREE.Mesh(new THREE.BoxGeometry(3.66, 1.1, 3.66), glowMat(night, st));
    band.position.y = h + 1.85;
    g.add(band);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(3.4, 1.6, 4).rotateY(Math.PI / 4), mat(0x22170f));
    roof.position.y = h + 3.2;
    g.add(roof);
  }
  return fade(shadows(g), st);
}

function bridgeModel(st: LandmarkStatus, night: boolean, span: number): THREE.Group {
  const g = new THREE.Group();
  const wood = mat(night ? 0x2b1e15 : 0x5b3b22);
  const stone = mat(0x77716a);
  const Wd = 2.6;
  for (const s of [-1, 1]) {
    const ab = new THREE.Mesh(new THREE.BoxGeometry(2.4, 2.2, Wd + 1), stone);
    ab.position.set(s * (span / 2 + 0.8), 0.4, 0);
    g.add(ab);
  }
  const deck = new THREE.Mesh(new THREE.BoxGeometry(span + 3, 0.35, Wd), wood);
  deck.position.y = 1.6;
  g.add(deck);
  if (st !== "pending") {
    const rise = span * 0.22;
    for (const z of [-Wd / 2, Wd / 2]) {
      const curve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(-span / 2, 0.6, z), new THREE.Vector3(0, 1.6 + rise * 2, z), new THREE.Vector3(span / 2, 0.6, z));
      g.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 24, 0.22, 6), wood));
      const rail = new THREE.Mesh(new THREE.BoxGeometry(span + 3, 0.14, 0.14), wood);
      rail.position.set(0, 2.7, z);
      g.add(rail);
      for (let i = 0; i <= 8; i++) {
        const x = -span / 2 - 1.5 + (i * (span + 3)) / 8;
        const p = new THREE.Mesh(new THREE.BoxGeometry(0.14, 1.1, 0.14), wood);
        p.position.set(x, 2.15, z);
        g.add(p);
      }
    }
    for (const s of [-1, 1]) {
      for (const z of [-Wd / 2, Wd / 2]) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.22, 2.2, 0.22), wood);
        post.position.set(s * (span / 2 + 1.4), 2.6, z);
        g.add(post);
        const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.32, 12, 8), glowMat(night, st));
        lamp.position.set(s * (span / 2 + 1.4), 3.85, z);
        g.add(lamp);
      }
    }
  }
  return fade(shadows(g), st);
}

function cairnModel(st: LandmarkStatus, night: boolean, r: () => number): THREE.Group {
  const g = new THREE.Group();
  let y = 0;
  const n = 5;
  for (let i = 0; i < n; i++) {
    const s = 1.5 - i * 0.24;
    const top = i === n - 1;
    if (top && st === "pending") break;
    const m = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 10), top ? glowMat(night, st) : mat(new THREE.Color().setHSL(0.08, 0.06, 0.38 + r() * 0.14), { roughness: 0.95 }));
    m.scale.set(s * (1 + r() * 0.2), s * 0.42, s);
    m.position.set((r() - 0.5) * 0.2, y + s * 0.4, (r() - 0.5) * 0.2);
    m.rotation.y = r() * 3;
    g.add(m);
    y += s * 0.72;
  }
  return fade(shadows(g), st);
}

function pineModel(h: number, night: boolean): THREE.Group {
  const g = new THREE.Group();
  const m = new THREE.MeshStandardMaterial({ color: 0x14b8aa, emissive: CYAN, emissiveIntensity: night ? 0.22 : 0.12, roughness: 0.6, flatShading: true });
  const t = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.45, h * 0.14, 7), mat(0x3a2a1e));
  t.position.y = h * 0.07;
  g.add(t);
  for (let k = 0; k < 6; k++) {
    const r = h * 0.22 * (1 - k * 0.13);
    const hh = h * 0.26 * (1 - k * 0.06);
    const c = new THREE.Mesh(new THREE.ConeGeometry(r, hh, 10), m);
    c.position.y = h * 0.12 + k * h * 0.135 + hh / 2;
    g.add(c);
  }
  g.traverse((o) => {
    if (o instanceof THREE.Mesh) o.castShadow = true;
  });
  return g;
}

const SKY_VERT = "varying vec3 v;void main(){v=normalize(position);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}";
const SKY_FRAG =
  "uniform vec3 top,hor,sun;uniform float night,dusk;varying vec3 v;void main(){vec3 n=normalize(v);float t=pow(clamp(n.y,0.,1.),0.55);vec3 c=mix(hor,top,t);float s=max(dot(n,sun),0.);float dd=length(n-sun);" +
  "vec3 sc=mix(vec3(1.,.97,.86),vec3(1.,.78,.45),dusk);if(night<.5){c+=sc*pow(s,8.)*.28+sc*exp(-dd*dd*400.)*.6;c=mix(c,sc*1.6,smoothstep(.034,.028,dd));}else{c+=vec3(.55,.62,.8)*exp(-dd*dd*90.)*.10;" +
  "float md=smoothstep(.017,.014,dd);vec3 mc=vec3(.93,.92,.86)*(0.93+0.07*sin(n.x*260.+n.y*190.));c=mix(c,mc,md);}gl_FragColor=vec4(c,1.);}";

export type LandScene = {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  land: Land;
  placed: Placed[];
  night: boolean;
  dusk: boolean;
  /** For the skyline mask: the sky dome and the stars, hidden then. */
  skyObjects: THREE.Object3D[];
  dispose: () => void;
};

/** The scene for a land, ready to render. */
export function buildLandScene(input: LandSceneInput, ripples: THREE.DataTexture = rippleNormals()): LandScene {
  const land = landOf(input.name);
  const { H, riverX, riverW, G } = land;
  const S = LAND_SEASONS[input.season];
  const night = landIsNight(input.hour);
  const dusk = landIsDusk(input.hour);
  const scene = new THREE.Scene();
  const [top, hor] = landSkyAt(input.hour);
  const horC = new THREE.Color(...hor);
  const topC = new THREE.Color(...top);
  scene.fog = new THREE.FogExp2(horC.clone().lerp(topC, 0.25), night ? 0.0004 : 0.00052);
  const skyObjects: THREE.Object3D[] = [];
  // The sky dome, with the sun or the moon.
  const sunAlt = night ? 0.3 : Math.sin((Math.PI * (input.hour - LAND_SUNRISE)) / (LAND_SUNSET - LAND_SUNRISE)) * 0.9;
  const sunAz = night ? 0.13 : (1 - (input.hour - LAND_SUNRISE) / (LAND_SUNSET - LAND_SUNRISE)) * Math.PI - Math.PI / 2;
  const sunDir = new THREE.Vector3(Math.sin(sunAz) * Math.cos(Math.asin(Math.max(0.04, sunAlt))), Math.max(0.04, sunAlt), -Math.cos(sunAz) * 0.9).normalize();
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    fog: false,
    depthWrite: false,
    uniforms: { top: { value: topC }, hor: { value: horC }, sun: { value: sunDir }, night: { value: night ? 1 : 0 }, dusk: { value: dusk ? 1 : 0 } },
    vertexShader: SKY_VERT,
    fragmentShader: SKY_FRAG,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(2500, 48, 24), skyMat);
  scene.add(sky);
  skyObjects.push(sky);
  if (night) {
    const sr = mulberry(5);
    const pos: number[] = [];
    for (let i = 0; i < 1800; i++) {
      const a = sr() * Math.PI * 2;
      const y = 0.08 + sr() * 0.92;
      const r = Math.sqrt(1 - y * y);
      pos.push(Math.cos(a) * r * 2400, y * 2400, Math.sin(a) * r * 2400);
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    const stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xf2efe4, size: 1.6, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.85 }));
    scene.add(stars);
    skyObjects.push(stars);
  }
  // Light.
  const sun = new THREE.DirectionalLight(night ? 0x9db4d8 : dusk ? 0xffc28a : 0xfff2dc, night ? 0.8 : dusk ? 2.2 : 3.0);
  sun.position.copy(sunDir).multiplyScalar(600);
  sun.target.position.set(0, 0, -260);
  scene.add(sun, sun.target);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -360, right: 360, top: 360, bottom: -360, near: 10, far: 2200 });
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.6;
  scene.add(new THREE.HemisphereLight(night ? 0x1d2c44 : topC.clone().lerp(new THREE.Color(1, 1, 1), 0.3), night ? 0x10201a : 0x3a4a2e, night ? 0.7 : 1.0));
  // Terrain.
  const geo = new THREE.PlaneGeometry(1800, 1500, 420, 360);
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, 0, -650);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) pos.setY(i, H(pos.getX(i), pos.getZ(i)));
  geo.computeVertexNormals();
  const nor = geo.attributes.normal as THREE.BufferAttribute;
  const cols = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) cols.set(groundColour(land, input.season, pos.getX(i), pos.getY(i), pos.getZ(i), nor.getY(i)), i * 3);
  geo.setAttribute("color", new THREE.BufferAttribute(cols, 3));
  const terrain = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.96, metalness: 0 }));
  terrain.receiveShadow = true;
  terrain.castShadow = true;
  scene.add(terrain);
  // The river's water, reflecting the sky.
  const water = new Water(new THREE.PlaneGeometry(2000, 1500, 1, 1), {
    textureWidth: 768,
    textureHeight: 768,
    waterNormals: ripples,
    sunDirection: sunDir.clone(),
    sunColor: night ? 0x8090a8 : dusk ? 0xffc890 : 0xfff4e0,
    waterColor: night ? 0x061018 : input.season === "winter" ? 0x55656e : 0x1f3a40,
    distortionScale: 0.35,
    fog: true,
    eye: new THREE.Vector3(0, 20, 30),
  });
  water.rotation.x = -Math.PI / 2;
  water.position.set(0, -2.2, -700);
  water.material.uniforms.size!.value = 9;
  water.material.uniforms.time!.value = 3.7;
  scene.add(water);
  // The pine and the landmarks, then everything placed around them.
  const placed = placeLandmarks(land, input.landmarks);
  for (const p of placed) {
    const lr = rng((p.lm ? p.lm.seed : "pine") + ":model");
    const y = H(p.x, p.z);
    if (p.kind === "pine") {
      const pine = pineModel(9 + input.years * 1.6, night);
      pine.position.set(p.x, y, p.z);
      scene.add(pine);
      if (night) {
        const l = new THREE.PointLight(CYAN, 14, 34, 1.6);
        l.position.set(p.x, 7, p.z + 6);
        scene.add(l);
      }
    } else if (p.kind === "cabin" && p.lm) {
      const m = cabinModel(p.lm.status, night, lr);
      m.scale.setScalar(1.35);
      m.position.set(p.x, y + 0.1, p.z);
      m.rotation.y = p.rot ?? 0;
      scene.add(m);
      addLight(scene, night, p.lm.status, new THREE.Vector3(p.x, 4, p.z + 6), 45);
    } else if (p.kind === "bridge" && p.lm) {
      const m = bridgeModel(p.lm.status, night, riverW(p.z) * 2 + 5);
      m.position.set(p.x, 0, p.z);
      m.rotation.y = 0.1;
      scene.add(m);
      addLight(scene, night, p.lm.status, new THREE.Vector3(p.x, 5, p.z), 50);
    } else if (p.kind === "cairn" && p.lm) {
      const m = cairnModel(p.lm.status, night, lr);
      m.scale.setScalar(1.6);
      m.position.set(p.x, y, p.z);
      scene.add(m);
      addLight(scene, night, p.lm.status, new THREE.Vector3(p.x, 4, p.z + 2), 22);
    } else if (p.kind === "lookout" && p.lm) {
      const m = lookoutModel(p.lm.status, night, lr);
      m.scale.setScalar(2.2);
      m.position.set(p.x, y - 0.3, p.z);
      scene.add(m);
      addLight(scene, night, p.lm.status, new THREE.Vector3(p.x, y + 28, p.z), 90);
    }
  }
  // Rocks.
  const rocks = rocksOf(land, placed);
  const rk = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), new THREE.MeshStandardMaterial({ color: input.season === "winter" ? 0xc9d2d8 : 0x7d776e, roughness: 0.95, flatShading: true }), Math.max(1, rocks.length));
  rocks.forEach((r, i) => {
    rk.setMatrixAt(i, new THREE.Matrix4().compose(new THREE.Vector3(r.x, r.y, r.z), new THREE.Quaternion().setFromEuler(new THREE.Euler(r.rx, r.ry, r.rz)), new THREE.Vector3(r.scale * r.sx, r.scale * 0.6, r.scale)));
  });
  rk.count = rocks.length;
  rk.castShadow = true;
  rk.receiveShadow = true;
  scene.add(rk);
  // Grass.
  const blades = grassOf(land, input.season);
  if (blades.length) {
    const gm = new THREE.InstancedMesh(new THREE.ConeGeometry(0.06, 1, 3).translate(0, 0.5, 0), new THREE.MeshStandardMaterial({ roughness: 0.9 }), blades.length);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const c = new THREE.Color();
    blades.forEach((b, i) => {
      q.setFromEuler(new THREE.Euler(b.rx, b.ry, b.rz));
      m.compose(new THREE.Vector3(b.x, b.y, b.z), q, new THREE.Vector3(1 + b.d * 0.016, b.h, 1 + b.d * 0.016));
      gm.setMatrixAt(i, m);
      gm.setColorAt(i, c.setRGB(...b.colour));
    });
    gm.receiveShadow = true;
    scene.add(gm);
  }
  // Trees: three shapes, thousands of instances.
  const tg: THREE.BufferGeometry[] = [new THREE.CylinderGeometry(0.16, 0.24, 2.0, 6).translate(0, 1.0, 0)];
  for (let k = 0; k < 7; k++) {
    const r = 2.1 * (1 - k / 7.6);
    const h = 2.6 - k * 0.16;
    tg.push(new THREE.ConeGeometry(r, h, 9).rotateY(k * 0.7).translate(0, 1.4 + k * 1.18 + h / 2, 0));
  }
  const fg: THREE.BufferGeometry[] = [new THREE.CylinderGeometry(0.2, 0.3, 2.0, 6).translate(0, 1.0, 0)];
  for (let k = 0; k < 5; k++) {
    const r = 2.9 * (1 - k / 5.6);
    const h = 2.8 - k * 0.2;
    fg.push(new THREE.ConeGeometry(r, h, 9).rotateY(k * 0.9).translate(0, 1.6 + k * 1.45 + h / 2, 0));
  }
  const bg: THREE.BufferGeometry[] = [new THREE.CylinderGeometry(0.16, 0.24, 3.4, 6).translate(0, 1.7, 0)];
  for (const [x, y, z, r] of [[0, 5.2, 0, 2.0], [0.9, 4.3, 0.4, 1.4], [-0.8, 4.5, -0.3, 1.5], [0.1, 6.4, 0.2, 1.3]] as const) bg.push(new THREE.IcosahedronGeometry(r, 1).translate(x, y, z));
  const shapes = [tg, fg, bg].map((list) => mergeGeometries(list.map((g) => g.toNonIndexed())));
  const trees = treesOf(land, input.season, placed);
  const m4 = new THREE.Matrix4();
  const col = new THREE.Color();
  for (const kind of [0, 1, 2] as const) {
    const list = trees.filter((t) => t.kind === kind);
    if (!list.length) continue;
    const im = new THREE.InstancedMesh(shapes[kind]!, new THREE.MeshStandardMaterial({ roughness: 0.9, flatShading: true }), list.length);
    im.castShadow = true;
    im.receiveShadow = true;
    list.forEach((t, i) => {
      m4.compose(new THREE.Vector3(t.x, t.y - 0.2, t.z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), t.rot), new THREE.Vector3(t.scale, t.scale * (0.9 + t.v * 0.5), t.scale));
      im.setMatrixAt(i, m4);
      let c: [number, number, number] = [S.tree[0] * (0.75 + t.v * 0.6), S.tree[1] * (0.75 + t.v * 0.6), S.tree[2] * (0.75 + t.v * 0.6)];
      if (kind === 1) c = [c[0] * 0.92, c[1] * 0.92, c[2] * 1.15];
      if (kind === 2) {
        const leaf: [number, number, number] = input.season === "autumn" ? (t.v < 0.5 ? [0.85, 0.62, 0.16] : t.v < 0.8 ? [0.8, 0.38, 0.12] : [0.62, 0.55, 0.2]) : input.season === "spring" ? [0.42, 0.62, 0.28] : [0.24, 0.42, 0.18];
        c = input.season === "autumn" ? leaf : [leaf[0] * (0.85 + t.v * 0.3), leaf[1] * (0.85 + t.v * 0.3), leaf[2] * (0.85 + t.v * 0.3)];
      }
      if (input.season === "winter") c = [c[0] + 0.06, c[1] + 0.06, c[2] + 0.06];
      im.setColorAt(i, col.setRGB(...c));
    });
    scene.add(im);
  }
  const camera = new THREE.PerspectiveCamera(38, RENDER.w / RENDER.h, 1, 5000);
  camera.position.set(0, H(0, 30) + 19, 30);
  camera.lookAt(0, H(0, 30) + 19 + 34, -600);
  const dispose = () => {
    scene.traverse((o) => {
      if (o instanceof THREE.Mesh || o instanceof THREE.Points) o.geometry.dispose();
    });
    void G;
  };
  return { scene, camera, land, placed, night, dusk, skyObjects, dispose };
}

export type LandRender = {
  /** The picture, as a PNG data URI, twice the art window's size. */
  dataUrl: string;
  /** The lowest sky pixel per card column (0 to 399, in card units), so the constellation stays in the sky. */
  skyline: number[];
  night: boolean;
  dusk: boolean;
  placed: Placed[];
};

/** One render of a land for a card: the picture with bloom, then a mask render for the skyline. */
export function renderLand(input: LandSceneInput, canvas?: HTMLCanvasElement): LandRender {
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, canvas });
  renderer.setPixelRatio(1);
  renderer.setSize(RENDER.w, RENDER.h, false);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const built = buildLandScene(input);
  const { scene, camera, night } = built;
  const comp = new EffectComposer(renderer);
  comp.addPass(new RenderPass(scene, camera));
  comp.addPass(new UnrealBloomPass(new THREE.Vector2(RENDER.w, RENDER.h), night ? 0.95 : 0.18, 0.5, night ? 0.55 : 0.9));
  comp.addPass(new OutputPass());
  renderer.toneMappingExposure = night ? 1.1 : 1.0;
  comp.render();
  const dataUrl = renderer.domElement.toDataURL("image/png");
  // The skyline from a mask render: everything white on black but the sky.
  const rt = new THREE.WebGLRenderTarget(RENDER.w, RENDER.h);
  scene.overrideMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff });
  scene.background = new THREE.Color(0);
  const fog = scene.fog;
  scene.fog = null;
  for (const o of built.skyObjects) o.visible = false;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.setRenderTarget(rt);
  renderer.render(scene, camera);
  const px = new Uint8Array(RENDER.w * RENDER.h * 4);
  renderer.readRenderTargetPixels(rt, 0, 0, RENDER.w, RENDER.h, px);
  renderer.setRenderTarget(null);
  scene.fog = fog;
  scene.overrideMaterial = null;
  const skyline = new Array<number>(400).fill(480);
  for (let cx = 0; cx < 372; cx++) {
    const X = Math.round(cx * 2);
    for (let y = RENDER.h - 1; y >= 0; y--) {
      if (px[(y * RENDER.w + X) * 4]! > 128) skyline[cx + 14] = Math.min(skyline[cx + 14]!, 72 + (RENDER.h - 1 - y) / 2);
    }
  }
  rt.dispose();
  comp.dispose();
  built.dispose();
  renderer.dispose();
  return { dataUrl, skyline, night, dusk: built.dusk, placed: built.placed };
}
