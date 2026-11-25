import * as THREE from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { FIELD, WALL_Z } from '../../gameplay/config';
import type { WorldId } from '../../content/worlds';
import type { ForestAssets } from './forest/assets';
import { ForestEnvironment } from './forest/ForestEnvironment';
import { FLOOR_SHADER } from '../../engine/render/shaders';
import {
  createGasGiantTexture,
  createMoonTexture,
  createOceanPlanetTexture,
  createPlanetRingTexture,
  createStarfieldTexture,
} from './space/spaceTextures';

const FLOOR_Y = FIELD.floorY;
/** Wall-torch light per unit of flicker (Environment.setTorches): kept low so bricks keep their colours. */
const TORCH_LIGHT = 90;

/**
 * Builds a smooth sculptural band: a rounded-rectangle cross-section swept
 * along a curve, with the band's broad side kept facing `facing`.
 */
function sweptBand(
  curve: THREE.Curve<THREE.Vector3>,
  width: number,
  thickness: number,
  segments: number,
  facing: THREE.Vector3,
): THREE.BufferGeometry {
  const profile: [number, number][] = [];
  const corner = Math.min(width, thickness) * 0.45;
  const hw = width / 2 - corner;
  const ht = thickness / 2 - corner;
  const centres: [number, number, number][] = [
    [hw, ht, 0],
    [-hw, ht, Math.PI / 2],
    [-hw, -ht, Math.PI],
    [hw, -ht, Math.PI * 1.5],
  ];
  for (const [cx, cy, start] of centres) {
    for (let k = 0; k <= 4; k++) {
      const a = start + (k / 4) * (Math.PI / 2);
      profile.push([cx + Math.cos(a) * corner, cy + Math.sin(a) * corner]);
    }
  }
  const ring = profile.length;
  const positions: number[] = [];
  const indices: number[] = [];
  const t = new THREE.Vector3();
  const side = new THREE.Vector3();
  const broad = new THREE.Vector3();
  const p = new THREE.Vector3();
  for (let i = 0; i <= segments; i++) {
    const u = i / segments;
    curve.getPointAt(u, p);
    curve.getTangentAt(u, t);
    side.crossVectors(t, facing).normalize();
    broad.crossVectors(side, t).normalize();
    for (const [a, b] of profile) {
      positions.push(p.x + broad.x * a + side.x * b, p.y + broad.y * a + side.y * b, p.z + broad.z * a + side.z * b);
    }
  }
  for (let i = 0; i < segments; i++) {
    for (let k = 0; k < ring; k++) {
      const a = i * ring + k;
      const b = i * ring + ((k + 1) % ring);
      const c = (i + 1) * ring + ((k + 1) % ring);
      const d = (i + 1) * ring + k;
      indices.push(a, d, b, b, d, c);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/** Base tint of the space backdrop (very dark blue); per-level themes shift its hue slightly. */
const WALL_COLOR = 0x0d1220;

/** In-plane thickness and depth of the arena's arch frame, and its z offset (its flat inner face spans z = 0). */
const ARCH_THICKNESS = 1.1;
const ARCH_DEPTH = 2.4;
const ARCH_Z = -0.2;

/**
 * Path of the arch frame's centreline: the arena boundary (straight sides, flat
 * top, quarter-circle top corners) pushed outward by `offset`, running from
 * below the floor on the left, over the top, to below the floor on the right.
 */
function archCurve(offset: number): THREE.CatmullRomCurve3 {
  const x = FIELD.halfWidth + offset;
  const cx = FIELD.halfWidth - FIELD.cornerRadius;
  const cy = FIELD.top - FIELD.cornerRadius;
  const radius = FIELD.cornerRadius + offset;
  const bottom = FLOOR_Y - 2;
  const pts: THREE.Vector3[] = [];
  const line = (x0: number, y0: number, x1: number, y1: number): void => {
    const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 0.5));
    for (let i = 0; i < n; i++) pts.push(new THREE.Vector3(x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n, 0));
  };
  const arc = (ccx: number, a0: number, a1: number): void => {
    const n = 24;
    for (let i = 0; i < n; i++) {
      const a = a0 + ((a1 - a0) * i) / n;
      pts.push(new THREE.Vector3(ccx + Math.cos(a) * radius, cy + Math.sin(a) * radius, 0));
    }
  };
  line(-x, bottom, -x, cy);
  arc(-cx, Math.PI, Math.PI / 2);
  line(-cx, cy + radius, cx, cy + radius);
  arc(cx, Math.PI / 2, 0);
  line(x, cy, x, bottom);
  pts.push(new THREE.Vector3(x, bottom, 0));
  return new THREE.CatmullRomCurve3(pts, false, 'centripetal');
}

/** A small emissive "studio" used to bake the reflection environment: warm left, cool right, softbox above. */
function createStudioEnvScene(): THREE.Scene {
  const scene = new THREE.Scene();
  const room = new THREE.Mesh(
    new THREE.BoxGeometry(80, 40, 80),
    new THREE.MeshBasicMaterial({ color: 0x23272e, side: THREE.BackSide }),
  );
  room.position.y = 8;
  scene.add(room);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), new THREE.MeshBasicMaterial({ color: 0x4a4d52 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -10;
  scene.add(floor);
  const panel = (
    w: number,
    h: number,
    color: THREE.Color,
    pos: [number, number, number],
    rot: [number, number, number],
  ): void => {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }),
    );
    m.position.set(...pos);
    m.rotation.set(...rot);
    scene.add(m);
  };
  panel(26, 18, new THREE.Color(1, 0.42, 0.12).multiplyScalar(7), [-38, 4, 4], [0, Math.PI / 2, 0]);
  panel(22, 16, new THREE.Color(0.32, 0.55, 1).multiplyScalar(4.5), [38, 4, 2], [0, -Math.PI / 2, 0]);
  panel(40, 12, new THREE.Color(1, 0.97, 0.92).multiplyScalar(5), [0, 27, 0], [Math.PI / 2, 0, 0]);
  panel(70, 26, new THREE.Color(0.55, 0.56, 0.6), [0, 4, 39], [0, Math.PI, 0]);
  panel(46, 3, new THREE.Color(1, 1, 1).multiplyScalar(6), [0, 10, 38], [0, Math.PI, 0]);
  panel(18, 10, new THREE.Color(1, 0.6, 0.3).multiplyScalar(2), [-20, 2, 36], [0, Math.PI, 0]);
  panel(18, 10, new THREE.Color(0.5, 0.65, 1).multiplyScalar(1.6), [22, 2, 36], [0, Math.PI, 0]);
  return scene;
}

/**
 * Static scenery: the inside of a spacecraft looking out. A viewport rim
 * (the arena boundary) and hull strut, a polished deck, deep space with a
 * starfield behind the arena, and planets outside, plus all lighting and the
 * reflection probe.
 */
export class Environment {
  readonly ballLight = new THREE.PointLight(0xff7a2a, 0, 12, 2);
  readonly floor: Reflector;
  /** The forest world's scenery; the space scenery below is hidden while it is showing. */
  readonly forest: ForestEnvironment;

  /** Everything that belongs to the space world: backdrop, deck, hull and planets. */
  private readonly space = new THREE.Group();
  private world: WorldId = 'space';
  private shadowsWanted = true;
  private uploadedBackground: THREE.Texture | null = null;
  private backdropAspect = 16 / 9;
  private readonly background = new THREE.Color(0x05070d);

  private readonly shadowLight = new THREE.DirectionalLight(0xfff4ea, 1.25);
  private readonly warmKey = new THREE.DirectionalLight(0xff8a3c, 2.2);
  private readonly coolFill = new THREE.DirectionalLight(0x6f9dff, 1.2);
  private readonly warmPool = new THREE.PointLight(0xff7424, 700, 34, 2);
  private readonly coolPool = new THREE.PointLight(0x3f7dff, 420, 30, 2);
  /** Cold light from above for lightning (themes/weather/rain/RainLayer.ts). Always in the scene, dark until a strike. */
  private readonly lightning = new THREE.DirectionalLight(0xd8e6ff, 0);
  /** Warm light from the wall torches either side, for tomb dust (themes/weather/dust/TombDustLayer.ts). Dark elsewhere. */
  private readonly torchLeft = new THREE.PointLight(0xff8a3a, 0, 34, 2);
  private readonly torchRight = new THREE.PointLight(0xff8a3a, 0, 34, 2);
  private lightningFlash = 0;
  private torchFlare = 0;
  private readonly wallMaterial: THREE.MeshStandardMaterial;
  private readonly floorUniforms: typeof FLOOR_SHADER.uniforms;
  private readonly wallBase = new THREE.Color(WALL_COLOR);
  private readonly wallGoal = new THREE.Color(WALL_COLOR);
  /** Planets and moons, turned very slowly in update(). */
  private readonly planets: THREE.Mesh[] = [];
  private readonly warmBase = new THREE.Color(0xff8a3c);
  private readonly warmGoal = new THREE.Color(0xff8a3c);
  private readonly floaters: THREE.Mesh[] = [];
  private readonly floaterBaseY: number[] = [];

  constructor(
    private readonly scene: THREE.Scene,
    renderer: THREE.WebGLRenderer,
    assets: ForestAssets,
  ) {
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envScene = createStudioEnvScene();
    scene.environment = pmrem.fromScene(envScene, 0.035).texture;
    scene.environmentIntensity = 0.85;
    pmrem.dispose();
    envScene.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        (o.material as THREE.Material).dispose();
      }
    });
    scene.background = this.background;
    scene.add(this.space);
    this.lightning.position.set(-8, 20, 14);
    scene.add(this.lightning);
    this.torchLeft.position.set(-17, 2.5, 3);
    this.torchRight.position.set(17, 2.5, 3);
    scene.add(this.torchLeft, this.torchRight);

    // ------------------------------------------------- space backdrop (wall)
    // Deep space seen through the viewport: a dark plane carrying a static starfield as an emissive map,
    // so stars stay visible (they don't twinkle) while brick glows and soft shadows still land on it.
    const stars = createStarfieldTexture();
    stars.repeat.set(2, 1);
    this.wallMaterial = new THREE.MeshStandardMaterial({
      color: this.wallBase,
      roughness: 0.95,
      metalness: 0,
      envMapIntensity: 0.1,
      emissive: 0xffffff,
      emissiveMap: stars,
      emissiveIntensity: 0.9,
    });
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(150, 70), this.wallMaterial);
    wall.position.set(0, FLOOR_Y + 35, WALL_Z);
    wall.receiveShadow = true;
    this.space.add(wall);

    // --------------------------------------------------------------- floor
    this.floor = new Reflector(new THREE.PlaneGeometry(150, 60), {
      textureWidth: 960,
      textureHeight: 540,
      clipBias: 0.002,
      multisample: 0,
      color: 0x2b3038, // polished cabin deck
      shader: FLOOR_SHADER,
    });
    this.floor.rotation.x = -Math.PI / 2;
    this.floor.position.set(0, FLOOR_Y, WALL_Z + 30);
    this.floorUniforms = (this.floor.material as THREE.ShaderMaterial).uniforms as typeof FLOOR_SHADER.uniforms;
    this.floorUniforms.uWarm.value = new THREE.Color(0.2, 0.08, 0.02);
    this.floorUniforms.uCool.value = new THREE.Color(0.03, 0.06, 0.16);
    // Faint warm spill under the paddle (was ~4x brighter).
    this.floorUniforms.uPaddleGlow.value = new THREE.Color(0.1, 0.035, 0.008);
    this.space.add(this.floor);

    this.createSculptures(this.space);
    this.createLights(scene);
    this.forest = new ForestEnvironment(scene, assets);
  }

  private createSculptures(scene: THREE.Object3D): void {
    const z = new THREE.Vector3(0, 0, 1);
    // Hull metal: brushed blue-grey, soft highlights.
    const hull = new THREE.MeshStandardMaterial({
      color: 0x7d8899,
      roughness: 0.5,
      metalness: 0.55,
      envMapIntensity: 0.6,
    });

    // The viewport rim around the arena, standing in the play plane. Its inner surface IS the physical
    // boundary (see World.moveBall): sides at +/-FIELD.halfWidth, top at FIELD.top, rounded corners of
    // FIELD.cornerRadius. The band's centreline is offset outward by half its thickness.
    const archMaterial = hull;
    const arch = new THREE.Mesh(
      sweptBand(archCurve(ARCH_THICKNESS / 2), ARCH_DEPTH, ARCH_THICKNESS, 260, z),
      archMaterial,
    );
    arch.position.z = ARCH_Z;
    // A broad hull strut sweeping from the top-left corner down to the deck behind it.
    const sweep = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-31, 17, -3.6),
      new THREE.Vector3(-26, 8, -3),
      new THREE.Vector3(-22.4, 0, -2.4),
      new THREE.Vector3(-21.2, -6, -2),
      new THREE.Vector3(-21, FLOOR_Y - 2, -1.9),
    ]);
    const band = new THREE.Mesh(sweptBand(sweep, 5.5, 1.5, 90, z), hull);

    for (const m of [band, arch]) {
      m.castShadow = true;
      m.receiveShadow = true;
      scene.add(m);
    }

    // Planets seen through the viewport, all outside the arch so they never sit behind the play area.
    // Matte, textured and turning very slowly (no glints or pulsing).
    const planetMat = (map: THREE.Texture, rough = 0.85): THREE.MeshStandardMaterial =>
      new THREE.MeshStandardMaterial({ map, roughness: rough, metalness: 0, envMapIntensity: 0.15 });

    // Ringed gas giant (left).
    const giant = new THREE.Mesh(new THREE.SphereGeometry(3, 64, 32), planetMat(createGasGiantTexture()));
    giant.position.set(-20.6, -1.2, -2.2);
    giant.rotation.z = 0.32;
    const ringInner = 3.7;
    const ringOuter = 5.4;
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(ringInner, ringOuter, 128),
      new THREE.MeshStandardMaterial({
        map: createPlanetRingTexture(ringInner, ringOuter),
        transparent: true,
        side: THREE.DoubleSide,
        depthWrite: false,
        roughness: 1,
        metalness: 0,
      }),
    );
    ring.position.copy(giant.position);
    ring.rotation.set(-1.25, 0.18, 0.32);

    // Ocean world with a soft atmosphere (right).
    const ocean = new THREE.Mesh(new THREE.SphereGeometry(3, 64, 32), planetMat(createOceanPlanetTexture(), 0.7));
    ocean.position.set(20.6, -1.8, -2);
    ocean.rotation.z = -0.2;
    const atmosphere = new THREE.Mesh(
      new THREE.SphereGeometry(3.1, 48, 24),
      new THREE.MeshBasicMaterial({
        color: 0x4f8cff,
        transparent: true,
        opacity: 0.06,
        side: THREE.BackSide,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    atmosphere.position.copy(ocean.position);

    // A large cratered moon top right (partly behind the HUD) and a small one below it.
    const moon = new THREE.Mesh(new THREE.SphereGeometry(4.8, 64, 32), planetMat(createMoonTexture(17), 0.95));
    moon.position.set(21, 11.2, -5.4);
    const smallMoon = new THREE.Mesh(new THREE.SphereGeometry(1.0, 40, 24), planetMat(createMoonTexture(23), 0.95));
    // Kept outside the arch frame. (A small white sphere used to float behind the playfield, where it was
    // easily mistaken for the ball; it has been removed.)
    smallMoon.position.set(18.5, 6.4, -3.6);

    for (const m of [giant, ocean, moon, smallMoon]) {
      m.castShadow = true;
      m.receiveShadow = true;
      scene.add(m);
      this.planets.push(m);
    }
    scene.add(ring, atmosphere);
    this.floaters.push(smallMoon);
    this.floaterBaseY.push(smallMoon.position.y);
  }

  private createLights(scene: THREE.Scene): void {
    scene.add(new THREE.HemisphereLight(0xc8d4ea, 0x3a332e, 0.22));

    // Soft shadow caster from above the camera so brick shadows fall slightly below the bricks.
    // High enough that its specular hotspot on the bricks' upper facets lands above the (taller) brick field.
    const key = this.shadowLight;
    key.position.set(-3.5, 22, 34);
    key.target.position.set(0, 0, WALL_Z);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    const cam = key.shadow.camera;
    cam.left = -36;
    cam.right = 36;
    cam.top = 22;
    cam.bottom = -16;
    cam.near = 10;
    cam.far = 70;
    key.shadow.radius = 9;
    key.shadow.blurSamples = 10;
    key.shadow.bias = -0.0004;
    scene.add(key, key.target);

    this.warmKey.position.set(-30, 6, 12);
    this.coolFill.position.set(30, 4, 14);
    this.warmPool.position.set(-24, 0, 6);
    this.coolPool.position.set(24, -2, 6);
    scene.add(this.warmKey, this.coolFill, this.warmPool, this.coolPool, this.ballLight);
  }

  /** Swaps the scenery. Lights stay: they still shade the live objects (pickups, bosses, shards). */
  setWorld(world: WorldId): void {
    if (world === this.world) return;
    this.world = world;
    this.space.visible = !this.uploadedBackground && world === 'space';
    this.forest.group.visible = !this.uploadedBackground && world === 'forest';
    this.background.set(world === 'forest' ? 0x04120c : 0x05070d);
    // Nothing in the forest receives shadows (its scenery is a flat painting), so skip the shadow pass there.
    this.shadowLight.castShadow = this.shadowsWanted && world === 'space' && !this.uploadedBackground;
  }

  /** A world-level uploaded image replaces scenery while live objects retain their lighting. */
  setBackdrop(texture: THREE.Texture | null): void {
    this.uploadedBackground = texture;
    this.resizeBackdrop(this.backdropAspect);
    this.scene.background = texture ?? this.background;
    this.space.visible = !texture && this.world === 'space';
    this.forest.group.visible = !texture && this.world === 'forest';
    this.shadowLight.castShadow = this.shadowsWanted && this.world === 'space' && !texture;
  }

  /**
   * A lightning flash, 0-1: brightens the uploaded backdrop and lights the playfield from above. Kept
   * moderate so the ball still stands out at the peak of a flash.
   */
  setLightning(flash: number): void {
    this.lightningFlash = flash;
    this.lightning.intensity = flash * 3.8;
    this.applyBackgroundIntensity();
  }

  /**
   * The tomb's wall torches (themes/weather/dust/TombDustLayer.ts): `left` and `right` are each torch's light, about 0.4-1.4
   * (0 turns them off), and `flare` 0-1 how bright a torch flare is, which also warms the backdrop a little.
   */
  setTorches(left: number, right: number, flare: number): void {
    this.torchLeft.intensity = left * TORCH_LIGHT;
    this.torchRight.intensity = right * TORCH_LIGHT;
    this.torchFlare = flare;
    this.applyBackgroundIntensity();
  }

  private applyBackgroundIntensity(): void {
    this.scene.backgroundIntensity = 1 + this.lightningFlash * 1.15 + this.torchFlare * 0.05;
  }

  /** Cover the adaptive 16:9–4:3 stage without stretching the uploaded artwork. */
  resizeBackdrop(aspect: number): void {
    this.backdropAspect = aspect;
    const texture = this.uploadedBackground;
    if (!texture) return;
    const image = texture.image as { width: number; height: number };
    const imageAspect = image.width / image.height;
    const x = Math.min(1, aspect / imageAspect);
    const y = Math.min(1, imageAspect / aspect);
    texture.repeat.set(x, y);
    texture.offset.set((1 - x) / 2, (1 - y) / 2);
  }

  prewarm(gl: THREE.WebGLRenderer): void {
    this.forest.prewarm(gl);
  }

  setShadows(enabled: boolean, mapSize: number): void {
    this.shadowsWanted = enabled;
    this.shadowLight.castShadow = enabled && this.world === 'space' && !this.uploadedBackground;
    if (this.shadowLight.shadow.mapSize.x !== mapSize) {
      this.shadowLight.shadow.mapSize.set(mapSize, mapSize);
      this.shadowLight.shadow.map?.dispose();
      this.shadowLight.shadow.map = null;
    }
  }

  setReflectionSize(width: number, height: number): void {
    this.floor.getRenderTarget().setSize(Math.max(64, Math.round(width)), Math.max(36, Math.round(height)));
    (this.floorUniforms.uTexel.value as [number, number])[0] = 1 / Math.max(64, width);
    (this.floorUniforms.uTexel.value as [number, number])[1] = 1 / Math.max(36, height);
  }

  /** Subtle per-level mood: the wall cools or warms slightly; boss stages run hotter and darker. */
  setTheme(hue: number, boss: boolean, immediate = false): void {
    const hsl = { h: 0, s: 0, l: 0 };
    new THREE.Color(WALL_COLOR).getHSL(hsl);
    this.wallGoal.setHSL(boss ? 0.97 : (hsl.h * 0.8 + hue * 0.2) % 1, boss ? 0.12 : hsl.s, boss ? hsl.l * 0.78 : hsl.l);
    this.warmGoal.set(boss ? 0xff5a2e : 0xff8a3c);
    if (immediate) {
      this.wallBase.copy(this.wallGoal);
      this.warmBase.copy(this.warmGoal);
    }
    this.forest.setMood(boss, immediate);
  }

  update(dt: number, time: number, paddleX: number): void {
    const k = 1 - Math.exp(-2 * dt);
    this.wallBase.lerp(this.wallGoal, k);
    this.warmBase.lerp(this.warmGoal, k);
    this.wallMaterial.color.copy(this.wallBase);
    this.warmKey.color.copy(this.warmBase);
    this.warmPool.color.copy(this.warmBase);
    // Steady key light (it used to pulse with the music's kick drum).
    this.warmPool.intensity = 700;
    this.floorUniforms.uPaddleX.value = paddleX;

    // Planets turn very slowly (one revolution every ~3-5 minutes).
    for (let i = 0; i < this.planets.length; i++) this.planets[i].rotation.y += dt * (0.02 + i * 0.006);

    for (let i = 0; i < this.floaters.length; i++) {
      this.floaters[i].position.y = this.floaterBaseY[i] + Math.sin(time * (0.6 + i * 0.23) + i * 2) * 0.25;
    }
    if (this.world === 'forest') this.forest.update(dt);
  }
}
