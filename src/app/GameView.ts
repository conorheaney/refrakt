import * as THREE from 'three';
import { DROP } from '../gameplay/config';
import { POWERUPS } from '../gameplay/powerups/powerUps';
import type { WeatherId, WorldId } from '../content/worlds';
import { areaSegments } from '../gameplay/arena/playAreas';
import { clamp, damp, lerp } from '../engine/core/math';
import { BrickKind, PowerUpKind, type Brick } from '../gameplay/types';
import type { World } from '../gameplay/World';
import { STAGE_ASPECT } from '../engine/Stage';
import { BrickView } from '../gameplay/bricks/BrickView';
import { CameraRig } from '../gameplay/CameraRig';
import { DebrisSystem } from '../gameplay/bricks/DebrisSystem';
import {
  BallsView,
  BossView,
  DropsView,
  ImpactFlashPool,
  LasersView,
  PaddleView,
  ShieldView,
  ShockwavePool,
  ShotsView,
} from '../gameplay/entities/EntityViews';
import { Environment } from '../themes/scenery/Environment';
import {
  createForgeArmorGeometry,
  createForgeExplosiveGeometry,
  createForgePrototypeMaterials,
} from '../themes/blocks/forge/forgeBlocks';
import type { ForestAssets } from '../themes/scenery/forest/assets';
import { ParticleSystem } from '../engine/render/ParticleSystem';
import { RainLayer } from '../themes/weather/rain/RainLayer';
import { SnowLayer } from '../themes/weather/snow/SnowLayer';
import { TombDustLayer } from '../themes/weather/dust/TombDustLayer';
import { IcicleView } from '../gameplay/hazards/icicles/IcicleView';
import { SnakesView } from '../gameplay/hazards/snakes/SnakeView';
import { ScarabView, SCARAB_Z } from '../gameplay/hazards/scarabs/ScarabView';
import { ScarabSystem } from '../gameplay/hazards/scarabs/scarabs';
import { createGlowTexture } from '../engine/render/textures';
import { RefraktFx } from '../gameplay/refrakt/RefraktFx';
import { BAND_Y, PADDLE_POWERS } from '../gameplay/entities/PaddlePowers';

const CELEBRATE_HUES: readonly number[] = [0.07, 0.6, 0.93];

/**
 * Presentation layer. Mirrors simulation state into the Three.js scene each
 * frame (with interpolation) and turns simulation events into VFX. It never
 * mutates the World.
 */
export class GameView {
  readonly scene = new THREE.Scene();
  readonly rig = new CameraRig();
  /** Scales how strong camera sway on impacts is (attract mode uses a calmer value). */
  intensity = 1;

  private readonly env: Environment;
  private readonly bricks: BrickView;
  private worldId: WorldId = 'space';
  private backdropOutline: THREE.Group | null = null;
  private readonly balls: BallsView;
  private readonly paddle: PaddleView;
  private readonly drops: DropsView;
  private readonly lasers: LasersView;
  private readonly shots: ShotsView;
  private readonly boss: BossView;
  private readonly shield: ShieldView;
  private readonly snakes: SnakesView;
  private readonly venomGreen = new THREE.Color(0x6dff3a);
  private readonly shockwaves: ShockwavePool;
  private readonly flashes: ImpactFlashPool;
  private readonly refrakt: RefraktFx;
  private readonly particles = new ParticleSystem(5000);
  /** Coloured dust blended over the scene (a crushed scarab's red puff). */
  private readonly dustPuffs = new ParticleSystem(400, 'dust');
  private readonly debris = new DebrisSystem(420);
  private readonly rain: RainLayer;
  private readonly snow: SnowLayer;
  private readonly dust: TombDustLayer;
  private readonly icicles: IcicleView;
  private readonly scarabs: ScarabView;
  private readonly iceBlue = new THREE.Color(0.75, 0.9, 1);

  private readonly tmp = new THREE.Color();
  private readonly white = new THREE.Color(1, 1, 1);
  private readonly warmWhite = new THREE.Color(1, 0.82, 0.6);
  private readonly spark = new THREE.Color(1, 0.62, 0.25);
  private readonly orange = new THREE.Color(0xff7a1a);
  private readonly red = new THREE.Color(0xff3040);
  private readonly chromeShard = new THREE.Color(0.75, 0.78, 0.82);
  private readonly ballLightFire = new THREE.Color(0xff7a2a);
  private clock = 0;
  private bufferHeight = 1080;
  private celebrate = 0;
  private celebrateTimer = 0;

  constructor(
    private readonly world: World,
    gl: THREE.WebGLRenderer,
    assets: ForestAssets,
    private readonly backgrounds: ReadonlyMap<number, THREE.Texture> = new Map(),
    /**
     * `debugArena` (`?debugArena`, see app/launchOptions.ts): draws the walls the ball bounces off (the world's drawn
     * ball area, drain left out) over the scene, so they can be checked against the scenery.
     */
    private readonly options: { readonly debugArena?: boolean } = {},
  ) {
    const scene = this.scene;
    const glow = createGlowTexture();
    this.env = new Environment(scene, gl, assets);
    this.rain = new RainLayer(scene);
    this.snow = new SnowLayer(scene);
    this.dust = new TombDustLayer(scene);
    this.dust.onRumble = (...args) => this.onRumble(...args);
    this.dust.onFlare = (side, strength) => this.onTorchFlare(side, strength);
    this.bricks = new BrickView(scene, {
      textures: assets.forge,
      armorGeometry: createForgeArmorGeometry,
      explosiveGeometry: createForgeExplosiveGeometry,
      prototypeMaterials: createForgePrototypeMaterials,
    });
    this.balls = new BallsView(scene);
    this.paddle = new PaddleView(scene);
    this.drops = new DropsView(scene, DROP.capacity, glow);
    this.lasers = new LasersView(scene);
    this.shots = new ShotsView(scene, glow);
    this.boss = new BossView(scene);
    this.shield = new ShieldView(scene);
    this.snakes = new SnakesView(scene);
    this.icicles = new IcicleView(scene);
    this.scarabs = new ScarabView(scene);
    // (Scarabs hide behind the scenery by a shader discard, not clipping planes: see ScarabView.ts.)
    // Room for Refrakt's ring cascades on top of ordinary hits.
    this.shockwaves = new ShockwavePool(scene, 24);
    // Soft round glow (no hot core or rays) so hit feedback reads as a gentle bloom, not a strobe.
    this.flashes = new ImpactFlashPool(scene, glow, 16);
    // Sparks are additive, so they go last.
    this.particles.points.renderOrder = 8;
    this.dustPuffs.points.renderOrder = 8;
    scene.add(this.particles.points, this.dustPuffs.points, this.debris.mesh);
    this.refrakt = new RefraktFx(scene, glow, this.shockwaves, this.flashes, this.particles, this.debris);
    this.rig.setAspect(STAGE_ASPECT);
    this.bindEvents();
  }

  /**
   * Compiles every material up front, including pooled objects that start
   * hidden (drops, shards, flashes, boss), so first use never hitches.
   */
  prewarm(gl: THREE.WebGLRenderer): void {
    const hidden: THREE.Object3D[] = [];
    this.scene.traverse((o) => {
      if (!o.visible) {
        hidden.push(o);
        o.visible = true;
      }
    });
    gl.compile(this.scene, this.rig.camera);
    for (const o of hidden) o.visible = false;
    this.env.prewarm(gl);
    for (const texture of this.backgrounds.values()) gl.initTexture(texture);
  }

  /** Refrakt's screen-wide light (edge spectrum, colour split), for the renderer's final pass. */
  get refraktScreen(): { readonly screenGlow: number; readonly chroma: number; readonly hue: number } {
    return this.refrakt;
  }

  /** Called on each lightning strike in a rainy world, for the thunder (see RainLayer.onThunder). */
  set onThunder(fn: (delay: number, strength: number) => void) {
    this.rain.onThunder = fn;
  }

  /** Called when a level loads, with its world's weather (for the weather sound). */
  onWeather: (weather: WeatherId | undefined) => void = () => {};

  /**
   * Called every frame with the snow's current gust strength (0-1, always 0 outside snowy worlds), so the
   * wind sound can follow the wind on screen.
   */
  onSnowFrame: (realDt: number, simDt: number, gust: number) => void = () => {};

  /** Tomb dust (themes/weather/dust/TombDustLayer.ts): called every frame while it is showing, for the torch crackles. */
  onDustFrame: (realDt: number, simDt: number) => void = () => {};
  /** Tomb dust: as a rumble is coming (strength 0-1; see TombDustLayer.onRumble for the timing). */
  onRumble: (strength: number, lead: number, rise: number, hold: number, fall: number) => void = () => {};
  /** Tomb dust: as a torch flares (side -1 left, 1 right, 0 both; strength 0-1). */
  onTorchFlare: (side: -1 | 0 | 1, strength: number) => void = () => {};

  /** Switches what differs between worlds: the scenery, the arena's width and the camera framing. */
  setWorld(id: WorldId): void {
    if (id === this.worldId) return;
    this.worldId = id;
    this.env.setWorld(id);
    this.paddle.setWorld(id);
    // Each world frames the arena with its own lens; point sizes follow the field of view.
    this.rig.setWorld(id);
    this.bricks.flatView = this.rig.isFlat;
    this.particles.setViewport(this.bufferHeight, this.rig.fov);
    this.dustPuffs.setViewport(this.bufferHeight, this.rig.fov);
    this.snow.setViewport(this.bufferHeight, this.rig.fov);
    this.dust.setViewport(this.bufferHeight, this.rig.fov);
  }

  /** Shard and spark tint for a brick. */
  private brickColor(brick: Brick, time: number, out: THREE.Color): THREE.Color {
    return this.bricks.colorOf(brick, time, out);
  }

  setShadows(enabled: boolean, mapSize: number): void {
    this.env.setShadows(enabled, mapSize);
  }

  resize(aspect: number, bufferWidth: number, bufferHeight: number, reflectionScale: number): void {
    this.rig.setAspect(aspect);
    this.env.resizeBackdrop(aspect);
    this.bufferHeight = bufferHeight;
    this.particles.setViewport(bufferHeight, this.rig.fov);
    this.dustPuffs.setViewport(bufferHeight, this.rig.fov);
    this.snow.setViewport(bufferHeight, this.rig.fov);
    this.dust.setViewport(bufferHeight, this.rig.fov);
    this.dust.setAspect(aspect);
    this.env.setReflectionSize(bufferWidth * reflectionScale, bufferHeight * reflectionScale);
  }

  /** Small camera sway for rare, significant events only (no zoom punch or colour fringing). */
  /**
   * Icicle effects that run every frame (simulation time, so they freeze with everything else): powdery snow
   * sifting from the ceiling above a cracking icicle (its warning), and a faint trail of frost glinting off
   * one as it falls.
   */
  private icicleDust(dt: number): void {
    if (dt <= 0) return;
    const world = this.world;
    const p = this.particles;
    for (const c of world.icicles.items) {
      if (c.state === 'falling') {
        const count = Math.floor(22 * dt + Math.random());
        const mid = c.def.y - c.drop - c.def.length * 0.5;
        for (let n = 0; n < count; n++) {
          p.emit(
            c.def.x + (Math.random() - 0.5) * 0.35,
            mid + (Math.random() - 0.5) * c.def.length,
            0.6,
            (Math.random() - 0.5) * 0.3,
            0.4 + Math.random() * 0.4,
            0,
            0.6,
            0.72,
            0.82,
            0.05 + Math.random() * 0.05,
            0.3 + Math.random() * 0.25,
            2,
            0,
          );
        }
        continue;
      }
      if (c.state !== 'warn') continue;
      const count = Math.floor(28 * dt + Math.random());
      for (let n = 0; n < count; n++) {
        p.emit(
          c.def.x + (Math.random() - 0.5) * 0.5,
          c.def.y - 0.1,
          0.6,
          (Math.random() - 0.5) * 0.4,
          -0.5 - Math.random(),
          0,
          0.5,
          0.56,
          0.62,
          0.1 + Math.random() * 0.08,
          0.6 + Math.random() * 0.4,
          0.5,
          2,
        );
      }
    }
  }

  private impact(trauma: number): void {
    this.rig.addTrauma(trauma * this.intensity);
  }

  /** Where the ball met the brick: the closest point on the brick to the nearest ball (or the centre). */
  private impactPoint(brick: Brick, out: THREE.Vector2): THREE.Vector2 {
    let best = Infinity;
    out.set(brick.x, brick.y);
    for (const ball of this.world.balls.items) {
      if (!ball.active) continue;
      const d = Math.hypot(ball.x - brick.x, ball.y - brick.y);
      if (d < best && d < this.world.grid.cellW * 1.5) {
        best = d;
        out.set(
          clamp(ball.x, brick.x - this.world.grid.halfW, brick.x + this.world.grid.halfW),
          clamp(ball.y, brick.y - this.world.grid.halfH, brick.y + this.world.grid.halfH),
        );
      }
    }
    return out;
  }

  private bindEvents(): void {
    const ev = this.world.events;
    const world = this.world;
    const p = this.particles;
    const tmp = this.tmp;
    const hitPoint = new THREE.Vector2();

    ev.on('levelLoaded', ({ index, boss }) => {
      this.refrakt.clear();
      const campaign = world.campaign;
      const def = campaign.worldDefAt(index);
      const changed = def.id !== this.worldId;
      this.setWorld(def.id);
      const backdrop = this.backgrounds.get(campaign.worldIndexOf(index)) ?? null;
      this.env.setBackdrop(backdrop);
      const weather = def.weather;
      this.rain.setActive(weather === 'rain');
      this.snow.setActive(weather === 'snow');
      this.dust.setActive(weather === 'dust', campaign.worldAt(index).dustLine);
      // With scarab nests, the dust storms come only with the scarabs (the tombGate event below).
      this.dust.autoRumble = world.scarabs.nests.length === 0;
      this.onWeather(weather);
      if (this.backdropOutline) {
        this.scene.remove(this.backdropOutline);
        this.backdropOutline.traverse((object) => {
          if (object instanceof THREE.Line) {
            object.geometry.dispose();
            const materials = Array.isArray(object.material) ? object.material : [object.material];
            materials.forEach((material) => material.dispose());
          }
        });
        this.backdropOutline = null;
      }
      const area = campaign.worldAt(index).playAreas.ball;
      // Collision guides are opt-in diagnostics. The editor owns its editable SVG guides separately.
      if (this.options.debugArena) {
        this.backdropOutline = new THREE.Group();
        const points = areaSegments(area, area.drainEdge)
          .filter((segment) => !segment.drain)
          .flatMap(({ a, b }) => [new THREE.Vector3(a.x, a.y, 0), new THREE.Vector3(b.x, b.y, 0)]);
        this.backdropOutline.add(
          new THREE.LineSegments(
            new THREE.BufferGeometry().setFromPoints(points),
            new THREE.LineBasicMaterial({ color: 0xb1e5ed, transparent: true, opacity: 0.55 }),
          ),
        );
        this.scene.add(this.backdropOutline);
      }
      this.env.setTheme(campaign.level(index).hue, boss, changed);
      this.celebrate = 0;
    });

    // Effects below are deliberately calm: few particles, low gain, soft glows and no full-screen effects.
    ev.on('brickHit', ({ brick, x, y, nx, ny }) => {
      if (brick.kind === BrickKind.Steel) {
        p.sparks(x, y, nx, ny, this.white, 4, 8);
        this.flashes.spawn(x, y, 1.2, 0.3, 0.3);
      } else {
        p.sparks(x, y, nx, ny, this.spark, 4, 7);
        this.flashes.spawn(x, y, 1.4, 0.3, 0.35);
        if (brick.kind === BrickKind.Tough || brick.kind === BrickKind.Armored) {
          this.debris.spawn(x, y, this.brickColor(brick, world.time, tmp), 2, 4, 0.3, 0.2, nx, ny, 0.5);
        }
      }
    });

    ev.on('brickDestroyed', ({ brick, cause }) => {
      this.brickColor(brick, world.time, tmp);
      const chained = cause === 'explosion';
      const at = cause === 'ball' ? this.impactPoint(brick, hitPoint) : hitPoint.set(brick.x, brick.y);
      let pushX = 0;
      let pushY = 0;
      for (const ball of world.balls.items) {
        if (
          ball.active &&
          Math.abs(ball.x - brick.x) < world.grid.cellW * 1.5 &&
          Math.abs(ball.y - brick.y) < world.grid.cellH * 2
        ) {
          pushX = -ball.dx;
          pushY = -ball.dy;
          break;
        }
      }
      this.debris.spawn(
        brick.x,
        brick.y,
        tmp,
        chained ? 3 : 6,
        chained ? 5 : 4.5,
        world.grid.halfW * 0.8,
        world.grid.halfH * 0.7,
        pushX,
        pushY,
        1.1,
      );
      p.burst(brick.x, brick.y, tmp, chained ? 4 : 6, 5, 0.3, 0.45, 0.8);
      if (!chained) {
        this.flashes.spawn(at.x, at.y, 2, 0.4, 0.4);
        p.sparks(at.x, at.y, pushX || 0, pushY || 1, this.warmWhite, 6, 9);
      }
    });

    ev.on('brickSpawned', ({ brick }) => {
      p.burst(brick.x, brick.y, this.brickColor(brick, world.time, tmp), 6, 4, 0.3, 0.45, 0.8);
    });

    ev.on('explosion', ({ x, y }) => {
      this.shockwaves.spawn(x, y, this.orange, 2.8, 0.6);
      this.flashes.spawn(x, y, 3.2, 0.5, 0.5);
      p.burst(x, y, this.orange, 16, 10, 0.45, 0.6, 1);
      this.impact(0.12);
    });

    ev.on('ballWall', ({ x, y, nx, ny }) => {
      // The arch frame is the wall; a tiny spark puff is the only feedback (no glowing rail lines).
      p.sparks(x, y, nx, ny, this.white, 2, 5);
    });

    ev.on('ballPaddle', ({ x, y }) => {
      p.sparks(x, y, 0, 1, this.spark, 4, 6);
    });

    // Refrakt (gameplay/refrakt/RefraktFx.ts): the prism's light bursts into a spectrum, every shattered brick
    // throws a fan of it, and the ball lets it go when the time runs out.
    ev.on('refraktStarted', ({ x, y }) => {
      this.refrakt.start(x, y);
      this.impact(0.38);
    });

    ev.on('refraktBurst', ({ x, y, dirX, dirY }) => {
      this.refrakt.shatter(x, y, dirX, dirY);
      this.impact(0.08);
    });

    ev.on('refraktEnded', ({ cut }) => {
      if (!cut) this.refrakt.end(world.balls.items);
    });

    ev.on('ballsSplit', ({ x, y }) => {
      this.shockwaves.spawn(x, y, this.white, 1.8, 0.5);
      p.burst(x, y, tmp.setHSL(0.6, 0.6, 0.65), 8, 7, 0.35, 0.5, 0.9);
    });

    ev.on('ballLost', ({ x }) => {
      p.burst(x, world.shieldY + 0.2, this.white, 8, 4, 0.35, 0.5, 0.8);
    });

    ev.on('lifeLost', () => {
      p.burst(world.paddle.x, world.paddle.y, this.red, 20, 8, 0.45, 0.8, 1);
      this.debris.spawn(world.paddle.x, world.paddle.y, this.chromeShard, 8, 6, world.paddle.width / 2, 0.3, 0, 1);
      this.shockwaves.spawn(world.paddle.x, world.paddle.y, this.red, 3.5, 0.8);
      this.impact(0.25);
    });

    ev.on('powerUpCollected', ({ kind, x, y }) => {
      tmp.set(POWERUPS[kind].color);
      this.shockwaves.spawn(x, y, tmp, 1.8, 0.55);
      p.burst(x, y, tmp, 10, 6, 0.35, 0.55, 0.9);
    });

    // A paddle power ran out: its glyph bursts on the paddle's front face (PaddlePowers) and throws sparks.
    ev.on('powerUpExpired', ({ kind }) => {
      if (!PADDLE_POWERS.includes(kind)) return;
      const px = world.paddle.x + this.paddle.powers.slotX(kind);
      p.burst(px, world.paddle.y + BAND_Y, tmp.set(POWERUPS[kind].color), 12, 4.5, 0.25, 0.45, 0.6);
    });

    ev.on('shieldHit', ({ x, charges }) => {
      this.shield.pulse(x);
      // Cyan while strands remain; the last one going out throws amber.
      tmp.set(charges > 0 ? 0x7df6ff : 0xffb04a);
      p.sparks(x, world.shieldY + 0.1, 0, 1, tmp, 14, 9);
      this.shockwaves.spawn(x, world.shieldY, tmp, 1.6, 0.4);
      // The spent strand sheds sparks along its length as it drains.
      const left = world.shieldLeft;
      const span = world.shieldRight - left;
      for (let i = 0; i < 8; i++) p.sparks(left + (span * (i + 0.5)) / 8, world.shieldY, 0, 1, tmp, 2, 3);
    });

    ev.on('laserHit', ({ x, y }) => {
      p.sparks(x, y, 0, -1, this.spark, 3, 6);
    });

    ev.on('bossHit', ({ x, y }) => {
      p.sparks(x, y, x - world.boss.x, y - world.boss.y, this.warmWhite, 6, 9);
      this.flashes.spawn(x, y, 1.8, 0.35, 0.35);
    });

    ev.on('bossStage', () => {
      this.shockwaves.spawn(world.boss.x, world.boss.y, this.red, 5, 0.9);
      p.burst(world.boss.x, world.boss.y, this.red, 30, 12, 0.5, 0.8, 1);
      this.impact(0.2);
    });

    ev.on('bossFired', ({ x, y }) => {
      p.burst(x, y, tmp.set(0xff3d5e), 4, 4, 0.3, 0.3, 1);
    });

    ev.on('bossDefeated', ({ x, y }) => {
      this.boss.startDeath();
      this.shockwaves.spawn(x, y, this.white, 7, 1.2);
      this.flashes.spawn(x, y, 4, 0.9, 0.5);
      this.impact(0.3);
    });

    ev.on('paddleStunned', ({ x }) => {
      p.burst(x, world.paddle.y, this.red, 12, 7, 0.4, 0.45, 1);
      this.impact(0.12);
    });

    ev.on('paddleBitten', ({ x, y }) => {
      p.burst(x, y, this.venomGreen, 14, 6, 0.35, 0.5, 1);
      this.flashes.spawn(x, y, 1.6, 0.35, 0.5);
      this.impact(0.1);
    });

    // Icicles: a spray of ice shards when one breaks, and a bigger one when one smashes on the paddle.
    ev.on('icicleShatter', ({ x, y, byBall }) => {
      p.burst(x, y, this.iceBlue, byBall ? 18 : 14, byBall ? 7 : 5, 0.32, 0.55, 1);
      if (byBall) this.flashes.spawn(x, y, 1.2, 0.25, 0.4);
    });
    // Knocked off the ceiling: a cold flash where it snaps from the stone, chunks of ice and glinting
    // splinters thrown out sideways, and a cloud of frost and snow shaken loose from the lintel.
    ev.on('icicleKnocked', ({ x, y }) => {
      const root = y - 0.12;
      this.flashes.spawn(x, root, 1.7, 0.3, 1.6);
      this.debris.spawn(x, root, this.iceBlue, 6, 4.5, 0.25, 0.08, 0, -0.4, 0.35);
      p.sparks(x, root, -1, -0.15, this.iceBlue, 5, 6);
      p.sparks(x, root, 1, -0.15, this.iceBlue, 5, 6);
      for (let n = 0; n < 14; n++) {
        // Bright glints that hang in the air a moment.
        p.emit(
          x + (Math.random() - 0.5) * 0.5,
          root + (Math.random() - 0.5) * 0.2,
          0.7,
          (Math.random() - 0.5) * 3,
          Math.random() * 1.5 - 0.5,
          0,
          0.9,
          1,
          1.1,
          0.06 + Math.random() * 0.06,
          0.4 + Math.random() * 0.4,
          2.5,
          3,
        );
      }
      for (let n = 0; n < 30; n++) {
        // Powder snow spilling from the lintel and drifting down.
        const spread = (Math.random() - 0.5) * 1.4;
        p.emit(
          x + spread,
          y + Math.random() * 0.1,
          0.55,
          spread * 1.2,
          -0.2 - Math.random() * 1.4,
          0,
          0.55,
          0.6,
          0.66,
          0.1 + Math.random() * 0.14,
          0.7 + Math.random() * 0.6,
          1.2,
          1.5,
        );
      }
      this.impact(0.04);
    });
    ev.on('paddleStruck', ({ x, y }) => {
      p.burst(x, y, this.iceBlue, 22, 7, 0.34, 0.55, 1.1);
      this.flashes.spawn(x, y, 1.4, 0.25, 0.4);
      this.impact(0.1);
    });

    // Scarabs (gameplay/hazards/scarabs/scarabs.ts): sand kicked up as they climb on, leap, land or get scared off; a puff of red dust
    // thrown up into the air when the ball crushes one.
    const sandPuff = (x: number, y: number, count: number, up: number): void => {
      const c = ScarabView.sand;
      for (let n = 0; n < count; n++) {
        p.emit(
          x + (Math.random() - 0.5) * 0.5,
          y + Math.random() * 0.1,
          SCARAB_Z,
          (Math.random() - 0.5) * 2.4,
          up * (0.4 + Math.random()),
          0,
          c.r,
          c.g,
          c.b,
          0.07 + Math.random() * 0.08,
          0.4 + Math.random() * 0.4,
          2,
          4,
        );
      }
    };
    ev.on('tombGate', ({ duration }) => this.dust.storm(duration));
    ev.on('scarabCling', ({ x, y }) => {
      sandPuff(x, y, 6, 1.2);
    });
    ev.on('scarabCrushed', ({ x, y }) => {
      // The shell bursts: a cloud of red and brown shell dust blown out all round, billowing outwards and
      // hanging in the air before it thins away, finer grit flung higher through it, and a few shell chips.
      const red = ScarabView.redDust;
      const brown = ScarabView.brownDust;
      const cloud = (
        count: number,
        size: number,
        speed: number,
        lift: number,
        life: number,
        browner: number,
        gravity: number,
      ): void => {
        for (let n = 0; n < count; n++) {
          // Out in every direction across the play plane, mostly sideways and up (the paddle is under it).
          const a = Math.PI * (0.05 + 0.9 * Math.random());
          const v = speed * (0.35 + 0.65 * Math.random());
          const c = Math.random() < browner ? brown : red;
          const shade = 0.8 + Math.random() * 0.45;
          this.dustPuffs.emit(
            x + (Math.random() - 0.5) * 0.6,
            y + 0.2 + Math.random() * 0.2,
            SCARAB_Z + (Math.random() - 0.5) * 0.5,
            Math.cos(a) * v,
            Math.sin(a) * v * 0.8 + lift,
            (Math.random() - 0.5) * 1.6,
            c.r * shade,
            c.g * shade,
            c.b * shade,
            size * (0.7 + Math.random() * 0.6),
            life * (0.8 + Math.random() * 0.4),
            4,
            gravity,
          );
        }
      };
      cloud(36, 1.1, 5, 0.6, 1.6, 0.35, 0.3);
      cloud(24, 0.6, 8, 1, 1.2, 0.25, 0.8);
      cloud(40, 0.18, 11, 3.5, 0.8, 0.15, 4);
      this.debris.spawn(x, y + 0.25, ScarabView.redDust, 8, 5, 0.35, 0.15, 0, 1, 0.35);
      this.flashes.spawn(x, y + 0.3, 1.1, 0.18, 0.35);
      this.impact(0.05);
    });
    ev.on('scarabLeap', ({ x, y, fly }) => {
      // Kicked back as it springs off; a flyer's wings blow a fan of grit off the floor.
      sandPuff(x, y, fly ? 10 : 5, fly ? 1.4 : 1);
    });
    ev.on('scarabSwatted', ({ x, y }) => {
      // Smacked out of the air by the ball.
      this.flashes.spawn(x, y, 0.8, 0.15, 0.3);
      this.debris.spawn(x, y, ScarabView.sand, 3, 3, 0.25, 0.3, 0, 0, 0.3);
    });
    ev.on('scarabLand', ({ x, y, fly }) => {
      sandPuff(x, y, fly ? 9 : 7, 1.3);
    });
    ev.on('scarabScared', ({ x, y }) => {
      this.debris.spawn(x, y, ScarabView.sand, 5, 3.5, 0.3, 0.3, 0, -0.2, 0.3);
      this.flashes.spawn(x, y, 1.2, 0.25, 0.6);
      this.impact(0.04);
      for (const nest of world.scarabs.nests) {
        if (nest.state !== 'scared') continue;
        // A burst of sand where it was coming out.
        const foot = ScarabSystem.foot(nest);
        sandPuff(foot.x, foot.y, 18, 2.2);
      }
    });

    ev.on('levelCleared', () => {
      this.celebrate = 1.6;
      this.celebrateTimer = 0;
    });
  }

  /**
   * @param realDt wall-clock frame time (camera, UI-ish motion)
   * @param simDt  simulation time elapsed this frame (0 while paused / in hit-stop)
   * @param fxDt   time for the effects (sparks, rings, flashes, shards, Refrakt's light): simulation time,
   *               except during a hit-stop, when they play on while the game holds still
   * @param alpha  interpolation factor between the last two simulation steps
   */
  update(realDt: number, simDt: number, alpha: number, fxDt = simDt): void {
    const world = this.world;
    this.clock += realDt;

    this.bricks.update(world);
    this.balls.update(world, alpha, simDt, this.particles);
    this.paddle.update(world, alpha, realDt);
    this.drops.update(world, alpha);
    this.lasers.update(world, alpha);
    this.shots.update(world, alpha, simDt, this.particles);
    this.boss.update(world, alpha, simDt, this.particles);
    this.shield.update(world, realDt);
    this.snakes.update(world, alpha);
    this.icicles.update(world, alpha);
    this.scarabs.update(world, alpha, simDt, this.particles);
    this.shockwaves.update(fxDt);
    this.flashes.update(fxDt);
    this.refrakt.update(fxDt, realDt, world.refraktActive, this.balls.refraktHue, (i) => this.balls.positionOf(i));

    // Level-clear: a few slow, soft confetti puffs (no flashes).
    if (this.celebrate > 0) {
      this.celebrate -= realDt;
      this.celebrateTimer -= realDt;
      if (this.celebrateTimer <= 0) {
        this.celebrateTimer = 0.45;
        // Spread over the middle of the ball area, between the paddle's floor and the area's top.
        const { left, right, top } = world.boundary.bounds;
        const floor = world.shieldY;
        const x = (left + right) / 2 + (Math.random() - 0.5) * (right - left) * 0.7;
        const y = floor + (top - floor) * (0.35 + Math.random() * 0.45);
        this.tmp.setHSL(CELEBRATE_HUES[Math.floor(Math.random() * CELEBRATE_HUES.length)], 0.7, 0.6);
        this.particles.burst(x, y, this.tmp, 14, 6, 0.4, 1, 0.9);
      }
    }

    this.rain.splash(simDt, world, this.particles);
    this.snow.spindrift(simDt, world, this.particles);
    this.icicleDust(simDt);
    this.particles.update(fxDt);
    this.dustPuffs.update(fxDt);
    this.debris.update(fxDt, world.shieldY);

    // Fire-ball glow: fades in and out and glides between balls (it used to snap on/off and teleport to
    // whichever ball was lowest, which flickered during multiball).
    const light = this.env.ballLight;
    const refraktOn = this.balls.hasFocus && world.refraktActive;
    const fireOn = this.balls.hasFocus && (refraktOn || world.hasEffect(PowerUpKind.Fire));
    if (this.balls.hasFocus) {
      const k = light.intensity > 0.01 ? 1 - Math.exp(-12 * realDt) : 1;
      light.position.x += (this.balls.focusX - light.position.x) * k;
      light.position.y += (this.balls.focusY - light.position.y) * k;
      light.position.z = 1.2;
    }
    light.intensity = damp(light.intensity, refraktOn ? 24 : fireOn ? 14 : 0, 6, realDt);
    if (light.intensity < 0.01) light.intensity = 0;
    if (refraktOn) light.color.setHSL(this.balls.refraktHue, 0.9, 0.6);
    else light.color.copy(this.ballLightFire);

    const paddleX = lerp(world.paddle.px, world.paddle.x, alpha);
    this.env.update(realDt, this.clock, paddleX);
    this.rain.update(realDt, simDt);
    this.env.setLightning(this.rain.flash);
    this.snow.update(realDt);
    if (this.snow.active) this.onSnowFrame(realDt, simDt, this.snow.gust);
    this.dust.setStirrers(
      this.balls.hasFocus ? { x: this.balls.focusX, y: this.balls.focusY } : null,
      paddleX,
      world.paddle.y,
      world.paddle.width / 2,
    );
    this.dust.update(realDt, simDt);
    const dusty = this.dust.active;
    this.env.setTorches(dusty ? this.dust.torches.x : 0, dusty ? this.dust.torches.y : 0, this.dust.flare);
    if (dusty) {
      this.onDustFrame(realDt, simDt);
      // A rumble keeps a light shake going while it lasts (none with reduced motion).
      if (this.dust.rumble > 0.05 && !reducedMotion()) this.rig.holdTrauma(0.42 * this.dust.rumble * this.intensity);
    }
    this.rig.update(realDt);
  }
}

function reducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}
