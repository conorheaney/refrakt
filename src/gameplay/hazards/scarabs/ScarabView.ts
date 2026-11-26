import * as THREE from 'three';
import { PADDLE, SCARAB } from '../../config';
import { lerp } from '../../../engine/core/math';
import { ScarabSystem, type Nest, type Scarab } from './scarabs';
import type { Paddle } from '../../types';
import type { World } from '../../World';
import { paddleRoll } from '../../entities/EntityViews';
import type { ParticleSystem } from '../../../engine/render/ParticleSystem';
import {
  buildScarabParts,
  buildWingGeometry,
  createScarabMaterials,
  ELYTRON_HINGE,
  WING_ROOT,
  type ScarabMaterialKey,
  type ScarabMaterials,
  type ScarabPart,
} from './scarabModel';

/** Playfield depth the scarabs crawl at: in front of the bricks' plane, on the paddle's front half. */
export const SCARAB_Z = 0.55;
const Z = SCARAB_Z;
/** Depth of the paddle's back half, where a second rider goes so the two never look merged. */
const BACK_Z = -0.5;
/** Depth and size of a scarab as far off into the scene as it goes (see the 'away' state). */
const FAR_Z = -2.5;
const FAR_SCALE = 0.55;
/** How quickly a scarab moves between those depths, per second. */
const LANE_RATE = 8;

/** Body length in world units (nose of the head shield to the tail of the wing cases). */
const LENGTH = SCARAB.radius * 2.4;

const sand = new THREE.Color(0.86, 0.64, 0.36);
const gold = new THREE.Color(1, 0.78, 0.32);
/** The dust a crushed scarab bursts into: the deep red of its shell. */
const redDust = new THREE.Color(0.62, 0.04, 0.03);
/** Darker, browner dust from the shell's underside and the thorax, mixed through the red. */
const brownDust = new THREE.Color(0.3, 0.1, 0.05);

/** Shared by every scarab: the model is built once (gameplay/hazards/scarabs/scarabModel.ts). */
let sharedParts: ScarabPart[] | null = null;
let sharedWing: THREE.BufferGeometry | null = null;

/** Scuttle rate (radians per second of the stride cycle) at a full crawl. */
const STRIDE = 26;

/** Copies of each beating wing drawn across its stroke, so the beat reads as a blur rather than a strobe. */
const WING_GHOSTS = 5;
/** Drawn wingbeat, Hz (a real scarab's is faster still; this keeps the blur shimmering, not stepping). */
const WINGBEAT = 23;
/** Wing stroke about its mean (radians) and the mean itself (raised above level). */
const STROKE = 0.95;
const STROKE_MEAN = -0.3;
/** Wing sweep: folded back along the body under the wing cases, and spread for flight. */
const SWEEP_FOLDED = -1.5;
const SWEEP_SPREAD = -0.22;
/** How far the wing cases lift at the back and spread apart to fly, radians. */
const CASE_LIFT = 0.6;
const CASE_SPREAD = 0.42;
/** How quickly the wing cases and wings follow where they should be, per second. */
const WING_RATE = 12;
/** Turning round, radians per second. */
const TURN_RATE = 10;

const smooth = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * One scarab (see gameplay/hazards/scarabs/scarabModel.ts), facing +x with its underside on y = 0 and LENGTH long. Its legs
 * are hidden under the shell, so the scuttle shows in the body: a quick bob and side-to-side rock with
 * each stride, and a slight surge forward and back. It turns round by actually turning (through facing the
 * camera), crouches before it leaps, and to fly lifts and spreads its wing cases and unfolds its hind wings,
 * whose beat is drawn as a translucent blur. It can be squashed flat (crushed).
 */
class ScarabMesh {
  readonly group = new THREE.Group();
  /** Inner group for pose (bob, pitch, squash, sink) so `group` keeps position, facing and roll. */
  private readonly body = new THREE.Group();
  private readonly shadow: THREE.Mesh;
  private readonly shadowMaterial: THREE.MeshBasicMaterial;
  private readonly cases: { pivot: THREE.Group; side: number }[] = [];
  private readonly wings: { fold: THREE.Group; ghosts: THREE.Mesh[] }[] = [];
  private readonly wingMaterial: THREE.MeshPhysicalMaterial;
  /** Sand kicked up behind it while it crawls: particles owed, carried between frames. */
  kick = 0;
  /** Drawn facing (radians about y): 0 facing right, -pi facing left; it turns between them. */
  yaw = 0;
  /** How open the wing cases are, and how unfolded the wings (0 to 1), easing to where they should be. */
  casesOpen = 0;
  wingsOpen = 0;
  /** The sim state it was last drawn in, and seconds it has been in it (for one-off squash and stretch). */
  shownState = '';
  stateTime = 0;
  /** Its scarab's age when last drawn: a smaller age means the pool slot has a new scarab. */
  lastAge = Infinity;
  /** Current depth: Z, or BACK_Z while riding the paddle behind a neighbour. */
  z = SCARAB_Z;
  /** How fast it is moving in depth (world z per second), for which way it faces while swirling. */
  vz = 0;

  constructor(materials: ScarabMaterials) {
    const parts = (sharedParts ??= buildScarabParts());
    const owned = new Map<ScarabMaterialKey, THREE.Material>();
    const own = (key: ScarabMaterialKey): THREE.Material => {
      let copy = owned.get(key);
      if (!copy) {
        copy = materials[key].clone();
        owned.set(key, copy);
      }
      return copy;
    };
    // Roll (on a tilted paddle) about the view axis, after turning about y.
    this.group.rotation.order = 'ZYX';
    const model = new THREE.Group();
    model.scale.setScalar(LENGTH);
    let shadow: THREE.Mesh | null = null;
    for (const part of parts) {
      const mesh = new THREE.Mesh(part.geometry, own(part.material));
      if (part.material === 'shadow') {
        // On the floor, so it stays put while the body bobs.
        mesh.scale.setScalar(LENGTH);
        mesh.renderOrder = -1;
        shadow = mesh;
        this.group.add(mesh);
      } else if (part.elytron) {
        // A wing case on its hinge at the front of the seam.
        const pivot = new THREE.Group();
        pivot.position.copy(ELYTRON_HINGE);
        pivot.add(mesh);
        model.add(pivot);
        this.cases.push({ pivot, side: part.elytron });
      } else model.add(mesh);
    }
    this.shadow = shadow!;
    this.shadowMaterial = this.shadow.material as THREE.MeshBasicMaterial;

    // Hind wings, folded away under the wing cases until it flies.
    this.wingMaterial = own('wing') as THREE.MeshPhysicalMaterial;
    const wingGeo = (sharedWing ??= buildWingGeometry());
    for (const side of [-1, 1]) {
      const root = new THREE.Group();
      root.position.set(WING_ROOT.x, WING_ROOT.y, WING_ROOT.z * side);
      root.scale.z = side;
      const fold = new THREE.Group();
      root.add(fold);
      const ghosts: THREE.Mesh[] = [];
      for (let g = 0; g < WING_GHOSTS; g++) {
        const wing = new THREE.Mesh(wingGeo, this.wingMaterial);
        wing.renderOrder = 2;
        fold.add(wing);
        ghosts.push(wing);
      }
      model.add(root);
      this.wings.push({ fold, ghosts });
    }

    this.body.add(model);
    this.group.add(this.body);
    this.setFlight(0, 0, false, 0);
  }

  /**
   * @param walk   how hard it is scuttling (0 still, 1 a full crawl)
   * @param t      animation clock, seconds
   * @param twitch restless shuffling in place (clinging, peeking)
   */
  pose(walk: number, t: number, twitch: number): void {
    const phase = t * STRIDE;
    const lift = Math.abs(Math.sin(phase));
    // Each stride lifts the body a touch and rocks it to the side of the legs that are planted.
    this.body.position.y = LENGTH * (0.012 * walk * lift + 0.004 * twitch * Math.abs(Math.sin(t * 17)));
    this.body.position.x = LENGTH * 0.008 * walk * Math.sin(phase * 2);
    this.body.rotation.x = 0.05 * walk * Math.sin(phase) + 0.02 * twitch * Math.sin(t * 13);
    this.body.rotation.y = 0.035 * walk * Math.sin(phase * 0.5) + 0.03 * twitch * Math.sin(t * 7);
    this.body.rotation.z = 0.02 * walk * Math.sin(phase * 2 + 1);
    this.shadow.visible = true;
  }

  /** Nose up (positive) or down, about its middle so it does not lurch. */
  pitch(angle: number): void {
    this.body.rotation.z += angle;
    this.body.position.y += Math.abs(Math.sin(angle)) * LENGTH * 0.18;
  }

  /** Squash (amount > 0: flatter and wider, sitting lower) or stretch (amount < 0: longer and slimmer). */
  squish(amount: number): void {
    this.body.scale.set(1 + 0.45 * amount, 1 - amount, 1 + 0.3 * amount);
  }

  /**
   * Wing cases `cases` open (0 closed .. 1 lifted and spread), hind wings `wings` unfolded (0 tucked away ..
   * 1 spread); `beat` sets them buzzing (drawn as a blur across the stroke) rather than held still.
   */
  setFlight(cases: number, wings: number, beat: boolean, t: number): void {
    for (const c of this.cases) c.pivot.rotation.set(-c.side * CASE_SPREAD * cases, 0, -CASE_LIFT * cases);
    const shown = wings > 0.02;
    this.wingMaterial.opacity = beat ? 0.5 : Math.min(1, wings * 1.2);
    for (const w of this.wings) {
      w.fold.visible = shown;
      if (!shown) continue;
      w.fold.rotation.y = SWEEP_FOLDED + (SWEEP_SPREAD - SWEEP_FOLDED) * wings;
      // Unfolding: tucked under the cases (short and low), opening out to full span.
      w.fold.scale.set(1, 1, 0.45 + 0.55 * wings);
      w.fold.position.y = -0.05 * (1 - wings);
      for (let g = 0; g < w.ghosts.length; g++) {
        const ghost = w.ghosts[g];
        if (!beat) {
          ghost.visible = g === 0;
          ghost.rotation.x = STROKE_MEAN * wings;
          continue;
        }
        // Spread evenly round the stroke cycle (so they bunch at its ends, where a real wing lingers), with
        // the whole set sliding along so the blur shimmers.
        ghost.visible = true;
        const phase = (t * WINGBEAT + g / w.ghosts.length) * Math.PI * 2;
        ghost.rotation.x = STROKE_MEAN + STROKE * Math.sin(phase);
      }
    }
  }

  /** Keeps the shadow on the floor `drop` below it (fainter and smaller the higher it is). */
  setShadow(drop: number, fade = 1): void {
    const k = 1 / (1 + 0.45 * Math.max(0, drop));
    this.shadow.position.y = -Math.max(0, drop);
    this.shadow.scale.setScalar(LENGTH * (0.55 + 0.45 * k));
    this.shadowMaterial.opacity = k * fade;
  }

  /** Crushed by the ball: flattens and spreads at once, then shrinks away (amount 0 to 1). */
  squash(amount: number): void {
    const flat = Math.min(1, amount * 5);
    const gone = Math.max(0, (amount - 0.4) / 0.6);
    const keep = 1 - gone;
    this.body.scale.set((1 + 0.35 * flat) * keep, (1 - 0.82 * flat) * keep, (1 + 0.25 * flat) * keep);
    this.shadow.visible = false;
  }

  resetPose(): void {
    this.body.rotation.set(0, 0, 0);
    this.body.position.set(0, 0, 0);
    this.body.scale.setScalar(1);
    this.shadow.scale.setScalar(LENGTH);
    this.shadow.position.y = 0;
    this.shadowMaterial.opacity = 1;
    this.shadow.visible = true;
  }
}

/**
 * Draws the current world's scarabs (gameplay/hazards/scarabs/scarabs.ts): one mesh per scarab in the pool, and one per nest that
 * peeks its head out at the nest's entry point while the nest stirs.
 */
export class ScarabView {
  private readonly scarabs: ScarabMesh[] = [];
  private readonly peekers: ScarabMesh[] = [];
  private readonly materials: ScarabMaterials;
  private sandTime = 0;
  private warmed = false;

  constructor(private readonly scene: THREE.Scene) {
    this.materials = createScarabMaterials();
  }

  private make(): ScarabMesh {
    const mesh = new ScarabMesh(this.materials);
    mesh.group.visible = false;
    this.scene.add(mesh.group);
    return mesh;
  }

  update(world: World, alpha: number, simDt: number, particles: ParticleSystem): void {
    const sys = world.scarabs;
    const time = world.time;
    while (this.scarabs.length < sys.items.length) this.scarabs.push(this.make());
    while (this.peekers.length < sys.nests.length) this.peekers.push(this.make());
    if (sys.nests.length > 0 && !this.warmed) {
      // Compile the scarab shaders before the first swarm (it would hitch otherwise): draw every mesh once,
      // at a nest's entry point, shrunk to nothing, so none of it shows.
      this.warmed = true;
      const nest = sys.nests[0];
      for (const mesh of [...this.scarabs, ...this.peekers]) {
        mesh.group.visible = true;
        mesh.group.position.set(nest.def.x, nest.def.y, Z);
        mesh.group.scale.setScalar(1e-4);
        // Wings out too, so their material compiles now rather than on the first take-off.
        mesh.setFlight(1, 1, true, 0);
      }
      return;
    }

    for (let i = 0; i < this.scarabs.length; i++) {
      const mesh = this.scarabs[i];
      const s = sys.items[i];
      const nest = s?.active ? sys.nests[s.nest] : undefined;
      mesh.group.visible = !!nest;
      if (!s || !nest) continue;
      const riding = s.state === 'cling' || s.state === 'crushed';
      const lane = riding && s.lane === 1 ? BACK_Z : Z;
      if (s.state === 'away') {
        const z = lerp(Z, FAR_Z, s.depth);
        mesh.vz = simDt > 0 ? (z - mesh.z) / simDt : 0;
        mesh.z = z;
      } else mesh.z += (lane - mesh.z) * Math.min(1, simDt * LANE_RATE);
      this.place(mesh, s, world.paddle, alpha, time, simDt, particles);
    }
    for (let i = 0; i < this.peekers.length; i++) this.peek(this.peekers[i], sys.nests[i], time, simDt, particles);
  }

  private place(
    mesh: ScarabMesh,
    s: Scarab,
    paddle: Paddle,
    alpha: number,
    time: number,
    simDt: number,
    particles: ParticleSystem,
  ): void {
    const x = lerp(s.px, s.x, alpha);
    let y = lerp(s.py, s.y, alpha);
    const floor = paddle.y - PADDLE.halfH;
    const onPaddle = s.state === 'cling' || s.state === 'crushed';
    // A clinging one rides the paddle's rolled top.
    const roll = onPaddle ? paddleRoll(paddle) : 0;
    if (roll !== 0) y += (x - lerp(paddle.px, paddle.x, alpha)) * Math.sin(roll);
    mesh.group.position.set(x, y, mesh.z);
    mesh.group.rotation.z = roll;
    // Shrinking into the distance while away.
    const size = s.state === 'away' ? lerp(1, FAR_SCALE, s.depth) : 1;
    mesh.group.scale.setScalar(size);

    // A new scarab in this pool slot: start it facing the right way, wings away.
    // (Coming back out of the distance, it flies straight at the camera.)
    const facingYaw = s.state === 'away' && s.back ? -Math.PI / 2 : s.facing > 0 ? 0 : -Math.PI;
    if (s.age < mesh.lastAge) {
      mesh.z = Z;
      mesh.yaw = facingYaw;
      mesh.casesOpen = mesh.wingsOpen = 0;
      mesh.shownState = '';
    }
    mesh.lastAge = s.age;
    if (s.state !== mesh.shownState) {
      mesh.shownState = s.state;
      mesh.stateTime = 0;
    } else mesh.stateTime += simDt;
    // Turns round rather than flipping: through facing the camera (whipping round to run from the paddle).
    const turn = (s.state === 'flee' ? 2.5 : 1) * TURN_RATE * simDt;
    if (s.state === 'away' && !s.back) {
      // Swirling: it faces the way it is flying, round and round, into the scene and out of it (the shorter way round).
      const travel = Math.atan2(-mesh.vz, s.vx);
      const d = Math.atan2(Math.sin(travel - mesh.yaw), Math.cos(travel - mesh.yaw));
      mesh.yaw += Math.max(-turn, Math.min(turn, d));
    } else {
      // (After swirling it may have wound round: bring it back within half a turn first.)
      while (facingYaw - mesh.yaw > Math.PI) mesh.yaw += Math.PI * 2;
      while (mesh.yaw - facingYaw > Math.PI) mesh.yaw -= Math.PI * 2;
      mesh.yaw += Math.max(-turn, Math.min(turn, facingYaw - mesh.yaw));
    }
    mesh.group.rotation.y = mesh.yaw;

    mesh.resetPose();
    const t = time + s.seed * 10;
    const flyer = s.mode === 'fly';
    let cases = 0;
    let wings = 0;
    let beat = false;
    switch (s.state) {
      case 'emerge':
      case 'crawl':
      case 'flee': {
        // Scuttling (flat out when running from the paddle).
        mesh.pose(s.state === 'flee' ? 1.6 : 1, t, 0);
        // Little spurts of sand kicked out behind by the hidden legs.
        mesh.kick += simDt * (s.state === 'flee' ? 30 : 16);
        const kx = x - s.facing * LENGTH * 0.3;
        while (mesh.kick >= 1) {
          mesh.kick -= 1;
          const side = Math.random() < 0.5 ? -1 : 1;
          particles.emit(
            kx + (Math.random() - 0.5) * LENGTH * 0.4,
            y + 0.04,
            Z + side * LENGTH * 0.25,
            -s.facing * (0.4 + Math.random() * 1.1),
            0.5 + Math.random() * 1.1,
            side * 0.3,
            sand.r,
            sand.g,
            sand.b,
            0.045 + Math.random() * 0.05,
            0.3 + Math.random() * 0.3,
            2,
            5,
          );
        }
        break;
      }
      case 'crouch': {
        const p = 1 - s.timer / (flyer ? SCARAB.flyCrouch : SCARAB.hopCrouch);
        if (flyer) {
          // Wing cases lift and part, the wings unfold and start to buzz, and it rears up to go.
          mesh.pose(0, t, 0.6);
          cases = smooth(0, 0.5, p);
          wings = smooth(0.3, 0.85, p);
          beat = p > 0.6;
          mesh.pitch(0.45 * smooth(0.5, 1, p));
          if (beat) mesh.group.position.y += 0.012 * Math.sin(t * 160);
        } else {
          // Gathers itself low, nose lifting towards where it will jump.
          mesh.pose(0, t, 0.3);
          mesh.squish(0.22 * smooth(0, 0.7, p));
          mesh.pitch(0.14 * smooth(0.3, 1, p));
        }
        break;
      }
      case 'hop':
        if (flyer) {
          // A flyer dropping after a miss: still buzzing, settling level as it comes down.
          cases = wings = 1;
          beat = true;
          mesh.pitch(0.5);
        } else {
          // Springs off stretched out and nose up, levelling over the top of the jump and dipping only a
          // little as it comes down (a beetle does not dive).
          const launch = Math.max(0, 1 - mesh.stateTime / 0.16);
          mesh.squish(-0.16 * launch);
          mesh.pitch(Math.max(-0.22, Math.min(0.6, 0.6 * Math.atan2(s.vy, Math.abs(s.vx) + 2))));
        }
        break;
      case 'fly': {
        // Hangs steeply nose-up under its wings, as beetles fly, with the body shivering from the wingbeat
        // and a slow sway; it levels off a little as it comes down to land.
        cases = wings = 1;
        beat = true;
        const climb = s.y - s.py;
        mesh.pitch(0.85 + 0.08 * Math.sin(t * 3.1) - 0.2 * Math.max(0, Math.min(1, -climb * 20)));
        mesh.group.position.y += 0.012 * Math.sin(t * 170);
        mesh.group.rotation.x = 0.08 * Math.sin(t * 2.3 + s.seed * 4);
        break;
      }
      case 'away': {
        // Flying under a blur of wings, banking into its turns and nosing up as it brakes.
        cases = wings = 1;
        beat = true;
        mesh.pitch(0.55 + 0.1 * Math.sin(t * 4.3) + Math.max(-0.25, Math.min(0.3, s.vy * 0.04)));
        mesh.group.position.y += 0.015 * Math.sin(t * 170);
        mesh.group.rotation.x = Math.max(-0.5, Math.min(0.5, -s.vx * 0.05)) + 0.12 * Math.sin(t * 7 + s.seed);
        break;
      }
      case 'land': {
        // Hits the floor: a squash, then picks itself up (a flyer folding its wings away and closing up).
        const p = 1 - s.timer / (flyer ? SCARAB.flyLand : SCARAB.hopLand);
        mesh.pose(0, t, 0.8);
        mesh.squish(0.28 * Math.max(0, 1 - mesh.stateTime / 0.14));
        if (flyer) {
          cases = 1 - smooth(0.35, 1, p);
          wings = 1 - smooth(0, 0.6, p);
          beat = p < 0.15;
        }
        break;
      }
      case 'wait':
        // Holding off, restless.
        mesh.pose(0, t, 0.7);
        break;
      case 'cling': {
        // Scuttling up and down the paddle, restless whenever it stops.
        const walk = Math.min(1, Math.abs(s.vx) / SCARAB.scuttleSpeed[0]);
        mesh.pose(walk, t, 1 - walk);
        // Touchdown on the paddle.
        mesh.squish(0.2 * Math.max(0, 1 - mesh.stateTime / 0.12));
        break;
      }
      case 'crushed':
        mesh.squash(1 - s.timer / SCARAB.crushed);
        break;
    }
    if (s.state !== 'fly' && s.state !== 'away') mesh.group.rotation.x = 0;
    // Wing cases and wings ease to where they should be (closing up after it lands on the paddle).
    const k = 1 - Math.exp(-WING_RATE * simDt);
    mesh.casesOpen += (cases - mesh.casesOpen) * k;
    mesh.wingsOpen += (wings - mesh.wingsOpen) * k;
    if (s.state === 'crushed') mesh.wingsOpen = mesh.casesOpen = 0;
    mesh.setFlight(mesh.casesOpen, mesh.wingsOpen, beat && mesh.wingsOpen > 0.5, time + s.seed);
    // (Away, it is out over the scene: no shadow on the play's floor.)
    if (!onPaddle) mesh.setShadow((y - floor) / size, s.state === 'away' ? 1 - Math.min(1, s.depth * 4) : 1);
  }

  /** While a nest stirs, a scarab's head pokes out at its entry point, twitching; sand trickles down. */
  private peek(mesh: ScarabMesh, nest: Nest | undefined, time: number, simDt: number, particles: ParticleSystem): void {
    if (!nest || (nest.state !== 'warn' && nest.state !== 'release')) {
      mesh.group.visible = false;
      return;
    }
    const foot = ScarabSystem.foot(nest);
    const facing = foot.facing;
    const at = foot.y;
    const p = nest.state === 'warn' ? 1 - nest.timer / Math.max(1e-3, nest.duration) : 1;
    // Nose creeps out to just past the edge, darting in and out.
    const out = LENGTH * (0.15 + 0.35 * p) + 0.05 * Math.sin(time * 17);
    mesh.group.visible = true;
    mesh.group.position.set(foot.x + facing * (out - LENGTH * 0.45), at, Z);
    mesh.group.scale.set(facing, 1, 1);
    mesh.group.rotation.set(0, 0, 0);
    mesh.resetPose();
    mesh.setFlight(0, 0, false, 0);
    mesh.pose(0.2, time, 1);

    // Sand trickling down where it comes out, thicker as the swarm gets closer.
    this.sandTime += simDt * (6 + 22 * p);
    while (this.sandTime >= 1) {
      this.sandTime -= 1;
      const h = at + 0.6 + Math.random() * 1.6;
      particles.emit(
        foot.x + facing * (0.05 + Math.random() * 0.12),
        h,
        Z,
        facing * 0.15,
        -0.6 - Math.random() * 1.2,
        0,
        sand.r,
        sand.g,
        sand.b,
        0.05 + Math.random() * 0.05,
        0.5 + Math.random() * 0.4,
        1,
        3,
      );
    }
  }

  /** Colours for GameView's event bursts. */
  static readonly sand = sand;
  static readonly gold = gold;
  static readonly redDust = redDust;
  static readonly brownDust = brownDust;
}
