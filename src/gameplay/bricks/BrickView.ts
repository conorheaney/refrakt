import * as THREE from 'three';
import { GRID, PHASE_BRICK, ROW_PALETTE, WALL_Z } from '../config';
import { clamp, easeOutCubic } from '../../engine/core/math';
import { BRICK_KIND_COUNT, BrickKind, type Brick } from '../types';
import type { World } from '../World';
import { CAMERA_HOME, FOREST_VIEW } from '../CameraRig';
import { createBrickGeometry, type BrickShape } from '../../engine/render/geometry';
import { applySurfaceFx, type SurfaceFx } from '../../engine/render/shaders';
import { createGlowTexture } from '../../engine/render/textures';
import { worldOf } from '../../content/worlds';

interface KindLook {
  /** [front facets, bevel + body] */
  readonly materials: [THREE.Material, THREE.Material];
  /** How strongly the brick tints the wall behind it (0 = not at all). */
  readonly wallGlow: number;
}

function glass(shape: BrickShape, fx: SurfaceFx, opacity: number, time: { value: number }): THREE.MeshPhysicalMaterial {
  const m = new THREE.MeshPhysicalMaterial({
    color: 0x3c3c3c,
    roughness: 0.08,
    metalness: 0,
    clearcoat: 1,
    clearcoatRoughness: 0.04,
    envMapIntensity: 0.95,
    transparent: opacity < 1,
    opacity,
  });
  applySurfaceFx(m, { halfW: shape.halfW, halfH: shape.halfH, faceZ: shape.faceZ, instanceFx: true, ...fx }, time);
  return m;
}

const PHASE_FADE = 0.25;

function smooth01(x: number): number {
  const t = clamp(x, 0, 1);
  return t * t * (3 - 2 * t);
}

/**
 * How "ghosted" a phase brick looks, 0 (solid) to 1 (ghost). Mirrors the
 * World's solid/ghost timing, but eases over PHASE_FADE seconds instead of
 * popping: it fades out just after turning non-solid and fades back in just
 * before turning solid again, so it never looks ghosted while it is solid.
 */
function phaseGhost(b: Brick, time: number): number {
  const offset = ((b.col + b.row) & 1) * (PHASE_BRICK.period / 2);
  const t = (time + offset) % PHASE_BRICK.period;
  if (t < PHASE_BRICK.solidTime) return 0;
  const u = t - PHASE_BRICK.solidTime;
  const ghostTime = PHASE_BRICK.period - PHASE_BRICK.solidTime;
  return smooth01(u / PHASE_FADE) * smooth01((ghostTime - u) / PHASE_FADE);
}

/** The framed bricks' violet glass, with one fine vein (shaders.ts STONE_GLSL). */
function veinedGlass(shape: BrickShape, time: { value: number }): THREE.MeshPhysicalMaterial {
  return glass(shape, { glow: 0.55, rim: 1.9, stone: true }, 0.94, time);
}

/** The two-hit bricks: smoky charcoal glass, dark and glossy, lit mostly by its reflections and rims. */
function charcoalGlass(shape: BrickShape, time: { value: number }): THREE.MeshPhysicalMaterial {
  const m = glass(shape, { glow: 0.22, rim: 2.6 }, 0.97, time);
  m.color.setHex(0x141518);
  m.roughness = 0.04;
  m.clearcoatRoughness = 0.02;
  m.envMapIntensity = 1.35;
  m.specularIntensity = 1;
  return m;
}

function metal(shape: BrickShape, color: number, roughness: number, emblem = 0): THREE.MeshPhysicalMaterial {
  const m = new THREE.MeshPhysicalMaterial({ color, roughness, metalness: emblem === 3 ? 0.6 : 1, clearcoat: 0.3, envMapIntensity: 1.2 });
  applySurfaceFx(m, { glow: 0, rim: 0.04, emblem, halfW: shape.halfW, halfH: shape.halfH, faceZ: shape.faceZ, instanceFx: true });
  return m;
}

/**
 * Draws every brick with one InstancedMesh per brick kind (7 draw calls for
 * the whole wall, plus one for the coloured light the glass casts on the back
 * wall). Instance matrices, colours and the `aFx` data (damage cracks, heat,
 * seed) are written straight into the GPU buffers each frame.
 *
 * Families: normal = tinted glass, tough = glossy charcoal glass,
 * armored = finely veined violet glass in a violet metal frame, steel = riveted gunmetal, explosive = hot glass with a burst
 * emblem, prism = gold glass with a star, phase = ghosted lavender glass.
 */
/**
 * The forge block style (themes/blocks/forge): its textures, indexed by BrickKind, and its builders. GameView
 * hands it in, so the brick view doesn't depend on a theme.
 */
export interface ForgeStyle {
  readonly textures: readonly THREE.Texture[];
  armorGeometry(): THREE.BufferGeometry;
  explosiveGeometry(): THREE.BufferGeometry;
  prototypeMaterials(kind: 'armored' | 'explosive', basalt: THREE.Texture, steel: THREE.Texture, time: { value: number }): [THREE.Material, THREE.Material];
}

export class BrickView {
  private readonly meshes: THREE.InstancedMesh[] = [];
  private readonly fxAttrs: THREE.InstancedBufferAttribute[] = [];
  private readonly looks: KindLook[] = [];
  private readonly classicGeometry: THREE.BufferGeometry[] = [];
  private readonly forgeGeometry: THREE.BufferGeometry[] = [];
  private readonly forgeLooks: KindLook[] = [];
  private forge = false;
  private readonly counts = new Int32Array(BRICK_KIND_COUNT);
  private readonly palette: THREE.Color[];
  private readonly tmp = new THREE.Color();
  private readonly glowMesh: THREE.InstancedMesh;
  private readonly time = { value: 0 };
  private readonly charcoalTint = new THREE.Color(0x5c6070);
  /** Tints the framed brick's glass and (multiplying the frame metal's pale colour) its violet frame. */
  private readonly armorTint = new THREE.Color(0x8a55ff);
  private readonly hotTint = new THREE.Color(0xff3a0c);
  private readonly goldTint = new THREE.Color(0xffa51f);
  private readonly ghostTint = new THREE.Color(0xa58cff);

  /** Set when the scene is seen straight on through an orthographic camera (the forest view). */
  flatView = false;

  constructor(scene: THREE.Scene, forge: ForgeStyle) {
    const forgeTextures = forge.textures;
    const { geometry, shape } = createBrickGeometry(GRID.halfW, GRID.halfH, GRID.depth);
    const capacity = GRID.cols * GRID.rows;
    const forgeBlock = createBrickGeometry(GRID.halfW, GRID.halfH, GRID.depth, true);
    const t = this.time;

    const normal = glass(shape, { glow: 0.55, rim: 1.9 }, 0.88, t);
    const tough = charcoalGlass(shape, t);
    const armorFace = veinedGlass(shape, t);
    // Pale metal under the violet instance tint gives a violet frame (white chrome read as a glaring rim).
    const chrome = metal(shape, 0xc4bed8, 0.3);
    const steel = metal(shape, 0x98a2b2, 0.36, 3);
    const explosive = glass(shape, { glow: 0.75, rim: 1.8, emblem: 2 }, 0.94, t);
    const prism = glass(shape, { glow: 0.8, rim: 2.2, emblem: 1 }, 0.95, t);
    const phase = glass(shape, { glow: 0.5, rim: 2.4 }, 0.5, t);
    this.looks[BrickKind.Normal] = { materials: [normal, normal], wallGlow: 0.32 };
    this.looks[BrickKind.Tough] = { materials: [tough, tough], wallGlow: 0.08 };
    this.looks[BrickKind.Armored] = { materials: [armorFace, chrome], wallGlow: 0.18 };
    this.looks[BrickKind.Steel] = { materials: [steel, steel], wallGlow: 0 };
    this.looks[BrickKind.Explosive] = { materials: [explosive, explosive], wallGlow: 0.5 };
    this.looks[BrickKind.Prism] = { materials: [prism, prism], wallGlow: 0.55 };
    this.looks[BrickKind.Phase] = { materials: [phase, phase], wallGlow: 0.22 };

    const white = new THREE.Color(0xffffff);
    for (let kind = 0; kind < BRICK_KIND_COUNT; kind++) {
      const geo = geometry.clone();
      const fx = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
      fx.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute('aFx', fx);
      this.classicGeometry.push(geo);
      const forgeGeo = kind === BrickKind.Armored ? forge.armorGeometry()
        : kind === BrickKind.Explosive ? forge.explosiveGeometry() : forgeBlock.geometry.clone();
      forgeGeo.setAttribute('aFx', fx);
      this.forgeGeometry.push(forgeGeo);
      const map = forgeTextures[kind];
      if (map && (kind === BrickKind.Armored || kind === BrickKind.Explosive) && forgeTextures[BrickKind.Normal]) {
        this.forgeLooks[kind] = {
          materials: forge.prototypeMaterials(kind === BrickKind.Armored ? 'armored' : 'explosive', forgeTextures[BrickKind.Normal], forgeTextures[BrickKind.Steel] ?? map, t),
          wallGlow: 0,
        };
      } else if (map) {
        const metalness = [0.04, 0.02, 0.5, 0.85, 0.03, 0.2, 0.15][kind];
        const roughness = [0.86, 0.8, 0.48, 0.4, 0.72, 0.22, 0.25][kind];
        // A separate linear texture view supplies relief without treating colour as normal vectors.
        const bump = map.clone();
        bump.colorSpace = THREE.NoColorSpace;
        bump.needsUpdate = true;
        const material = new THREE.MeshPhysicalMaterial({
          color: 0xffffff, map, bumpMap: bump, bumpScale: kind === BrickKind.Steel ? 0.018 : 0.045,
          metalness, roughness, clearcoat: kind >= BrickKind.Prism ? 0.65 : 0.08,
          emissive: 0xffffff, emissiveMap: map,
          emissiveIntensity: [0.12, 0.1, 0.12, 0.15, 0.75, 0.45, 0.3][kind],
          transparent: kind === BrickKind.Phase, opacity: kind === BrickKind.Phase ? 0.7 : 1,
          envMapIntensity: 0.8,
        });
        applySurfaceFx(material, {
          glow: kind === BrickKind.Explosive ? 0.035 : 0,
          rim: kind === BrickKind.Phase ? 0.22 : 0.035,
          instanceFx: true, halfW: forgeBlock.shape.halfW, halfH: forgeBlock.shape.halfH,
          faceZ: forgeBlock.shape.faceZ,
        }, t);
        this.forgeLooks[kind] = { materials: [material, material], wallGlow: 0 };
      }
      const mesh = new THREE.InstancedMesh(geo, this.looks[kind].materials, capacity);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.setColorAt(0, white);
      mesh.instanceColor?.setUsage(THREE.DynamicDrawUsage);
      mesh.castShadow = true;
      mesh.receiveShadow = kind !== BrickKind.Phase;
      mesh.frustumCulled = false;
      mesh.count = 0;
      this.meshes.push(mesh);
      this.fxAttrs.push(fx);
      scene.add(mesh);
    }
    geometry.dispose();
    forgeBlock.geometry.dispose();

    // Coloured light spilled onto the back wall behind glowing glass.
    this.glowMesh = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({
        map: createGlowTexture(),
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
      capacity,
    );
    this.glowMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.glowMesh.setColorAt(0, white);
    this.glowMesh.instanceColor?.setUsage(THREE.DynamicDrawUsage);
    this.glowMesh.frustumCulled = false;
    this.glowMesh.count = 0;
    this.glowMesh.renderOrder = -1;
    scene.add(this.glowMesh);

    this.palette = ROW_PALETTE.map((hex) => new THREE.Color(hex));
  }

  /** Base (unlit, un-flashed) tint of a brick in linear space; also used for shards and sparks. */
  colorOf(brick: Brick, _time: number, out: THREE.Color): THREE.Color {
    if (this.forge) return out.setHex([0x88817a, 0xc3a17d, 0xaaa09a, 0x738597, 0xff631c, 0xffc657, 0xb680e5][brick.kind]);
    switch (brick.kind) {
      case BrickKind.Tough:
        return out.copy(this.charcoalTint);
      case BrickKind.Armored:
        return out.copy(this.armorTint);
      case BrickKind.Steel:
        return out.setRGB(0.32, 0.36, 0.42);
      case BrickKind.Explosive:
        return out.copy(this.hotTint);
      case BrickKind.Prism:
        return out.copy(this.goldTint);
      case BrickKind.Phase:
        return out.copy(this.ghostTint);
      default:
        return out.copy(this.palette[(brick.row + (Math.abs(brick.col - (GRID.cols - 1) / 2) > 3.5 ? 2 : 0)) % this.palette.length]);
    }
  }

  update(world: World): void {
    const forge = worldOf(world.levelIndex).blockStyle === 'forge' && this.forgeLooks.length === BRICK_KIND_COUNT;
    if (forge !== this.forge) {
      this.forge = forge;
      for (let kind = 0; kind < this.meshes.length; kind++) {
        this.meshes[kind].geometry = (forge ? this.forgeGeometry : this.classicGeometry)[kind];
        this.meshes[kind].material = (forge ? this.forgeLooks : this.looks)[kind].materials;
      }
    }
    const time = world.time;
    this.time.value = time;
    const counts = this.counts;
    counts.fill(0);
    const bricks = world.bricks;
    const tmp = this.tmp;
    const glowMatrix = this.glowMesh.instanceMatrix.array;
    const glowColor = this.glowMesh.instanceColor?.array;
    let glowCount = 0;
    // Project wall glow to where the brick appears against the wall from the camera's home pose (in the
    // flat forest view, along its parallel view direction).
    const camY = CAMERA_HOME.y;
    const camZ = CAMERA_HOME.z;
    const along = this.flatView ? 1 : (WALL_Z - camZ) / -camZ;
    const flatDrop = WALL_Z * Math.tan(FOREST_VIEW.pitch);

    for (let i = 0; i < bricks.length; i++) {
      const b = bricks[i];
      if (!b.alive) continue;
      const spawn = clamp((time - b.spawnTime) / 0.5, 0, 1);
      if (spawn <= 0) continue;

      const mesh = this.meshes[b.kind];
      const slot = counts[b.kind]++;
      // Hit feedback: a faint brightening that eases out over 0.35 s (was a +180% flash over 0.2 s).
      const hitT = Math.max(0, 1 - (time - b.hitTime) / 0.35);
      const flash = hitT * hitT;
      const grow = easeOutCubic(spawn);
      let sx = grow * (1 + flash * 0.015);
      let sy = sx;
      let sz = grow;
      let gain = 1 + flash * 0.35;
      let heat = 0;
      let damage = 0;
      let ghost = 0;

      if (this.forge) tmp.setRGB(1, 1, 1);
      else this.colorOf(b, time, tmp);
      if (b.kind === BrickKind.Tough || b.kind === BrickKind.Armored) {
        damage = 1 - b.hp / b.maxHp;
      } else if (b.kind === BrickKind.Explosive) {
        // Slow, shallow glow instead of a ~1 Hz full-range pulse.
        heat = b.fuse > 0 ? 0.8 : 0.5 + 0.12 * Math.sin(time * 1.8 + b.col * 1.3);
        gain *= 0.9 + heat * 0.25;
      } else if (b.kind === BrickKind.Phase) {
        ghost = phaseGhost(b, time);
        gain *= 1 - ghost * 0.75;
        sx *= 1 - ghost * 0.1;
        sy *= 1 - ghost * 0.2;
        sz *= 1 - ghost * 0.7;
      }

      const m = mesh.instanceMatrix.array;
      const o = slot * 16;
      m[o] = sx;
      m[o + 1] = 0;
      m[o + 2] = 0;
      m[o + 3] = 0;
      m[o + 4] = 0;
      m[o + 5] = sy;
      m[o + 6] = 0;
      m[o + 7] = 0;
      m[o + 8] = 0;
      m[o + 9] = 0;
      m[o + 10] = sz;
      m[o + 11] = 0;
      m[o + 12] = b.x;
      m[o + 13] = b.y;
      m[o + 14] = (1 - spawn) * 5;
      m[o + 15] = 1;

      const colors = mesh.instanceColor;
      if (colors) {
        const c = colors.array;
        const k = slot * 3;
        c[k] = tmp.r * gain;
        c[k + 1] = tmp.g * gain;
        c[k + 2] = tmp.b * gain;
      }
      const fx = this.fxAttrs[b.kind].array as Float32Array;
      fx[slot * 3] = damage;
      fx[slot * 3 + 1] = heat;
      fx[slot * 3 + 2] = (b.index * 0.6180339) % 1;

      const wallGlow = (this.forge ? this.forgeLooks : this.looks)[b.kind].wallGlow * (1 - ghost * 0.7) * spawn;
      if (wallGlow > 0 && glowColor) {
        const g = glowCount * 16;
        const gx = b.x * along;
        const gy = (this.flatView ? b.y + flatDrop : camY + (b.y - camY) * along) - 0.25;
        glowMatrix[g] = GRID.cellW * 2.6;
        glowMatrix[g + 5] = GRID.cellH * 2.9;
        glowMatrix[g + 10] = 1;
        glowMatrix[g + 12] = gx;
        glowMatrix[g + 13] = gy;
        glowMatrix[g + 14] = WALL_Z + 0.05;
        glowMatrix[g + 15] = 1;
        const k = glowCount * 3;
        const strength = wallGlow * (1 + flash * 0.3 + heat * 0.6);
        glowColor[k] = tmp.r * strength;
        glowColor[k + 1] = tmp.g * strength;
        glowColor[k + 2] = tmp.b * strength;
        glowCount++;
      }
    }

    for (let kind = 0; kind < this.meshes.length; kind++) {
      const mesh = this.meshes[kind];
      mesh.count = counts[kind];
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      const fx = this.fxAttrs[kind];
      fx.clearUpdateRanges();
      fx.addUpdateRange(0, counts[kind] * 3);
      fx.needsUpdate = true;
    }
    this.glowMesh.count = glowCount;
    this.glowMesh.instanceMatrix.needsUpdate = true;
    if (this.glowMesh.instanceColor) this.glowMesh.instanceColor.needsUpdate = true;
  }
}
