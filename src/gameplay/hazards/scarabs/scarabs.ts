import { PADDLE, SCARAB } from '../../config';
import type { EventBus } from '../../../engine/core/EventBus';
import type { Random } from '../../../engine/core/Random';
import type { GameEvents } from '../../events';
import { roundedPath } from '../../../engine/core/paths';
import type { HazardDef, HazardSystem, ScarabNestDef, ScarabPoint } from '../hazards';
import type { Ball, Paddle } from '../../types';
import type { ArenaBounds } from '../../arena/boundary';

/**
 * Scarab swarms (see SCARAB in gameplay/config.ts). Nests are spawn points; their scarabs walk in along the
 * nest's path, then crawl along the floor after the paddle and, from a random distance, hop or fly up onto it. One that misses lands on the
 * floor, recovers, turns round and tries again. They never let the paddle run into them on the floor: brought
 * too close, one springs up onto it (or, with no room on it, scuttles off or leaps over it). Once on, they
 * cling (shoving the paddle on the way they were going as they land) and weigh one end down (bending its bounces) until a returned ball crushes them, the only way one dies.
 * They only come with a storm (a stone gate grinding open, then the dust blowing in; see startStorm). While
 * the paddle is full only the nearest on each side keeps trying to get on; the rest run off and swirl about
 * out in the scene, coming back as places come free.
 */

export type NestState = 'idle' | 'warn' | 'release' | 'scared';

export interface Nest {
  readonly def: ScarabNestDef;
  /** The walk-in route (ScarabSystem.route), worked out once at load. */
  readonly route: readonly ScarabPoint[];
  /** The route brought down to the floor at `walkInFloor` (the paddle's lane), cached for the current floor. */
  walkIn: readonly ScarabPoint[];
  walkInFloor: number;
  /** +1 for a nest left of centre (its swarm sets off rightwards), -1 for one on the right. */
  readonly facing: 1 | -1;
  state: NestState;
  /** Seconds left in the current state (idle: until the next attempt; release: until the next scarab). */
  timer: number;
  /** Full length of the current state, for animation progress. */
  duration: number;
  /** Scarabs still to come out in this swarm. */
  pending: number;
}

/**
 * emerge: scrambling out of the nest. crawl: hunting along the floor. wait: holding off while the paddle is
 * full. flee: scuttling out of the way of the paddle. crouch: winding up to leap (a flyer opening its wing
 * cases and unfolding its wings). hop: in the air on a ballistic arc (a hop, a startled spring, a leap over
 * the paddle, or a flyer dropping at the end of its flight). fly: flying a steered arc at the paddle. land:
 * recovering on the floor after a miss. cling: riding the paddle. crushed: squashed by the ball. away: flown off
 * into the scene while the paddle is full, drifting about out there until called back for a free place.
 */
export type ScarabState =
  'emerge' | 'crawl' | 'wait' | 'flee' | 'crouch' | 'hop' | 'fly' | 'land' | 'cling' | 'crushed' | 'away';

/** How a scarab goes for the paddle: a quick hop from close by, or a buzzing flight from further off. */
export type LeapMode = 'hop' | 'fly';

export interface Scarab {
  active: boolean;
  state: ScarabState;
  /** Index of the nest it came from, into ScarabSystem.nests. */
  nest: number;
  /** Feet position: on the floor while crawling, on the paddle's top while clinging. */
  x: number;
  y: number;
  /** Position at the previous step, for render interpolation. */
  px: number;
  py: number;
  /** +1 heading right, -1 left. */
  facing: 1 | -1;
  /** Seconds left in the current state (emerge, flee, crouch, land, crushed). */
  timer: number;
  /** How it will go for the paddle next (and, while crouching, in the air or landing, how it is going). */
  mode: LeapMode;
  /** Distance short of the paddle's nearer end at which it takes off. */
  leapAt: number;
  /** Seconds before it may take off again (after landing from a miss). */
  rest: number;
  /** Velocity while in a ballistic hop or fall. */
  vx: number;
  vy: number;
  /** A flight: where it took off, where along the floor it is aiming (steered as it goes), the arc's extra
   *  height, the landing scatter it aims with relative to the paddle, and seconds flown / planned. */
  sx: number;
  sy: number;
  tx: number;
  arc: number;
  aim: number;
  flown: number;
  flight: number;
  speed: number;
  /** Where it clings, from -1 (paddle's left end) to 1 (right end). */
  offset: number;
  /** Riding: which half of the paddle's depth it is on (0 front, 1 back), where it is scuttling to (an
   *  offset), and seconds it pauses before the next run. */
  lane: number;
  goal: number;
  pause: number;
  /** Away: the spot it is drifting to (x, and height over the paddle's top), how far off into the scene it is
   *  (0 at the play, 1 far off; the view shrinks it into the distance), and whether it is coming back. */
  bx: number;
  by: number;
  depth: number;
  back: boolean;
  /** Away: the way it is flying (radians, 0 rightwards, counter-clockwise). */
  heading: number;
  /** Seconds since it came out, for animation. */
  age: number;
  /** Fixed per scarab, for animation variety. */
  seed: number;
}

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Half a scarab's body length (gameplay/hazards/scarabs/ScarabView.ts draws it SCARAB.radius * 2.4 long). */
const BODY = SCARAB.radius * 1.2;
/** Centre-to-centre spacing scarabs keep on the floor. */
const SPACING = BODY * 2 + SCARAB.crowdGap;

/** Furthest out (as an offset, a share of the half-width) a rider's centre goes, keeping its body on the paddle. */
export function rideLimit(paddle: Paddle): number {
  const half = paddle.width / 2;
  return Math.max(0, (half - BODY - 0.08) / half);
}

/**
 * The paddle's slope (radians, counter-clockwise) under clinging scarabs' weight: half the bounce turn the lean
 * gives (SCARAB.leanKick), as a mirror tilted by a turns a reflection by 2a. The ball meets this sloped top.
 */
export function paddleSlope(p: Paddle): number {
  return (-p.lean * SCARAB.leanKick) / 2;
}

/** Runs a world's scarab nests. Owned by World; deterministic for a given seed. */
export class ScarabSystem implements HazardSystem {
  readonly nests: Nest[] = [];
  /** A fixed pool: SCARAB.maxActive scarabs, `active` when out of their nest. */
  readonly items: Scarab[] = [];
  private difficulty = 0;
  /** Seconds until the next storm (counting down only while every nest is quiet and the ball is in play). */
  private untilStorm = 0;
  /** See-saw clock (radians) while scarabs ride the paddle, and which way its first lurch went. */
  private teeter = 0;
  private teeterDir = 1;
  /** The open floor between where the nests' walk-ins reach it: scarabs aim their leaps to come down within it. */
  private openLeft = -Infinity;
  private openRight = Infinity;
  /** The sides of the world's ball area: flyers stay between them (see inField). */
  private arenaLeft = -Infinity;
  private arenaRight = Infinity;

  constructor(
    private readonly rng: Random,
    private readonly events: EventBus<GameEvents>,
  ) {
    for (let i = 0; i < SCARAB.maxActive; i++) {
      this.items.push({
        active: false,
        state: 'crawl',
        nest: 0,
        x: 0,
        y: 0,
        px: 0,
        py: 0,
        facing: 1,
        timer: 0,
        mode: 'hop',
        leapAt: 0,
        rest: 0,
        vx: 0,
        vy: 0,
        sx: 0,
        sy: 0,
        tx: 0,
        arc: 0,
        aim: 0,
        flown: 0,
        flight: 0,
        speed: 0,
        offset: 0,
        lane: 0,
        goal: 0,
        pause: 0,
        bx: 0,
        by: 0,
        depth: 0,
        back: false,
        heading: 0,
        age: 0,
        seed: i * 0.618,
      });
    }
  }

  load(defs: readonly HazardDef[] | undefined, difficulty: number, arena: ArenaBounds): void {
    this.difficulty = Math.min(1, Math.max(0, difficulty));
    this.arenaLeft = arena.left;
    this.arenaRight = arena.right;
    this.nests.length = 0;
    for (const def of defs ?? []) {
      if (def.kind !== 'scarabs') continue;
      this.nests.push({
        def,
        route: ScarabSystem.route(def),
        walkIn: [],
        walkInFloor: Number.NaN,
        facing: def.x < 0 ? 1 : -1,
        state: 'idle',
        timer: 0,
        duration: 0,
        pending: 0,
      });
    }
    this.openLeft = -Infinity;
    this.openRight = Infinity;
    for (const n of this.nests) {
      // The open floor starts where the walk-in reaches it.
      const end = n.route[n.route.length - 1].x;
      if (n.facing > 0) this.openLeft = Math.max(this.openLeft, end + SCARAB.radius);
      else this.openRight = Math.min(this.openRight, end - SCARAB.radius);
    }
    this.reset(true);
  }

  /** Every scarab gone and every nest quiet with a fresh wait (level start, life lost). */
  reset(firstOfLevel = false): void {
    for (const s of this.items) s.active = false;
    this.teeter = 0;
    for (const n of this.nests) {
      n.state = 'idle';
      n.pending = 0;
      n.timer = n.duration = 0;
    }
    this.untilStorm = (firstOfLevel ? SCARAB.firstDelay : 0) + this.wait();
  }

  /** Scarabs clinging to the paddle. */
  get clinging(): number {
    let n = 0;
    for (const s of this.items) if (s.active && s.state === 'cling') n++;
    return n;
  }

  /** Scarabs out of their nests (any state). */
  get activeCount(): number {
    let n = 0;
    for (const s of this.items) if (s.active) n++;
    return n;
  }

  private scaled(pair: readonly [number, number]): number {
    return lerp(pair[0], pair[1], this.difficulty);
  }

  private wait(): number {
    return this.rng.range(this.scaled(SCARAB.waitMin), this.scaled(SCARAB.waitMax));
  }

  /**
   * @param live true while the ball is in play: only then do nests count down, scarabs move and the ball
   *             scare a swarm. Crushed scarabs still finish their animation otherwise.
   * @returns points scored for swarms the ball scared back this step.
   */
  update(dt: number, paddle: Paddle, balls: readonly Ball[], live: boolean): number {
    if (this.nests.length === 0) return 0;
    let points = 0;
    // Between storms every nest is quiet; the next storm comes when its wait is up.
    const stormy = this.nests.some((n) => n.state !== 'idle');
    if (!stormy && live) {
      this.untilStorm -= dt;
      if (this.untilStorm <= 0) this.startStorm();
    }
    for (let i = 0; i < this.nests.length; i++) {
      const n = this.nests[i];
      if (n.state === 'idle') continue;
      if (live && (n.state === 'warn' || n.state === 'release')) {
        const ball = this.ballNear(ScarabSystem.foot(n), balls);
        if (ball) {
          n.pending = 0;
          this.enter(n, 'scared', this.scaled(SCARAB.scared));
          points += SCARAB.scareScore;
          this.events.emit('scarabScared', { x: ball.x, y: ball.y });
          continue;
        }
      }
      if (!live && n.state !== 'scared') continue;
      n.timer -= dt;
      if (n.timer > 0) continue;
      if (n.state === 'warn') {
        // The gate is open and the dust blows in: out they come.
        this.enter(n, 'release', 0);
      } else if (n.state === 'release') {
        if (n.pending > 0 && this.spawn(i)) n.pending--;
        if (n.pending <= 0) this.enter(n, 'idle', 0);
        else n.timer = n.duration = SCARAB.stagger;
      } else {
        this.enter(n, 'idle', 0);
      }
    }
    if (stormy && this.nests.every((n) => n.state === 'idle')) this.untilStorm = this.wait();
    this.moveScarabs(dt, paddle, live);
    if (live) this.swat(balls);
    // Riders see-saw the paddle, quicker on later levels and the more of them there are.
    const { left, right } = this.riders();
    if (left + right > 0) {
      // The first lurch goes towards the end it climbed on at.
      if (this.teeter === 0) this.teeterDir = this.riderWeight(paddle) < 0 ? -1 : 1;
      if (live)
        this.teeter += dt * Math.PI * 2 * (this.scaled(SCARAB.teeterHz) + SCARAB.teeterHzPerRider * (left + right - 1));
    } else this.teeter = 0;
    // The paddle settles towards the lean its riders' weight gives it.
    paddle.lean += (this.leanGoalFor(paddle) - paddle.lean) * Math.min(1, dt * SCARAB.leanRate);
    return points;
  }

  /**
   * A ball bounced off the paddle at `x`: it crushes the clinging scarab it came down on (the nearest within
   * SCARAB.crushReach), if any. This is the only way to get one off, so the player has to aim the return
   * with the end the scarabs weigh down.
   */
  crush(x: number): void {
    let best: Scarab | null = null;
    let bestD: number = SCARAB.crushReach;
    for (const s of this.items) {
      if (!s.active || s.state !== 'cling') continue;
      const d = Math.abs(s.x - x);
      if (d <= bestD) {
        bestD = d;
        best = s;
      }
    }
    if (!best) return;
    best.state = 'crushed';
    best.timer = SCARAB.crushed;
    this.events.emit('scarabCrushed', { x: best.x, y: best.y });
  }

  /** Scarabs clinging on each half of the paddle. */
  riders(): { left: number; right: number } {
    let left = 0;
    let right = 0;
    for (const s of this.items) {
      if (!s.active || s.state !== 'cling') continue;
      if (s.offset < 0) left++;
      else right++;
    }
    return { left, right };
  }

  /** Where the riders' weight sits, -1 (all as far left as they go) to 1 (right); 0 with none. */
  private riderWeight(paddle: Paddle): number {
    const limit = rideLimit(paddle) || 1;
    let sum = 0;
    let n = 0;
    for (const s of this.items) {
      if (!s.active || s.state !== 'cling') continue;
      sum += Math.max(-1, Math.min(1, s.offset / limit));
      n++;
    }
    return n ? sum / n : 0;
  }

  /**
   * The lean (see Paddle.lean) the clinging scarabs tip the paddle to. Even one rider see-saws it fully from
   * end to end, dwelling longer on the side their weight is on (which shifts smoothly as they scuttle about);
   * level with none.
   */
  leanGoalFor(paddle: Paddle): number {
    const { left, right } = this.riders();
    if (left + right === 0) return 0;
    const bias = SCARAB.teeterBias * this.riderWeight(paddle);
    return Math.max(-1, Math.min(1, bias + this.teeterDir * this.scaled(SCARAB.teeterSwing) * Math.sin(this.teeter)));
  }

  /**
   * A storm: the swarm for this level (SCARAB.swarm, as many as there is room for) is shared out between the
   * nests, which stir together while the gate grinds open (SCARAB.grind, the tombGate event); then the dust
   * blows in and they come out (see update).
   */
  private startStorm(): void {
    const room = SCARAB.maxActive - this.activeCount;
    if (room <= 0) {
      this.untilStorm = this.rng.range(SCARAB.retry[0], SCARAB.retry[1]);
      return;
    }
    const count = Math.min(room, Math.round(this.scaled(SCARAB.swarm)));
    const first = Math.floor(this.rng.next() * this.nests.length);
    for (let k = 0; k < count; k++) this.nests[(first + k) % this.nests.length].pending++;
    for (const n of this.nests) {
      if (n.pending <= 0) continue;
      this.enter(n, 'warn', SCARAB.grind);
      const foot = ScarabSystem.foot(n);
      this.events.emit('scarabWarn', { x: foot.x, y: foot.y });
    }
    this.events.emit('tombGate', { duration: SCARAB.grind });
  }

  /** The next in line for a full paddle: the nearest on the floor on each side of it. */
  private boarders(paddle: Paddle): Set<Scarab> {
    let left: Scarab | null = null;
    let right: Scarab | null = null;
    let nearLeft = Infinity;
    let nearRight = Infinity;
    for (const s of this.items) {
      if (!s.active || !(ScarabSystem.grounded(s) || s.state === 'emerge')) continue;
      const d = Math.abs(s.x - paddle.x);
      if (s.x < paddle.x) {
        if (d < nearLeft) {
          nearLeft = d;
          left = s;
        }
      } else if (d < nearRight) {
        nearRight = d;
        right = s;
      }
    }
    const out = new Set<Scarab>();
    if (left) out.add(left);
    if (right) out.add(right);
    return out;
  }

  /**
   * Where a stirring swarm shows (the warning, and the head peeking out): the nest's entry point, facing the
   * way its walk-in sets off.
   */
  static foot(n: Nest): { x: number; y: number; facing: 1 | -1 } {
    const route = n.route;
    const dx = route.length > 1 ? route[1].x - route[0].x : 0;
    return { x: n.def.x, y: n.def.y, facing: dx < 0 ? -1 : dx > 0 ? 1 : n.facing };
  }

  /**
   * A nest's walk in: its entry point then its path, the last point brought down to `floor` if given, its
   * corners rounded off as the nest asks (engine/core/paths.ts).
   */
  static route(def: ScarabNestDef, floor?: number): ScarabPoint[] {
    const points: ScarabPoint[] = [{ x: def.x, y: def.y }, ...(def.path ?? [])];
    if (floor !== undefined && points.length > 1)
      points[points.length - 1] = { x: points[points.length - 1].x, y: floor };
    return roundedPath(points, false, def.radius ?? 0);
  }

  /** The point `distance` along a route, the way it heads there (x share of its direction), and whether it is at the end. */
  static along(route: readonly ScarabPoint[], distance: number): { x: number; y: number; dx: number; done: boolean } {
    let left = Math.max(0, distance);
    for (let i = 1; i < route.length; i++) {
      const a = route[i - 1];
      const b = route[i];
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      if (len > 0 && left <= len) {
        const t = left / len;
        return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, dx: (b.x - a.x) / len, done: false };
      }
      left -= len;
    }
    const end = route[route.length - 1];
    const prev = route[Math.max(0, route.length - 2)];
    const len = Math.hypot(end.x - prev.x, end.y - prev.y);
    return { x: end.x, y: end.y, dx: len > 0 ? (end.x - prev.x) / len : 0, done: true };
  }

  private enter(n: Nest, state: NestState, duration: number): void {
    n.state = state;
    n.timer = n.duration = duration;
  }

  private ballNear(at: { x: number; y: number }, balls: readonly Ball[]): Ball | null {
    for (const b of balls) {
      if (b.active && !b.stuck && Math.hypot(b.x - at.x, b.y - at.y) <= SCARAB.scareReach) return b;
    }
    return null;
  }

  private spawn(nest: number): boolean {
    const s = this.items.find((item) => !item.active);
    if (!s) return false;
    const n = this.nests[nest];
    s.active = true;
    s.state = 'emerge';
    s.nest = nest;
    s.x = s.px = n.def.x;
    s.y = s.py = n.def.y;
    s.facing = n.facing;
    s.timer = SCARAB.emerge;
    s.flown = 0;
    s.speed = this.scaled(SCARAB.speed) * this.rng.range(0.88, 1.12);
    s.offset = 0;
    s.depth = 0;
    s.back = false;
    s.age = 0;
    s.vx = s.vy = 0;
    this.planLeap(s);
    s.rest = 0;
    this.events.emit('scarabEmerge', { x: n.def.x, y: n.def.y });
    return true;
  }

  private moveScarabs(dt: number, paddle: Paddle, live: boolean): void {
    const floor = paddle.y - PADDLE.halfH;
    const top = paddle.y + PADDLE.halfH;
    const half = paddle.width / 2;
    this.callBack();
    // A full paddle: only the nearest on each side keeps trying to get on; the rest make off.
    // (Worked out when first needed: a scarab grabbing on can fill the paddle part way through.)
    let nextInLine: Set<Scarab> | null = null;
    const boarders = (): Set<Scarab> => (nextInLine ??= this.boarders(paddle));
    for (const s of this.items) {
      if (!s.active) continue;
      s.px = s.x;
      s.py = s.y;
      if (!live && (s.state === 'emerge' || s.state === 'crawl' || s.state === 'crouch')) continue;
      s.age += dt;
      switch (s.state) {
        case 'emerge': {
          const n = this.nests[s.nest];
          if (n.def.path) {
            // Walking in along the nest's path (round the scenery), down to the floor at its end.
            s.flown += s.speed * dt;
            if (n.walkInFloor !== floor) {
              n.walkInFloor = floor;
              n.walkIn = ScarabSystem.route(n.def, floor);
            }
            const at = ScarabSystem.along(n.walkIn, s.flown);
            s.x = at.x;
            s.y = at.y;
            if (Math.abs(at.dx) > 1e-3) s.facing = at.dx > 0 ? 1 : -1;
            if (at.done) {
              s.y = floor;
              s.state = 'crawl';
            }
            break;
          }
          // Scramble down from the nest to the floor while setting off.
          s.timer -= dt;
          s.x += s.facing * s.speed * dt;
          s.y = lerp(floor, n.def.y, Math.max(0, s.timer / SCARAB.emerge));
          if (s.timer <= 0) {
            s.y = floor;
            s.state = 'crawl';
          }
          break;
        }
        case 'crawl': {
          s.y = floor;
          s.rest -= dt;
          if (this.keepClear(s, paddle, top - floor)) break;
          const gap = paddle.x - s.x;
          const reach = this.edgeGap(s, paddle);
          s.facing = gap > 0 ? 1 : -1;
          if (!this.room) {
            if (!boarders().has(s)) {
              // Not next in line: it runs off, then (once it has gathered itself) takes to the air.
              if (this.readyToFly(s)) {
                this.crouchToFly(s);
                break;
              }
              const off = s.x < paddle.x ? -1 : 1;
              s.facing = off;
              s.x = this.inOpen(s.x + off * s.speed * dt);
              break;
            }
            // Next in line: it hangs about a little way off until a place comes free.
            if (reach <= SCARAB.holdOff) {
              s.state = 'wait';
              break;
            }
          } else if (s.rest <= 0 && reach <= s.leapAt) {
            s.state = 'crouch';
            s.timer = s.mode === 'fly' ? SCARAB.flyCrouch : SCARAB.hopCrouch;
            break;
          }
          s.x += s.facing * Math.min(Math.max(0, reach - SCARAB.startle), s.speed * dt, this.roomAhead(s));
          break;
        }
        case 'wait':
          s.y = floor;
          s.rest -= dt;
          s.facing = paddle.x > s.x ? 1 : -1;
          if (this.keepClear(s, paddle, top - floor)) break;
          // Back to hunting once there is room, it has drifted off, or it is no longer next in line.
          if (this.room || this.edgeGap(s, paddle) > SCARAB.holdOff + 1.5 || !boarders().has(s)) s.state = 'crawl';
          break;
        case 'flee': {
          // Scuttling out of the paddle's way, fast; cornered or caught up with, it leaps over instead.
          s.y = floor;
          s.timer -= dt;
          const away = s.x < paddle.x ? -1 : 1;
          s.facing = away;
          const gap = this.edgeGap(s, paddle);
          if (gap < SCARAB.startle * 0.4 || this.cornered(s, away)) {
            this.leapOver(s, paddle, away);
            break;
          }
          s.x = this.inOpen(s.x + away * SCARAB.fleeSpeed * dt);
          if (s.timer <= 0 && gap > SCARAB.startle) s.state = 'wait';
          break;
        }
        case 'crouch':
          // Winds up facing the paddle, then goes (at once, if the paddle comes right up to it meanwhile).
          s.y = floor;
          if (this.keepClear(s, paddle, top - floor)) break;
          s.facing = paddle.x > s.x ? 1 : -1;
          s.timer -= dt;
          if (s.timer <= 0) this.launch(s, paddle, top - floor);
          break;
        case 'fly': {
          // A steered arc: it keeps re-aiming at the paddle (at a limited rate, so a quick paddle can still
          // dodge it), rising off the floor, over and down onto the paddle's top.
          s.flown += dt;
          const goal = this.inOpen(paddle.x + paddle.vx * Math.max(0, s.flight - s.flown) * SCARAB.aimLead + s.aim);
          s.tx += Math.max(-SCARAB.flySteer * dt, Math.min(SCARAB.flySteer * dt, goal - s.tx));
          const u = Math.min(1, s.flown / s.flight);
          // Slow to lift off and to flare in, quickest across the middle.
          const along = 0.5 - 0.5 * Math.cos(Math.PI * u);
          const bob = 0.1 * Math.sin(s.age * 9 + s.seed * 7) * Math.sin(Math.PI * u);
          s.x = lerp(s.sx, s.tx, along);
          s.y = lerp(s.sy, top - SCARAB.flySink, u) + s.arc * Math.sin(Math.PI * u) + bob;
          s.facing = s.x >= s.px ? 1 : -1;
          if (this.touchPaddle(s, paddle)) break;
          if (u >= 1) {
            // Missed: it drops the rest of the way, still buzzing (giving up any place it was called back for).
            s.back = false;
            s.state = 'hop';
            s.vx = ((s.x - s.px) / dt) * 0.6;
            s.vy = Math.min(0, (s.y - s.py) / dt);
          }
          break;
        }
        case 'hop': {
          const g = s.mode === 'fly' ? SCARAB.flyFall : SCARAB.hopGravity;
          s.vy -= g * dt;
          s.x += s.vx * dt;
          s.y += s.vy * dt;
          if (this.touchPaddle(s, paddle)) break;
          if (s.y <= floor) {
            // Missed altogether: down on the floor, it picks itself up before turning back.
            s.y = floor;
            s.state = 'land';
            s.timer = s.mode === 'fly' ? SCARAB.flyLand : SCARAB.hopLand;
            this.events.emit('scarabLand', { x: s.x, y: s.y, fly: s.mode === 'fly' });
          }
          break;
        }
        case 'land':
          s.y = floor;
          if (this.keepClear(s, paddle, top - floor)) break;
          s.timer -= dt;
          if (s.timer <= 0) {
            s.state = 'crawl';
            this.planLeap(s);
          }
          break;
        case 'away':
          this.away(s, dt, paddle);
          break;
        case 'cling':
          this.scuttle(s, dt, paddle);
          s.x = paddle.x + s.offset * half;
          s.y = top;
          break;
        case 'crushed':
          // Squashed flat where it clung, riding the paddle until it is gone.
          s.x = paddle.x + s.offset * half;
          s.y = top;
          s.timer -= dt;
          if (s.timer <= 0) s.active = false;
          break;
      }
      // Whatever just happened (coming down from a leap or out of the nest, or a paddle too quick to run
      // from), one on the floor is never left inside the paddle.
      if (ScarabSystem.grounded(s) && this.edgeGap(s, paddle) < 0) this.keepClear(s, paddle, top - floor);
    }
    this.spreadFloor(dt, paddle, top - floor);
    this.spreadAir(dt);
  }

  /** Rested, so it may take off. */
  private readyToFly(s: Scarab): boolean {
    return s.rest <= 0;
  }

  /** Opens its wings to take off (launch() sends it off into the scene if the paddle is still full). */
  private crouchToFly(s: Scarab): void {
    s.mode = 'fly';
    s.state = 'crouch';
    s.timer = SCARAB.flyCrouch;
  }

  /** Up and off into the scene, the paddle being full. */
  private startAway(s: Scarab): void {
    s.state = 'away';
    s.mode = 'fly';
    s.vx = 0;
    s.vy = 5;
    s.depth = 0;
    s.back = false;
    s.flown = 0;
    // Its swirl starts round a centre above it: at the side of the circle it is on, swinging the way it faced.
    s.heading = s.facing > 0 ? Math.PI : 0;
    s.sx = s.x - SCARAB.swirlRadius * Math.cos(s.heading);
    s.sy = s.y + 3;
    this.retarget(s);
    this.events.emit('scarabLeap', { x: s.x, y: s.y, fly: true, time: 0.2 });
  }

  /** Somewhere else out in the scene to head for: of a few tries, the one furthest from the others out there
   *  and where they are heading, so they don't crowd one another. */
  private retarget(s: Scarab): void {
    let best = -1;
    for (let i = 0; i < 5; i++) {
      const bx = this.rng.range(-SCARAB.awaySpread, SCARAB.awaySpread);
      const by = this.rng.range(SCARAB.awayHeight[0], SCARAB.awayHeight[1]);
      let room = Infinity;
      for (const o of this.items) {
        if (o === s || !o.active || o.state !== 'away') continue;
        room = Math.min(room, Math.hypot(o.bx - bx, o.by - by));
      }
      if (room > best) {
        best = room;
        s.bx = bx;
        s.by = by;
      }
    }
    s.timer = this.rng.range(SCARAB.awayRetarget[0], SCARAB.awayRetarget[1]);
    this.events.emit('scarabBuzz', { x: s.x, y: s.y, time: s.timer, depth: s.depth });
  }

  /**
   * Calls back one away scarab for each free place on the paddle (and sends one back off again if a place
   * it was coming for has been taken meanwhile).
   */
  private callBack(): void {
    // Places are taken by riders and by every scarab nearer than those swirling about out there: on the floor
    // (they get first go), on the way up from it, or one already called back (it keeps its claim as it drops in).
    let taken = 0;
    for (const s of this.items) {
      if (!s.active || s.state === 'crushed' || (s.state === 'away' && !s.back)) continue;
      taken++;
    }
    for (let i = this.items.length - 1; i >= 0 && taken > SCARAB.maxClinging; i--) {
      const s = this.items[i];
      if (!s.active || s.state !== 'away' || !s.back) continue;
      s.back = false;
      taken--;
    }
    for (const s of this.items) {
      if (taken >= SCARAB.maxClinging) break;
      if (!s.active || s.state !== 'away' || s.back) continue;
      s.back = true;
      taken++;
      this.events.emit('scarabBuzz', { x: s.x, y: s.y, time: SCARAB.awayReturn, depth: s.depth });
    }
  }

  /**
   * Off in the scene: drifts out into the distance and about between spots out there. Called back, it comes
   * out of the distance towards the paddle and, back at the play, drops onto it.
   */
  private away(s: Scarab, dt: number, paddle: Paddle): void {
    const top = paddle.y + PADDLE.halfH;
    if (s.back) {
      s.depth = Math.max(0, s.depth - dt / SCARAB.awayReturn);
      if (s.depth <= 0) {
        // Down onto the paddle: a short steered flight from where it is.
        s.state = 'fly';
        s.sx = s.x;
        s.sy = s.y;
        s.aim = this.rng.range(-1, 1) * paddle.width * 0.25;
        s.tx = this.inOpen(paddle.x + s.aim);
        s.arc = 0.4;
        s.flown = 0;
        s.flight = Math.max(0.45, Math.hypot(s.tx - s.x, s.y - top) / (SCARAB.flySpeed * 1.5));
        return;
      }
      // Coming straight out of the distance (towards the camera) to over the paddle, ready to swoop.
      const max = SCARAB.awaySpeed * 1.5;
      const k = Math.min(1, dt * SCARAB.awaySteer);
      const want = (d: number): number => Math.max(-max, Math.min(max, d * 2));
      s.vx += (want(paddle.x - s.x) - s.vx) * k;
      s.vy += (want(top + 2.5 - s.y) - s.vy) * k;
      s.heading = Math.atan2(s.vy, s.vx);
      s.x = this.inField(s.x + s.vx * dt);
      s.y = Math.max(top + 0.6, s.y + s.vy * dt);
      return;
    }
    s.flown += dt;
    s.timer -= dt;
    if (s.timer <= 0) this.retarget(s);
    // The swirl's centre drifts towards its spot.
    const drift = Math.min(1, dt * SCARAB.swirlDrift);
    s.sx += (s.bx - s.sx) * drift;
    s.sy += (top + s.by - s.sy) * drift;
    // Round and round a horizontal circle (some one way, some the other): side to side across the scene, and
    // in and out of the distance, far at the back of each loop and near at the front.
    const spin = (s.seed * 1.618) % 1 < 0.5 ? 1 : -1;
    s.heading += spin * this.scaled(SCARAB.swirlRate) * dt;
    const goalX = this.inField(s.sx + SCARAB.swirlRadius * Math.cos(s.heading));
    const goalY = s.sy + SCARAB.swirlBob * Math.sin(2 * s.heading + s.seed * 5);
    const [near, far] = SCARAB.swirlDepth;
    const swirl = near + (far - near) * (0.5 + 0.5 * Math.sin(s.heading));
    // Out from the play to the swirl as it leaves.
    const leave = Math.min(1, s.flown / SCARAB.awayLeave);
    s.depth = swirl * leave * leave * (3 - 2 * leave);
    // It chases its place round the loop: closely enough to follow it, never jumping.
    const max = SCARAB.awaySpeed * 2;
    const k = Math.min(1, dt * SCARAB.awaySteer);
    const want = (d: number): number => Math.max(-max, Math.min(max, d * 3));
    s.vx += (want(goalX - s.x) - s.vx) * k;
    s.vy += (want(goalY - s.y) - s.vy) * k;
    s.x = this.inField(s.x + s.vx * dt);
    // Never down through the floor (it takes off from there), and once off, kept above the paddle's top.
    s.y = Math.max(leave > 0.5 ? top + 0.8 : paddle.y - PADDLE.halfH, s.y + s.vy * dt);
    if (Math.abs(s.vx) > 0.3) s.facing = s.vx > 0 ? 1 : -1;
  }

  /** Keeps a flyer inside the sides of the world's ball area. */
  private inField(x: number): number {
    return Math.max(this.arenaLeft + SCARAB.radius, Math.min(this.arenaRight - SCARAB.radius, x));
  }

  /** Away scarabs at much the same depth and too close together ease apart, so two never look like one. */
  private spreadAir(dt: number): void {
    const k = Math.min(1, dt * SCARAB.spreadRate) / 2;
    for (let i = 0; i < this.items.length; i++) {
      const a = this.items[i];
      if (!a.active || a.state !== 'away') continue;
      for (let j = i + 1; j < this.items.length; j++) {
        const b = this.items[j];
        if (!b.active || b.state !== 'away' || Math.abs(a.depth - b.depth) > 0.3) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d = Math.hypot(dx, dy);
        const overlap = SPACING - d;
        if (overlap <= 0) continue;
        const ux = d > 1e-6 ? dx / d : 1;
        const uy = d > 1e-6 ? dy / d : 0;
        a.x -= ux * overlap * k;
        a.y -= uy * overlap * k;
        b.x += ux * overlap * k;
        b.y += uy * overlap * k;
      }
    }
  }

  /** A ball through a scarab flying off or back (not yet far off) knocks it tumbling out of the air. */
  private swat(balls: readonly Ball[]): void {
    for (const s of this.items) {
      if (!s.active || s.state !== 'away' || s.depth > 0.25) continue;
      for (const b of balls) {
        if (!b.active || b.stuck || Math.hypot(b.x - s.x, b.y - s.y) > SCARAB.swatReach) continue;
        s.state = 'hop';
        s.mode = 'fly';
        s.vx = Math.sign(s.x - b.x || 1) * this.rng.range(3, 5);
        s.vy = 2;
        s.depth = 0;
        s.back = false;
        this.events.emit('scarabSwatted', { x: s.x, y: s.y });
        break;
      }
    }
  }

  /**
   * A rider never sits still: it runs to a spot along the paddle, pauses, and picks another, always keeping its
   * whole body on top (scrambling straight in from an end it landed on, or one the paddle shrank away from).
   */
  private scuttle(s: Scarab, dt: number, paddle: Paddle): void {
    const half = paddle.width / 2;
    const limit = rideLimit(paddle);
    const before = s.offset;
    if (Math.abs(s.offset) > limit) {
      const edge = Math.sign(s.offset) * limit;
      s.offset =
        s.offset > 0
          ? Math.max(edge, s.offset - (SCARAB.scuttleRush * dt) / half)
          : Math.min(edge, s.offset + (SCARAB.scuttleRush * dt) / half);
    } else if (s.pause > 0) {
      s.pause -= dt;
    } else {
      const step = (this.scaled(SCARAB.scuttleSpeed) * dt) / half;
      const to = Math.max(-limit, Math.min(limit, s.goal));
      if (Math.abs(to - s.offset) <= step) {
        s.offset = to;
        s.pause = this.rng.range(SCARAB.scuttlePause[0], SCARAB.scuttlePause[1]);
        s.goal = this.nextGoal(s.offset, limit);
      } else s.offset += Math.sign(to - s.offset) * step;
    }
    // Its own speed along the paddle (for the walk), and the way it faces while it goes.
    s.vx = ((s.offset - before) * half) / dt;
    if (Math.abs(s.vx) > 0.05) s.facing = s.vx > 0 ? 1 : -1;
  }

  /** Somewhere else along the paddle to run to: at least a third of its reach away. */
  private nextGoal(from: number, limit: number): number {
    if (limit <= 0) return 0;
    for (let i = 0; i < 4; i++) {
      const g = this.rng.range(-limit, limit);
      if (Math.abs(g - from) >= limit * 0.66) return g;
    }
    return from > 0 ? -limit : limit;
  }

  /** Floor a crawler can cover before it comes up behind the next scarab the way it is heading. */
  private roomAhead(s: Scarab): number {
    let room = Infinity;
    for (const o of this.items) {
      if (o === s || !o.active || !ScarabSystem.grounded(o)) continue;
      const ahead = (o.x - s.x) * s.facing;
      if (ahead > 0) room = Math.min(room, ahead - SPACING);
    }
    return Math.max(0, room);
  }

  /** Scarabs on the floor closer than SPACING (landing together, say) ease apart, never into the paddle. */
  private spreadFloor(dt: number, paddle: Paddle, height: number): void {
    const k = Math.min(1, dt * SCARAB.spreadRate) / 2;
    for (let i = 0; i < this.items.length; i++) {
      const a = this.items[i];
      if (!a.active || !ScarabSystem.grounded(a)) continue;
      for (let j = i + 1; j < this.items.length; j++) {
        const b = this.items[j];
        if (!b.active || !ScarabSystem.grounded(b)) continue;
        const d = b.x - a.x;
        const overlap = SPACING - Math.abs(d);
        if (overlap <= 0) continue;
        const dir = d === 0 ? 1 : Math.sign(d);
        a.x -= dir * overlap * k;
        b.x += dir * overlap * k;
      }
    }
    for (const s of this.items)
      if (s.active && ScarabSystem.grounded(s) && this.edgeGap(s, paddle) < 0) this.keepClear(s, paddle, height);
  }

  /** On the floor (where it must keep clear of the paddle). */
  static grounded(s: Scarab): boolean {
    return (
      s.state === 'crawl' || s.state === 'wait' || s.state === 'flee' || s.state === 'crouch' || s.state === 'land'
    );
  }

  /** Picks how and from how far it will next go for the paddle, and a moment to gather itself first. */
  private planLeap(s: Scarab): void {
    s.mode = this.rng.next() < this.scaled(SCARAB.flyChance) ? 'fly' : 'hop';
    const reach = s.mode === 'fly' ? SCARAB.flyReach : SCARAB.hopReach;
    s.leapAt = this.rng.range(reach[0], reach[1]);
    s.rest = this.rng.range(SCARAB.regroup[0], SCARAB.regroup[1]);
  }

  /** Keeps a landing spot on the open floor, between where the nests' walk-ins reach it. */
  private inOpen(x: number): number {
    return Math.max(this.openLeft, Math.min(this.openRight, x));
  }

  /** Takes off for where the paddle will be, give or take a scatter that can make it miss. */
  private launch(s: Scarab, paddle: Paddle, height: number): void {
    const scatter = this.rng.range(-1, 1) * this.scaled(SCARAB.aimScatter);
    const fly = s.mode === 'fly';
    const roughly = Math.abs(paddle.x + scatter - s.x);
    const time = Math.max(
      fly ? SCARAB.flyMinTime : SCARAB.hopMinTime,
      roughly / (fly ? SCARAB.flySpeed : SCARAB.hopSpeed),
    );
    const target = this.inOpen(paddle.x + paddle.vx * time * SCARAB.aimLead + scatter);
    s.facing = target >= s.x ? 1 : -1;
    s.back = false;
    if (fly && !this.room) {
      // Still full: it flies off into the scene instead.
      this.startAway(s);
      return;
    }
    if (fly) {
      s.state = 'fly';
      s.sx = s.x;
      s.sy = s.y;
      s.tx = target;
      s.aim = scatter;
      s.arc = this.rng.range(SCARAB.flyArc[0], SCARAB.flyArc[1]);
      s.flown = 0;
      s.flight = time;
    } else {
      // Ballistic: up and over, coming down level with the paddle's top as it arrives.
      s.state = 'hop';
      s.vx = (target - s.x) / time;
      s.vy = (height + (SCARAB.hopGravity * time * time) / 2) / time;
    }
    this.events.emit('scarabLeap', { x: s.x, y: s.y, fly, time });
  }

  /**
   * In the air: comes down onto the paddle's (possibly tilted) top and grabs on, or knocks against its end
   * and drops away. True if it touched.
   */
  private touchPaddle(s: Scarab, paddle: Paddle): boolean {
    const half = paddle.width / 2;
    const tilt = Math.tan(paddleSlope(paddle));
    const topAt = (x: number): number => paddle.y + PADDLE.halfH + (x - paddle.x) * tilt;
    const over = Math.abs(s.x - paddle.x) <= half - 0.1;
    if (over && s.y < s.py && s.py >= topAt(s.px) - 0.05 && s.y <= topAt(s.x)) {
      if (this.clinging < SCARAB.maxClinging) {
        // Its momentum shoves the paddle on the way it was going, away from where it came from.
        const going = Math.sign(s.x - s.px) || s.facing;
        const shove = going * this.scaled(SCARAB.landShove);
        paddle.shove += shove;
        s.state = 'cling';
        s.offset = Math.max(-1, Math.min(1, (s.x - paddle.x) / half));
        s.x = paddle.x + s.offset * half;
        s.y = paddle.y + PADDLE.halfH;
        s.lane = this.items.some(
          (o) => o !== s && o.active && (o.state === 'cling' || o.state === 'crushed') && o.lane === 0,
        )
          ? 1
          : 0;
        s.pause = this.rng.range(SCARAB.scuttlePause[0], SCARAB.scuttlePause[1]);
        s.goal = this.nextGoal(s.offset, rideLimit(paddle));
        this.events.emit('scarabCling', { x: s.x, y: s.y });
      } else {
        // No room: it bounces off the others.
        this.knock(s, Math.sign(s.x - paddle.x) || s.facing, 5);
      }
      return true;
    }
    const was = Math.abs(s.px - paddle.x) > half + 0.3;
    if (was && Math.abs(s.x - paddle.x) <= half + 0.3 && s.y < topAt(s.x) && s.y > paddle.y - PADDLE.halfH) {
      this.knock(s, Math.sign(s.px - paddle.x) || -s.facing, 1.5);
      return true;
    }
    return false;
  }

  /** Bounced off the paddle: falls back the way it came. */
  private knock(s: Scarab, dir: number, up: number): void {
    s.state = 'hop';
    s.x = s.px;
    s.vx = dir * this.rng.range(1.5, 3);
    s.vy = up;
    this.events.emit('scarabBump', { x: s.x, y: s.y });
  }

  /** Room for another on the paddle. */
  private get room(): boolean {
    return this.clinging < SCARAB.maxClinging;
  }

  /** Floor between the scarab's body and the paddle's nearer end (negative: they overlap). */
  private edgeGap(s: Scarab, paddle: Paddle): number {
    return Math.abs(paddle.x - s.x) - paddle.width / 2 - BODY;
  }

  /** Backed up against the edge of the open floor on the side it would run to. */
  private cornered(s: Scarab, away: number): boolean {
    return away < 0 ? s.x - this.openLeft < 1 : this.openRight - s.x < 1;
  }

  /**
   * On the floor, never lets the paddle run into it: brought within SCARAB.startle, it springs up onto the
   * paddle if there is room, and otherwise scuttles off (or, cornered, leaps over). True if it reacted.
   */
  private keepClear(s: Scarab, paddle: Paddle, height: number): boolean {
    const gap = this.edgeGap(s, paddle);
    if (gap > SCARAB.startle) return false;
    const side = s.x < paddle.x ? -1 : 1;
    // A paddle fast enough to get past the warning in one step: it is never left inside it.
    if (gap < 0) s.x = paddle.x + side * (paddle.width / 2 + BODY);
    if (this.room) this.springOnto(s, paddle, height, side);
    else if (gap < SCARAB.startle * 0.4 || this.cornered(s, side)) this.leapOver(s, paddle, side);
    else {
      s.state = 'flee';
      s.timer = SCARAB.fleeTime;
      s.facing = side > 0 ? 1 : -1;
    }
    return true;
  }

  /** Startled at close quarters: a quick, steep spring up and onto the near end of the paddle. */
  private springOnto(s: Scarab, paddle: Paddle, height: number, side: number): void {
    const vy = SCARAB.startleLift;
    const g = SCARAB.hopGravity;
    // Time until it comes back down to the paddle's top.
    const time = (vy + Math.sqrt(Math.max(0, vy * vy - 2 * g * height))) / g;
    const lead = Math.max(-SCARAB.startleLead, Math.min(SCARAB.startleLead, paddle.vx * time));
    const target = paddle.x + lead + side * (paddle.width / 2) * 0.45;
    s.state = 'hop';
    s.mode = 'hop';
    s.vx = (target - s.x) / time;
    s.vy = vy;
    s.facing = target >= s.x ? 1 : -1;
    this.events.emit('scarabLeap', { x: s.x, y: s.y, fly: false, time });
  }

  /** No room on the paddle and nowhere to run: a high leap right over it, to the floor on the far side. */
  private leapOver(s: Scarab, paddle: Paddle, side: number): void {
    const time = SCARAB.leapOverTime;
    let target = this.inOpen(paddle.x - side * (paddle.width / 2 + BODY + 1.2) + paddle.vx * time * 0.5);
    // Squeezed against the far wall too: it comes down back on this side.
    if (Math.abs(target - paddle.x) < paddle.width / 2 + BODY)
      target = this.inOpen(paddle.x + side * (paddle.width / 2 + BODY + 1.2));
    s.state = 'hop';
    s.mode = 'hop';
    s.vx = (target - s.x) / time;
    s.vy = (SCARAB.hopGravity * time) / 2;
    s.facing = target >= s.x ? 1 : -1;
    this.events.emit('scarabLeap', { x: s.x, y: s.y, fly: false, time });
  }
}
