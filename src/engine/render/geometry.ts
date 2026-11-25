import * as THREE from 'three';

type V3 = readonly [number, number, number];

/** Collects flat-shaded triangles, orienting each one away from `centre` (valid for convex solids). */
class TriangleSoup {
  private readonly positions: number[] = [];
  private readonly groupStarts: number[] = [];
  private readonly groupMaterials: number[] = [];
  private readonly a = new THREE.Vector3();
  private readonly b = new THREE.Vector3();
  private readonly c = new THREE.Vector3();
  private readonly n = new THREE.Vector3();
  private readonly mid = new THREE.Vector3();

  constructor(private readonly centre: THREE.Vector3) {}

  group(materialIndex: number): void {
    this.groupStarts.push(this.positions.length / 3);
    this.groupMaterials.push(materialIndex);
  }

  tri(p: V3, q: V3, r: V3): void {
    const { a, b, c, n, mid } = this;
    a.set(p[0], p[1], p[2]);
    b.set(q[0], q[1], q[2]);
    c.set(r[0], r[1], r[2]);
    n.subVectors(b, a).cross(mid.subVectors(c, a));
    if (n.lengthSq() < 1e-12) return;
    mid
      .copy(a)
      .add(b)
      .add(c)
      .multiplyScalar(1 / 3)
      .sub(this.centre);
    if (n.dot(mid) < 0) this.positions.push(...p, ...r, ...q);
    else this.positions.push(...p, ...q, ...r);
  }

  quad(p: V3, q: V3, r: V3, s: V3): void {
    this.tri(p, q, r);
    this.tri(p, r, s);
  }

  build(): THREE.BufferGeometry {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3));
    geo.computeVertexNormals();
    const total = this.positions.length / 3;
    for (let i = 0; i < this.groupStarts.length; i++) {
      const start = this.groupStarts[i];
      const end = i + 1 < this.groupStarts.length ? this.groupStarts[i + 1] : total;
      geo.addGroup(start, end - start, this.groupMaterials[i]);
    }
    geo.computeBoundingSphere();
    return geo;
  }
}

/** Octagon outline of a rectangle with chamfered corners, counter-clockwise from the right edge. */
function octagon(hw: number, hh: number, c: number, z: number): V3[] {
  return [
    [hw, -hh + c, z],
    [hw, hh - c, z],
    [hw - c, hh, z],
    [-hw + c, hh, z],
    [-hw, hh - c, z],
    [-hw, -hh + c, z],
    [-hw + c, -hh, z],
    [hw - c, -hh, z],
  ];
}

export interface BrickShape {
  readonly halfW: number;
  readonly halfH: number;
  readonly depth: number;
  /** Local z where the faceted front face begins (used by shaders to find the face). */
  readonly faceZ: number;
}

/**
 * A chunky gem-like brick: chamfered octagonal body, a bevel ring and a
 * low four-sided pyramid on the front face (the X-shaped crease).
 * Material groups: 0 = front facets, 1 = bevel ring + body.
 */
export function createBrickGeometry(
  halfW: number,
  halfH: number,
  depth: number,
  flatFace = false,
): { geometry: THREE.BufferGeometry; shape: BrickShape } {
  const back = -depth / 2;
  const front = depth / 2 - 0.2;
  const bevelTop = depth / 2 - 0.06;
  const apexZ = flatFace ? bevelTop : depth / 2 + 0.03;
  const chamfer = Math.min(halfW, halfH) * 0.3;
  const inset = Math.min(halfW, halfH) * 0.27;
  const soup = new TriangleSoup(new THREE.Vector3(0, 0, 0));

  const outerBack = octagon(halfW * 0.97, halfH * 0.95, chamfer, back);
  const outerFront = octagon(halfW, halfH, chamfer, front);
  const iw = halfW - inset;
  const ih = halfH - inset;
  // Inner rectangle corners, matched to the octagon's chamfer edges (1->2, 3->4, 5->6, 7->0).
  const inner: V3[] = [
    [iw, ih, bevelTop],
    [-iw, ih, bevelTop],
    [-iw, -ih, bevelTop],
    [iw, -ih, bevelTop],
  ];

  // Front pyramid facets (group 0).
  soup.group(0);
  const apex: V3 = [0, 0, apexZ];
  for (let i = 0; i < 4; i++) soup.tri(apex, inner[i], inner[(i + 1) % 4]);

  // Bevel ring, sides and back (group 1).
  soup.group(1);
  const o = outerFront;
  soup.quad(o[0], o[1], inner[0], inner[3]); // right
  soup.tri(o[1], o[2], inner[0]); // top-right chamfer
  soup.quad(o[2], o[3], inner[1], inner[0]); // top
  soup.tri(o[3], o[4], inner[1]);
  soup.quad(o[4], o[5], inner[2], inner[1]); // left
  soup.tri(o[5], o[6], inner[2]);
  soup.quad(o[6], o[7], inner[3], inner[2]); // bottom
  soup.tri(o[7], o[0], inner[3]);
  for (let i = 0; i < 8; i++) {
    const j = (i + 1) % 8;
    soup.quad(outerBack[i], outerBack[j], outerFront[j], outerFront[i]);
  }
  for (let i = 1; i < 7; i++) soup.tri(outerBack[0], outerBack[i], outerBack[i + 1]);

  const geometry = soup.build();
  if (flatFace) {
    // Box projection keeps the front artwork upright and gives the sides real surface relief.
    const positions = geometry.getAttribute('position');
    const normals = geometry.getAttribute('normal');
    const uv = new Float32Array(positions.count * 2);
    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i),
        y = positions.getY(i),
        z = positions.getZ(i);
      const nx = Math.abs(normals.getX(i)),
        ny = Math.abs(normals.getY(i)),
        nz = Math.abs(normals.getZ(i));
      uv[i * 2] = nx > nz && nx > ny ? z / depth + 0.5 : x / (halfW * 2) + 0.5;
      uv[i * 2 + 1] = ny > nz && ny > nx ? z / depth + 0.5 : y / (halfH * 2) + 0.5;
    }
    geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  }
  return { geometry, shape: { halfW, halfH, depth, faceZ: bevelTop - 0.005 } };
}

/** An irregular flat gem used for glass shards. */
export function createShardGeometry(): THREE.BufferGeometry {
  const soup = new TriangleSoup(new THREE.Vector3(0, 0, 0));
  soup.group(0);
  const ring: V3[] = [
    [0.5, 0.05, 0],
    [0.18, 0.42, 0.02],
    [-0.32, 0.3, -0.02],
    [-0.5, -0.12, 0],
    [-0.1, -0.46, 0.02],
    [0.34, -0.3, -0.02],
  ];
  const topApex: V3 = [0.04, 0.02, 0.2];
  const bottomApex: V3 = [-0.03, -0.02, -0.16];
  for (let i = 0; i < ring.length; i++) {
    const j = (i + 1) % ring.length;
    soup.tri(topApex, ring[i], ring[j]);
    soup.tri(bottomApex, ring[j], ring[i]);
  }
  return soup.build();
}

/**
 * Paddle body: a long, low slab with chamfered plan-view corners and
 * chamfered top edges, centred on the origin. Width is along X, depth along Z.
 */
export function createSlabGeometry(
  halfW: number,
  halfH: number,
  halfD: number,
  plan: number,
  edge: number,
): THREE.BufferGeometry {
  const soup = new TriangleSoup(new THREE.Vector3(0, 0, 0));
  soup.group(0);
  // Plan-view octagons (in XZ) at three heights: bottom, shoulder (full size), top (inset by `edge`).
  const ring = (hw: number, hd: number, c: number, y: number): V3[] => [
    [hw, y, -hd + c],
    [hw, y, hd - c],
    [hw - c, y, hd],
    [-hw + c, y, hd],
    [-hw, y, hd - c],
    [-hw, y, -hd + c],
    [-hw + c, y, -hd],
    [hw - c, y, -hd],
  ];
  const bottom = ring(halfW - edge * 0.5, halfD - edge * 0.5, plan, -halfH);
  const shoulderLow = ring(halfW, halfD, plan, -halfH + edge * 0.6);
  const shoulderHigh = ring(halfW, halfD, plan, halfH - edge);
  const top = ring(halfW - edge, halfD - edge, plan * 0.85, halfH);
  const bands = [bottom, shoulderLow, shoulderHigh, top];
  for (let b = 0; b < bands.length - 1; b++) {
    for (let i = 0; i < 8; i++) {
      const j = (i + 1) % 8;
      soup.quad(bands[b][i], bands[b][j], bands[b + 1][j], bands[b + 1][i]);
    }
  }
  for (let i = 1; i < 7; i++) {
    soup.tri(top[0], top[i], top[i + 1]);
    soup.tri(bottom[0], bottom[i], bottom[i + 1]);
  }
  return soup.build();
}
