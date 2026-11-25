import * as THREE from 'three';

/**
 * The tomb scarab. Like the jungle snake (gameplay/hazards/snakes/SnakeView.ts), its detail lives in painted textures over
 * smooth, densely tessellated forms rather than in geometry: a single lacquered ruby dome for the wing cases,
 * its gold seam and gold lower rim painted in (and raised with a bump map), faint grooves along the ruby, and a
 * dark underside; a smooth dark-bronze thorax; a flat, shovel-like head. The body
 * sits low enough that its legs are hidden. For flight the wing cases are two halves split along the seam,
 * hinged at the front so they can lift and spread, and under them fold a pair of smoky, veined membrane
 * hind wings (buildWingGeometry, the 'wing' material).
 *
 * Built at unit body length facing +x, its underside resting on y = 0, centred on z = 0.
 */

export type ScarabMaterialKey = 'shell' | 'lacquer' | 'shadow' | 'wing';

export interface ScarabPart {
  readonly geometry: THREE.BufferGeometry;
  readonly material: ScarabMaterialKey;
  /** A wing case: -1 the half on -z, 1 the half on +z. Built relative to ELYTRON_HINGE. */
  readonly elytron?: -1 | 1;
}

/** Where the wing cases hinge, at the front of the seam (they lift and spread about here to fly). */
export const ELYTRON_HINGE = new THREE.Vector3(0.17, 0.34, 0);

/** Where each hind wing's root sits (z mirrored for the -z wing), tucked under the front of the wing cases. */
export const WING_ROOT = new THREE.Vector3(0.1, 0.3, 0.07);

/** Splits a geometry into its -z and +z halves along z = 0 (the wing cases' seam lies exactly on it). */
function splitAlongSeam(geo: THREE.BufferGeometry): [THREE.BufferGeometry, THREE.BufferGeometry] {
  const flat = geo.index ? geo.toNonIndexed() : geo;
  const names = ['position', 'normal', 'uv'] as const;
  const halves: THREE.BufferGeometry[] = [];
  for (const side of [-1, 1]) {
    const pos = flat.attributes.position as THREE.BufferAttribute;
    const keep: number[] = [];
    for (let t = 0; t < pos.count; t += 3) {
      const cz = pos.getZ(t) + pos.getZ(t + 1) + pos.getZ(t + 2);
      if (cz * side >= 0) keep.push(t);
    }
    const half = new THREE.BufferGeometry();
    for (const name of names) {
      const src = flat.attributes[name] as THREE.BufferAttribute;
      const out = new Float32Array(keep.length * 3 * src.itemSize);
      let o = 0;
      for (const t of keep)
        for (let v = 0; v < 3; v++)
          for (let c = 0; c < src.itemSize; c++) out[o++] = src.array[(t + v) * src.itemSize + c];
      half.setAttribute(name, new THREE.BufferAttribute(out, src.itemSize));
    }
    half.translate(-ELYTRON_HINGE.x, -ELYTRON_HINGE.y, -ELYTRON_HINGE.z);
    halves.push(half);
  }
  return [halves[0], halves[1]];
}

/**
 * Shape options. Set either to false to go back to the plainer shape it replaced.
 * - `toothedHead`: the sacred scarab's fan-shaped face shield, with six short teeth along its front edge
 *   (off: a smooth rounded lip tucked under the thorax).
 * - `waistedThorax`: a thorax broader than the wing cases, with a pinched waist where they meet and the
 *   wing cases swelling out to shoulders behind it (off: thorax and wing cases the same width, blending).
 */
export const SCARAB_SHAPE = { toothedHead: true, waistedThorax: true } as const;

const V = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);

/** Polar angle (from the top, as a fraction of pi) of the wing cases' gold lower rim. */
const RIM = 0.63;

/**
 * An ellipsoid; `square` below 1 squares off its footprint (x and z) into a smooth rounded oblong, the
 * parallel-sided shape of a scarab's wing cases, while keeping its profile round.
 */
function ellipsoid(c: THREE.Vector3, r: THREE.Vector3, w = 64, h = 40, square = 1): THREE.BufferGeometry {
  const geo = new THREE.SphereGeometry(1, w, h);
  if (square !== 1) {
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const f = (n: number): number => Math.sign(n) * Math.abs(n) ** square;
    for (let i = 0; i < pos.count; i++) pos.setXYZ(i, f(pos.getX(i)), pos.getY(i), f(pos.getZ(i)));
    geo.computeVertexNormals();
  }
  geo.scale(r.x, r.y, r.z);
  geo.translate(c.x, c.y, c.z);
  return geo;
}

/**
 * Narrows the front of the wing cases (the shell's x from `cx` to `cx + rx`) into a waist where they meet the
 * thorax, so they swell out to rounded shoulders just behind it.
 */
function pinchFront(geo: THREE.BufferGeometry, cx: number, rx: number): void {
  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const t = (pos.getX(i) - cx) / rx; // -1 tail .. 1 front
    const k = 1 - 0.16 * smoothstep(0.45, 1, t);
    pos.setZ(i, pos.getZ(i) * k);
    pos.setY(i, 0.2 + (pos.getY(i) - 0.2) * (1 - 0.06 * smoothstep(0.45, 1, t)));
  }
  geo.computeVertexNormals();
}

/**
 * A flattened unit disc-like ellipsoid whose front edge carries six short, rounded teeth (the sacred
 * scarab's raking face shield). Teeth fade out towards the sides.
 */
function toothedFan(): THREE.BufferGeometry {
  const geo = new THREE.SphereGeometry(1, 96, 16);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const r = Math.hypot(x, z);
    if (r < 1e-6) continue;
    const a = Math.atan2(z, x);
    // Six peaks across the front half: at +-15, +-45 and +-75 degrees.
    const tooth = Math.pow(Math.abs(Math.sin(a * 6)), 4) * smoothstep(0.2, 0.6, Math.cos(a));
    const k = 1 + 0.14 * tooth;
    pos.setX(i, x * k);
    pos.setZ(i, z * k);
  }
  geo.computeVertexNormals();
  return geo;
}

export function buildScarabParts(): ScarabPart[] {
  const parts: ScarabPart[] = [];

  const waisted = SCARAB_SHAPE.waistedThorax;
  // Wing cases: one broad, low dome over the back two thirds, deep enough at the sides to hide the legs.
  const shell = ellipsoid(V(-0.1, 0.2, 0), V(0.37, 0.21, 0.3), 72, 44, 0.82);
  if (waisted) pinchFront(shell, -0.1, 0.37);
  // Split along the seam into the two wing cases, each hinged at the front for flight.
  const [caseL, caseR] = splitAlongSeam(shell);
  parts.push({ geometry: caseL, material: 'shell', elytron: -1 }, { geometry: caseR, material: 'shell', elytron: 1 });

  // Thorax: a wide, rounded shield, flowing into the wing cases (broader than them, when waisted).
  const thC = waisted ? V(0.2, 0.16, 0) : V(0.19, 0.17, 0);
  const thR = waisted ? V(0.17, 0.15, 0.33) : V(0.16, 0.17, 0.29);
  // Tipped nose-down so its front slopes into the head and the profile reads as one arch.
  const thorax = ellipsoid(V(0, 0, 0), thR, 56, 32, 0.9);
  thorax.rotateZ(-0.32);
  thorax.translate(thC.x, thC.y, thC.z);
  parts.push({ geometry: thorax, material: 'lacquer' });

  // Head: a short, rounded lip tucked under the front of the thorax, following its slope down...
  const head = ellipsoid(V(0, 0, 0), V(0.075, 0.065, 0.17), 48, 24, 0.9);
  head.rotateZ(-0.35);
  head.translate(waisted ? 0.32 : 0.3, 0.07, 0);
  parts.push({ geometry: head, material: 'lacquer' });
  // ...fanning out into the toothed face shield.
  if (SCARAB_SHAPE.toothedHead) {
    const fan = toothedFan();
    fan.scale(0.075, 0.025, 0.17);
    fan.rotateZ(-0.12);
    fan.translate(waisted ? 0.34 : 0.33, 0.075, 0);
    parts.push({ geometry: fan, material: 'lacquer' });
  }

  // A soft contact shadow on the floor.
  const shadow = new THREE.PlaneGeometry(1.15, 0.75);
  shadow.rotateX(-Math.PI / 2);
  shadow.translate(0.02, 0.004, 0);
  parts.push({ geometry: shadow, material: 'shadow' });
  return parts;
}

// ------------------------------------------------------------------- textures

const smoothstep = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

function canvasLayer(
  w: number,
  h: number,
): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; img: ImageData } {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas context unavailable');
  return { canvas, ctx, img: ctx.createImageData(w, h) };
}

function toTexture(layer: ReturnType<typeof canvasLayer>, srgb: boolean): THREE.CanvasTexture {
  layer.ctx.putImageData(layer.img, 0, 0);
  const tex = new THREE.CanvasTexture(layer.canvas);
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  return tex;
}

/** Cheap smooth value noise, tileable in u. */
function makeNoise(seed: number): (u: number, v: number, freq: number) => number {
  const hash = (x: number, y: number): number => {
    const h = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453;
    return h - Math.floor(h);
  };
  return (u, v, freq) => {
    const x = u * freq;
    const y = v * freq;
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const fx = x - xi;
    const fy = y - yi;
    const wrap = (n: number): number => ((n % freq) + freq) % freq;
    const a = hash(wrap(xi), yi);
    const b = hash(wrap(xi + 1), yi);
    const c = hash(wrap(xi), yi + 1);
    const d = hash(wrap(xi + 1), yi + 1);
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  };
}

/**
 * The wing cases, mapped round the dome (u: 0 at the tail, 0.5 at the front, 0.25 the side facing the
 * camera; v: top to bottom). Deep ruby with a lacquer's depth (darker towards the edges, warmer clouds
 * within), faint grooves along the length, a gold seam along the top and a gold rim round the lower
 * edge, and the dark underside below it. Returns colour, bump and a roughness/metalness map.
 */
function createShellTextures(): { map: THREE.CanvasTexture; bump: THREE.CanvasTexture; orm: THREE.CanvasTexture } {
  const W = 1024;
  const H = 512;
  const color = canvasLayer(W, H);
  const height = canvasLayer(W, H);
  const orm = canvasLayer(W, H);
  const noise = makeNoise(3);
  for (let py = 0; py < H; py++) {
    const v = (py + 0.5) / H;
    const theta = v; // fraction of pi from the top
    const sinT = Math.max(0.06, Math.sin(theta * Math.PI));
    for (let px = 0; px < W; px++) {
      const u = (px + 0.5) / W;
      const o = (py * W + px) * 4;
      // Distance (in surface terms) from the top seam: the meridians at the tail (u = 0) and front (0.5).
      const du = Math.min(Math.abs(u), Math.abs(u - 0.5), Math.abs(u - 1)) * sinT * 2 * Math.PI;
      const seam = theta < RIM ? 1 - smoothstep(0.006, 0.012, du) : 0;
      const rim = 1 - smoothstep(0.008, 0.016, Math.abs(theta - RIM));
      const under = smoothstep(RIM, RIM + 0.012, theta);
      const goldAmt = Math.max(seam, rim);

      // Ruby lacquer: darker towards the rim, with warm clouds in the depth.
      const cloud = noise(u, v, 8) * 0.6 + noise(u, v, 23) * 0.4;
      const depth = 0.55 + 0.27 * (1 - smoothstep(0.1, RIM, theta)) + 0.25 * cloud;
      // Faint grooves running the length of each wing case (from the side they follow the shell's curve).
      const stria =
        theta < RIM - 0.03 ? Math.pow(Math.abs(Math.cos(theta * Math.PI * 14)), 24) * smoothstep(0.12, 0.25, theta) : 0;
      const pit = stria * 0.25;
      let r = 150 * depth - 30 * pit;
      let g = 10 * depth + 6 * cloud;
      let b = 22 * depth + 4 * cloud;
      // Underside: dark bronze.
      r = r * (1 - under) + (46 + 16 * cloud) * under;
      g = g * (1 - under) + (28 + 10 * cloud) * under;
      b = b * (1 - under) + (20 + 6 * cloud) * under;
      // Gold.
      const shine = 0.85 + 0.15 * noise(u, v, 40);
      r = r * (1 - goldAmt) + 236 * shine * goldAmt;
      g = g * (1 - goldAmt) + 172 * shine * goldAmt;
      b = b * (1 - goldAmt) + 72 * shine * goldAmt;
      color.img.data[o] = Math.min(255, Math.max(0, r));
      color.img.data[o + 1] = Math.min(255, Math.max(0, g));
      color.img.data[o + 2] = Math.min(255, Math.max(0, b));
      color.img.data[o + 3] = 255;

      // Height: gold raised, grooves sunk, a soft groove either side of the seam.
      const groove = theta < RIM ? smoothstep(0.012, 0.03, du) * (1 - smoothstep(0.03, 0.06, du)) : 0;
      const hgt = 0.5 + 0.35 * goldAmt - 0.25 * pit * (1 - under) * (1 - goldAmt) - 0.15 * groove + 0.04 * cloud;
      const hv = Math.round(Math.min(1, Math.max(0, hgt)) * 255);
      height.img.data[o] = height.img.data[o + 1] = height.img.data[o + 2] = hv;
      height.img.data[o + 3] = 255;

      // Green: roughness; blue: metalness.
      const rough = (0.32 * (1 - under) + 0.62 * under) * (1 - goldAmt) + 0.28 * goldAmt;
      const metal = 0.15 * (1 - goldAmt) + goldAmt;
      orm.img.data[o] = 255;
      orm.img.data[o + 1] = Math.round(rough * 255);
      orm.img.data[o + 2] = Math.round(metal * 255);
      orm.img.data[o + 3] = 255;
    }
  }
  return { map: toTexture(color, true), bump: toTexture(height, false), orm: toTexture(orm, false) };
}

/** Dark bronze lacquer for the thorax and head: near-black brown, faintly mottled, with a fine grain. */
function createLacquerTextures(): { map: THREE.CanvasTexture; bump: THREE.CanvasTexture } {
  const W = 512;
  const H = 256;
  const color = canvasLayer(W, H);
  const height = canvasLayer(W, H);
  const noise = makeNoise(9);
  for (let py = 0; py < H; py++) {
    const v = (py + 0.5) / H;
    for (let px = 0; px < W; px++) {
      const u = (px + 0.5) / W;
      const o = (py * W + px) * 4;
      const cloud = noise(u, v, 6) * 0.6 + noise(u, v, 19) * 0.4;
      const grain = noise(u, v, 90);
      color.img.data[o] = 62 + 26 * cloud;
      color.img.data[o + 1] = 30 + 13 * cloud;
      color.img.data[o + 2] = 20 + 8 * cloud;
      color.img.data[o + 3] = 255;
      const hv = Math.round((0.5 + 0.12 * grain + 0.05 * cloud) * 255);
      height.img.data[o] = height.img.data[o + 1] = height.img.data[o + 2] = hv;
      height.img.data[o + 3] = 255;
    }
  }
  return { map: toTexture(color, true), bump: toTexture(height, false) };
}

function createShadowTexture(): THREE.CanvasTexture {
  const size = 128;
  const layer = canvasLayer(size, size);
  const g = layer.ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(0,0,0,0.55)');
  g.addColorStop(0.5, 'rgba(0,0,0,0.3)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  layer.ctx.fillStyle = g;
  layer.ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(layer.canvas);
}

/**
 * A hind wing, flat in the xz plane: root at the origin, reaching out along +z (span 1.05 body lengths),
 * leading edge towards +x. Long and narrow with a rounded tip, broadest two thirds of the way out, like a
 * scarab's. UVs: u along the span, v across the chord (1 at the leading edge).
 */
export function buildWingGeometry(): THREE.BufferGeometry {
  const L = 1.05;
  const shape = new THREE.Shape();
  // Points as (span, chord): leading edge out to the tip, round it and back along the trailing edge.
  shape.moveTo(0, 0.045);
  shape.bezierCurveTo(0.3 * L, 0.075, 0.62 * L, 0.1, 0.86 * L, 0.075);
  shape.bezierCurveTo(1.0 * L, 0.05, 1.02 * L, -0.08, 0.93 * L, -0.15);
  shape.bezierCurveTo(0.82 * L, -0.24, 0.55 * L, -0.27, 0.32 * L, -0.2);
  shape.bezierCurveTo(0.16 * L, -0.15, 0.05 * L, -0.08, 0, -0.035);
  shape.closePath();
  const geo = new THREE.ShapeGeometry(shape, 24);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const span = pos.getX(i);
    const chord = pos.getY(i);
    uv.setXY(i, span / L, (chord + 0.28) / 0.39);
    pos.setXYZ(i, chord, 0, span);
  }
  geo.computeVertexNormals();
  return geo;
}

/**
 * The hind wing's membrane: smoky amber, clearer towards the trailing edge, with a dark stiff leading edge
 * (the costa), a dark patch where the wing folds two thirds out, and fine veins fanning back from the root.
 */
function createWingTexture(): THREE.CanvasTexture {
  const W = 512;
  const H = 192;
  const { canvas, ctx } = canvasLayer(W, H);
  const y = (v: number): number => (1 - v) * H;
  // Membrane, densest near the root and the leading edge.
  const across = ctx.createLinearGradient(0, y(1), 0, y(0));
  across.addColorStop(0, 'rgba(72, 44, 24, 0.62)');
  across.addColorStop(0.45, 'rgba(96, 64, 36, 0.4)');
  across.addColorStop(1, 'rgba(120, 88, 56, 0.2)');
  ctx.fillStyle = across;
  ctx.fillRect(0, 0, W, H);
  const along = ctx.createLinearGradient(0, 0, W, 0);
  along.addColorStop(0, 'rgba(40, 24, 12, 0.35)');
  along.addColorStop(0.3, 'rgba(40, 24, 12, 0)');
  ctx.fillStyle = along;
  ctx.fillRect(0, 0, W, H);
  // Veins fanning out from the root towards the tip and the trailing edge.
  ctx.lineCap = 'round';
  const veins: [number, number, number, number, number][] = [
    // end span, end v, bend, width, darkness
    [0.95, 0.72, 0.04, 2.2, 0.55],
    [0.9, 0.5, 0.06, 1.8, 0.5],
    [0.78, 0.3, 0.08, 1.6, 0.45],
    [0.6, 0.12, 0.08, 1.4, 0.4],
    [0.38, 0.04, 0.06, 1.2, 0.35],
  ];
  for (const [u1, v1, bend, w, a] of veins) {
    ctx.strokeStyle = `rgba(36, 20, 10, ${a})`;
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.moveTo(0, y(0.6));
    ctx.quadraticCurveTo(u1 * W * 0.5, y(Math.min(1, v1 + bend + 0.18)), u1 * W, y(v1));
    ctx.stroke();
  }
  // A few faint cross-veins.
  ctx.strokeStyle = 'rgba(36, 20, 10, 0.22)';
  ctx.lineWidth = 1;
  for (const u of [0.22, 0.41, 0.58]) {
    ctx.beginPath();
    ctx.moveTo(u * W, y(0.88));
    ctx.lineTo((u + 0.05) * W, y(0.25));
    ctx.stroke();
  }
  // The stiff dark leading edge, and the fold patch on it.
  const costa = ctx.createLinearGradient(0, y(1), 0, y(0.8));
  costa.addColorStop(0, 'rgba(22, 12, 6, 0.95)');
  costa.addColorStop(1, 'rgba(22, 12, 6, 0)');
  ctx.fillStyle = costa;
  ctx.fillRect(0, 0, W * 0.92, y(0.8));
  ctx.fillStyle = 'rgba(30, 16, 8, 0.7)';
  ctx.beginPath();
  ctx.ellipse(0.6 * W, y(0.9), 0.07 * W, 0.08 * H, 0, 0, Math.PI * 2);
  ctx.fill();
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/** Materials for one scarab; each scarab clones them so it can carry its own cover's clipping planes. */
export type ScarabMaterials = Record<ScarabMaterialKey, THREE.Material>;

export function createScarabMaterials(): ScarabMaterials {
  const shell = createShellTextures();
  const lacquer = createLacquerTextures();
  return {
    shell: new THREE.MeshPhysicalMaterial({
      // Both faces: the insides of the wing cases show when they open to fly.
      side: THREE.DoubleSide,
      map: shell.map,
      bumpMap: shell.bump,
      bumpScale: 2.5,
      roughnessMap: shell.orm,
      metalnessMap: shell.orm,
      roughness: 1,
      metalness: 1,
      clearcoat: 1,
      clearcoatRoughness: 0.12,
      // A faint beetle-shell play of colour in the lacquer.
      iridescence: 0.25,
      iridescenceIOR: 1.7,
      envMapIntensity: 0.9,
    }),
    lacquer: new THREE.MeshPhysicalMaterial({
      map: lacquer.map,
      bumpMap: lacquer.bump,
      bumpScale: 1.5,
      roughness: 0.38,
      metalness: 0.35,
      clearcoat: 0.8,
      clearcoatRoughness: 0.18,
      envMapIntensity: 0.8,
    }),
    shadow: new THREE.MeshBasicMaterial({
      map: createShadowTexture(),
      transparent: true,
      depthWrite: false,
      color: 0x000000,
    }),
    // Thin film: translucent, with a faint rainbow sheen as it catches the light.
    wing: new THREE.MeshPhysicalMaterial({
      map: createWingTexture(),
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      roughness: 0.3,
      metalness: 0,
      iridescence: 0.7,
      iridescenceIOR: 1.35,
      envMapIntensity: 0.7,
    }),
  };
}
