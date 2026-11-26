import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GRID } from '../../../gameplay/config';
import { createBrickGeometry } from '../../../engine/render/geometry';
import { applySurfaceFx } from '../../../engine/render/shaders';

/** Combine disconnected solid parts while retaining two instanced material groups. */
function assemble(first: THREE.BufferGeometry[], second: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const merge = (parts: THREE.BufferGeometry[]): THREE.BufferGeometry => {
    const flat = parts.map((part) => (part.index ? part.toNonIndexed() : part));
    const result = mergeGeometries(flat, false)!;
    new Set([...parts, ...flat]).forEach((part) => part.dispose());
    return result;
  };
  const a = merge(first),
    b = merge(second);
  const geometry = mergeGeometries([a, b], true)!;
  a.dispose();
  b.dispose();
  geometry.computeBoundingSphere();
  return geometry;
}

function beam(w: number, h: number, d: number, x: number, y: number, z: number): THREE.BufferGeometry {
  return new RoundedBoxGeometry(w, h, d, 2, Math.min(w, h, d) * 0.18).translate(x, y, z);
}

/** Recessed stone enclosed by four raised iron rails and physical corner rivets. */
export function createForgeArmorGeometry(): THREE.BufferGeometry {
  const { halfW: w, halfH: h, depth: d } = GRID;
  const stone = createBrickGeometry(w - 0.12, h - 0.12, d * 0.65, true).geometry;
  stone.translate(0, 0, -0.1);
  const rail = 0.19;
  const frame = [
    beam(w * 2, rail, d, 0, h - rail / 2, 0),
    beam(w * 2, rail, d, 0, -h + rail / 2, 0),
    beam(rail, (h - rail) * 2, d, w - rail / 2, 0, 0),
    beam(rail, (h - rail) * 2, d, -w + rail / 2, 0, 0),
  ];
  // Use the steel plate's perimeter as one continuous frame, rather than
  // squeezing the entire plate image separately onto each rail.
  for (const part of frame) {
    const position = part.getAttribute('position');
    const uv = part.getAttribute('uv');
    for (let i = 0; i < uv.count; i++) {
      uv.setXY(i, position.getX(i) / (2 * w) + 0.5, position.getY(i) / (2 * h) + 0.5);
    }
  }
  for (const x of [-1, 1])
    for (const y of [-1, 1]) {
      const rivet = new THREE.CylinderGeometry(0.065, 0.075, 0.06, 6);
      // Sample unadorned steel for the raised hex heads, avoiding painted rivets on rivets.
      const uv = rivet.getAttribute('uv');
      for (let i = 0; i < uv.count; i++) uv.setXY(i, 0.42 + uv.getX(i) * 0.16, 0.42 + uv.getY(i) * 0.16);
      rivet.rotateX(Math.PI / 2);
      rivet.translate(x * (w - rail / 2), y * (h - rail / 2), d / 2);
      frame.push(rivet);
    }
  return assemble([stone], frame);
}

/** Six separate basalt plates expose a real recessed core through an uneven fissure. */
export function createForgeExplosiveGeometry(): THREE.BufferGeometry {
  const { halfW: w, halfH: h, depth: d } = GRID;
  const core = createBrickGeometry(w * 0.96, h * 0.96, d * 0.75, true).geometry;
  core.translate(0, 0, -0.08);
  const polygons = [
    [
      [-0.96, 0.92],
      [-0.39, 0.92],
      [-0.32, 0.29],
      [-0.48, 0.08],
      [-0.96, 0.24],
    ],
    [
      [-0.23, 0.92],
      [0.29, 0.92],
      [0.2, 0.16],
      [-0.15, 0.05],
      [-0.21, 0.32],
    ],
    [
      [0.45, 0.92],
      [0.96, 0.92],
      [0.96, 0.03],
      [0.37, 0.17],
    ],
    [
      [-0.96, 0.02],
      [-0.48, -0.14],
      [-0.28, -0.32],
      [-0.4, -0.92],
      [-0.96, -0.92],
    ],
    [
      [-0.14, -0.18],
      [0.18, -0.07],
      [0.32, -0.39],
      [0.24, -0.92],
      [-0.24, -0.92],
    ],
    [
      [0.39, -0.07],
      [0.96, -0.19],
      [0.96, -0.92],
      [0.4, -0.92],
      [0.48, -0.4],
    ],
  ];
  const plates = polygons.map((points, index) => {
    const shape = new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x * w, y * h)));
    const geometry = new THREE.ExtrudeGeometry(shape, {
      depth: 0.18,
      bevelEnabled: true,
      bevelThickness: 0.025,
      bevelSize: 0.018,
      bevelSegments: 1,
      steps: 1,
    });
    geometry.translate(0, 0, 0.19 + (index % 2) * 0.02);
    const position = geometry.getAttribute('position');
    const uv = geometry.getAttribute('uv');
    for (let i = 0; i < uv.count; i++) uv.setXY(i, position.getX(i) / (2 * w) + 0.5, position.getY(i) / (2 * h) + 0.5);
    return geometry;
  });
  return assemble(plates, [core]);
}

export function createForgePrototypeMaterials(
  kind: 'armored' | 'explosive',
  basalt: THREE.Texture,
  steel: THREE.Texture,
  time: { value: number },
): [THREE.Material, THREE.Material] {
  const bump = basalt.clone();
  bump.colorSpace = THREE.NoColorSpace;
  bump.needsUpdate = true;
  const stone = new THREE.MeshPhysicalMaterial({
    map: basalt,
    color: kind === 'armored' ? 0xffffff : 0xb2b4b8,
    bumpMap: bump,
    bumpScale: 0.055,
    roughness: 0.87,
    metalness: 0.05,
    emissive: 0xffffff,
    emissiveMap: basalt,
    emissiveIntensity: 0.12,
  });
  applySurfaceFx(
    stone,
    {
      glow: 0,
      rim: 0.025,
      instanceFx: true,
      halfW: GRID.halfW,
      halfH: GRID.halfH,
      faceZ: kind === 'armored' ? 0.1 : 0.3,
    },
    time,
  );
  if (kind === 'armored') {
    const steelBump = steel.clone();
    steelBump.colorSpace = THREE.NoColorSpace;
    steelBump.needsUpdate = true;
    const frame = new THREE.MeshPhysicalMaterial({
      // Match the steel block's finish, with only a slight warm tint to distinguish armour.
      color: 0xffeddb,
      map: steel,
      bumpMap: steelBump,
      bumpScale: 0.018,
      metalness: 0.85,
      roughness: 0.4,
      clearcoat: 0.08,
      envMapIntensity: 0.8,
      emissive: 0xffeddb,
      emissiveMap: steel,
      emissiveIntensity: 0.15,
    });
    applySurfaceFx(
      frame,
      { glow: 0, rim: 0.045, instanceFx: true, halfW: GRID.halfW, halfH: GRID.halfH, faceZ: 0.34 },
      time,
    );
    return [stone, frame];
  }
  const core = new THREE.MeshPhysicalMaterial({
    color: 0xff6b0c,
    roughness: 0.32,
    metalness: 0.08,
    emissive: 0xff4800,
  });
  applySurfaceFx(core, { glow: 0, rim: 0, instanceFx: true, halfW: GRID.halfW, halfH: GRID.halfH }, time);
  // Called with .call(core, ...) below, so `this` stays bound.
  // oxlint-disable-next-line typescript/unbound-method
  const surfaceCompile = core.onBeforeCompile;
  const cacheKey = core.customProgramCacheKey();
  core.customProgramCacheKey = () => `${cacheKey}-forge-molten-v1`;
  core.onBeforeCompile = (shader, renderer) => {
    surfaceCompile.call(core, shader, renderer);
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <opaque_fragment>',
      `
      float flow = 0.5 + 0.5 * sin(vLocalPos.x * 9.0 + vLocalPos.y * 13.0 - uTime * 1.8 + vFx.z * 6.283);
      float breathe = 0.5 + 0.5 * sin(uTime * 2.0 + vFx.z * 6.283);
      float armed = smoothstep(0.65, 0.8, vFx.y);
      vec3 lava = mix(vec3(1.0, 0.085, 0.004), vec3(1.0, 0.52, 0.055), flow * 0.7 + armed * 0.3);
      outgoingLight = lava * (1.5 + breathe * 0.7 + armed * 2.2);
      #include <opaque_fragment>`,
    );
  };
  return [stone, core];
}
