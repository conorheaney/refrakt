import { BrickKind } from './types';

/** Simulation runs at a fixed 120 Hz regardless of display refresh rate. */
export const SIM = {
  step: 1 / 120,
  maxStepsPerFrame: 12,
} as const;

/**
 * The arena's bounds in the XY plane (z = 0), in "world units". Each world has its own (see worlds.ts):
 * straight side walls at +/-halfWidth, a flat ceiling at `top`, joined by quarter-circle corners of
 * `cornerRadius`. The paddle rests on the floor (`floorY`), the barrier power-up lies on `shieldY`, and a
 * ball below `bottom` is lost.
 */
export interface FieldDef {
  readonly halfWidth: number;
  readonly top: number;
  readonly cornerRadius: number;
  readonly bottom: number;
  readonly floorY: number;
  readonly shieldY: number;
  /** How far from the centre either end of the paddle may travel (at most halfWidth). */
  readonly paddleReach: number;
}

/** Depth of the back wall behind the play plane (scenery and brick wall glows). */
export const WALL_Z = -6;

/**
 * The Space arena. It is framed (see CameraRig) to run from just under the HUD down to the studio floor
 * near the bottom of the frame; the paddle rests on the floor (`floorY`) and the barrier power-up sits on
 * the floor itself.
 */
export const FIELD = {
  halfWidth: 14,
  top: 10.4,
  /**
   * Radius of the arch frame's two rounded top corners. The frame's inner
   * surface is the physical boundary: straight sides at +/-halfWidth, a flat
   * top at `top`, joined by quarter circles of this radius.
   */
  cornerRadius: 3,
  bottom: -10.7,
  floorY: -9.8,
  shieldY: -9.8,
  paddleReach: 14,
} as const satisfies FieldDef;

/** The forest view looks down at the arena at the Space camera's pitch, so bricks and paddle show the same faces. */
const FOREST_PITCH = (14 * Math.PI) / 180;

/**
 * How far below the paddle's centre (y = -9.25) its drawn bottom edge appears on screen in the forest
 * view, in screen units: the chrome slab's front bottom edge (0.55 below the centre, 1.07 in front of the
 * playfield plane; see PaddleView in gameplay/entities/EntityViews.ts) seen at the forest pitch.
 */
const FOREST_PADDLE_DRAWN_DROP = 0.55 * Math.cos(FOREST_PITCH) + 1.07 * Math.sin(FOREST_PITCH);

/** Image y of the ceiling: just under the branch's underside, whose lowest dips reach px 103-106. */
const FOREST_CEILING_PX = 110;
/** Image y of the paddle's drawn bottom edge: 100 px above the bottom of the 941 px painting. */
const FOREST_PADDLE_BOTTOM_PX = 841;
/**
 * Image px per screen unit (and per world unit along x). The screen distance from the ceiling (world
 * y = 10.4) to the paddle's drawn bottom is the 19.65 units down to the paddle's centre, foreshortened by
 * the pitch, plus the paddle's drawn drop.
 */
const FOREST_PX_PER_UNIT = (FOREST_PADDLE_BOTTOM_PX - FOREST_CEILING_PX) / ((10.4 + 9.25) * Math.cos(FOREST_PITCH) + FOREST_PADDLE_DRAWN_DROP);

/**
 * The forest background painting (src/themes/scenery/forest/background.webp, 1672 x 941 px): a woodland with a
 * tall tree arch whose inside is the Forest arena. It fills the frame's height (see FOREST_VIEW in
 * gameplay/CameraRig.ts), drawn undistorted at a single scale chosen so the Space arena's height runs from
 * the underside of the branch (the ceiling, px y 110) down to the paddle, whose drawn bottom edge lands at
 * px y 841, 100 px above the bottom of the painting. The view is orthographic but pitched down like the
 * Space camera, so on screen a world unit along y is cos(pitch) of one along x. On the playfield plane
 * (z = 0), image px (px, py) <-> world (x, y): x = (px - centrePx) / pxPerUnit,
 * y = FIELD.top - (py - ceilingPx) / pxPerUnitY.
 */
export const FOREST_ART = {
  widthPx: 1672,
  heightPx: 941,
  /** Image x of world x = 0 (the image's centre column; the arch is symmetric about it to within 2 px). */
  centrePx: 836,
  /** Image y of the ceiling (world y = FIELD.top). */
  ceilingPx: FOREST_CEILING_PX,
  /** Image y of the paddle's drawn bottom edge at rest. */
  paddleBottomPx: FOREST_PADDLE_BOTTOM_PX,
  /** Screen units between the paddle's centre and its drawn bottom edge. */
  paddleDrawnDrop: FOREST_PADDLE_DRAWN_DROP,
  /** Downward tilt of the view, radians (the Space camera's). */
  pitch: FOREST_PITCH,
  /** Image px per world unit along y on the playfield plane. */
  pxPerUnitY: FOREST_PX_PER_UNIT * Math.cos(FOREST_PITCH),
  /** Image px per world unit along x, and per unit of screen distance. */
  pxPerUnit: FOREST_PX_PER_UNIT,
} as const;

/**
 * The Forest arena: the inside of the painted tree arch, at the same heights as the Space arena (so the
 * Space bricks, ball and paddle and every level layout fit exactly as they do there) but wider. In image
 * px: walls at x 268 and 1404 (the trunks' inner edges run at 259-268 and 1406-1411 from the corners down
 * to about y 600), ceiling at y 110, top corners rounded with a 170 px radius to follow the bend where
 * trunk meets branch, floor (barrier) at y 831 and the ball is lost below y 864. The roots flare in
 * steeply below about y 650 (to x 419 and 1277 at y 840); the paddle travels the full width between the
 * walls and is drawn in front of the roots, so it can reach every ball.
 */
export const FOREST_FIELD = {
  halfWidth: 568 / FOREST_ART.pxPerUnit,
  top: FIELD.top,
  cornerRadius: 170 / FOREST_ART.pxPerUnit,
  bottom: FIELD.bottom,
  floorY: FIELD.floorY,
  shieldY: FIELD.shieldY,
  paddleReach: 568 / FOREST_ART.pxPerUnit,
} as const satisfies FieldDef;

/** Brick cell layout. Every world shares the same cols x rows; cell size and placement may differ. */
export interface GridDef {
  readonly cols: number;
  readonly rows: number;
  readonly cellW: number;
  readonly cellH: number;
  readonly halfW: number;
  readonly halfH: number;
  readonly depth: number;
  /** Centre of row 0. */
  readonly topY: number;
}

/** Brick cells. Bricks are 12% smaller than the original 2 x 1.25 cells, with the same small gaps. */
export const GRID = {
  cols: 13,
  rows: 12,
  cellW: 1.76,
  cellH: 1.1,
  halfW: 0.845,
  halfH: 0.515,
  depth: 0.88,
  /** Centre of row 0: leaves one ball diameter (plus a hair) between the top row and FIELD.top. */
  topY: 8.8,
} as const satisfies GridDef;

export const BALL = {
  radius: 0.5,
  baseSpeed: 9.6,
  speedPerLevel: 0.36,
  speedPerPaddleHit: 0.06,
  maxSpeedBonus: 3.2,
  /** Minimum |dy| of the unit direction; prevents endless horizontal rallies on the wide field. */
  minVertical: 0.26,
  capacity: 24,
  slowFactor: 0.62,
  maxBouncesPerStep: 6,
  magnetHoldTime: 3,
} as const;

export const PADDLE = {
  /** Resting on the floor: FIELD.floorY + halfH. */
  y: -9.25,
  halfH: 0.55,
  width: 4.2,
  /** The EXPAND power-up keeps its original 1.5x ratio to the base width. */
  expandedWidth: 6.3,
  /** Pointer chase speed cap (units/s): the paddle trails fast mouse flicks instead of snapping to them. */
  pointerSpeed: 80,
  keySpeed: 32,
  /** Maximum deflection from vertical, radians. */
  maxBounceAngle: 1.1,
  stunTime: 0.8,
} as const;

export const PLAYER = {
  lives: 3,
  maxLives: 6,
  respawnDelay: 1.0,
  comboStep: 4,
  maxMultiplier: 10,
} as const;

export const LASER = {
  speed: 28,
  cooldown: 0.3,
  halfLength: 0.4,
  capacity: 32,
  bossDamage: 0.5,
} as const;

export const DROP = {
  speed: 4.6,
  /** Chance that a breakable brick releases a power-up when destroyed. */
  chance: 0.06,
  /** Most power-ups falling at the same time. */
  maxActive: 2,
  /** Most power-ups released in a single level (reset on level load). */
  maxPerLevel: 4,
  capacity: 12,
  halfW: 0.6,
  halfH: 0.5,
} as const;

export const SHOT = {
  radius: 0.3,
  capacity: 48,
} as const;

/**
 * Boss firing. Each boss's base gap between volleys is `fireInterval` in levels.ts; as it is damaged
 * (stage 0 -> 1 -> 2) the gap is divided by (1 + stage * stageSpeedup).
 */
export const BOSS_FIRE = {
  stageSpeedup: 0.2,
  /**
   * Extra breathing room before the first volley of a boss fight, on top of `fireInterval`. The timer
   * only runs while the ball is in play, so this counts from the launch.
   */
  openingDelay: 3,
} as const;

/** Grid rows (inclusive) where a summoning boss revives bricks: the band just beneath it. */
export const BOSS_SUMMON = {
  firstRow: 5,
  lastRow: 8,
  perWave: 4,
} as const;

/**
 * Falling icicles (gameplay/hazards/icicles/icicles.ts). Icicles hang from the arena ceiling; every so often the one nearest the
 * paddle glints and cracks (the warning), then drops straight down. One that lands on the paddle shatters
 * and sets it wobbling for `tiltTime` seconds, dipped first on the side it struck; after `pushDelay` it
 * shoves the paddle up to `push` units the other way. The ball knocks a hanging icicle loose
 * (it falls like a dropped one) and shatters one that is falling (scoring `score`); a shattered or fallen
 * icicle grows back over `regrow` seconds. Pairs are [first level
 * of the world, tenth level]. Timers only run while the ball is in play.
 */
export const ICICLE = {
  /** Extra wait before a level's first drop, on top of a normal wait. */
  firstDelay: 2.5,
  waitMin: [3.5, 1.8],
  waitMax: [7, 3.5],
  warn: [1, 0.65],
  /** Fall acceleration, world units per second squared. */
  gravity: 26,
  /** How far beyond the paddle's edges an icicle can be and still be chosen to drop. */
  aim: 2.5,
  /** Wait before trying again when no grown icicle is near the paddle or too many are falling. */
  retry: [0.6, 1.4],
  /** How many may be warning or falling at once. */
  maxFalling: [1, 2],
  regrow: [6, 3.5],
  /** Downward speed an icicle starts with when the ball knocks it off the ceiling. */
  knockSpeed: 1.5,
  /** Furthest a falling icicle's blow shoves the paddle (a hit right on its end). */
  push: 3.2,
  /** How quickly the shove plays out (fraction of the remaining distance per second). */
  pushRate: 5,
  /** Seconds into the wobble before the shove starts. */
  pushDelay: 0.12,
  /** Seconds the paddle wobbles after a blow. */
  tiltTime: 0.9,
  /** Half-width of an icicle's body, for the ball touching it (its root flares wider, in the lintel). */
  radius: 0.27,
  score: 25,
} as const;

/**
 * Wall snakes (gameplay/hazards/snakes/snakes.ts). Each one waits in its den, rears back with a warning, lunges at where the
 * paddle was when the warning began, holds briefly and pulls back. Pairs are [first level of the world,
 * tenth level]: later levels wait less and warn more briefly. Timers only run while the ball is in play.
 */
export const SNAKE = {
  /** Extra wait before a level's first strike, on top of a normal wait. */
  firstDelay: 3,
  waitMin: [4, 2.5],
  waitMax: [9, 5.5],
  warn: [0.8, 0.55],
  strike: 0.12,
  hold: 0.28,
  retract: 0.45,
  /** How far back (as a fraction of the strike) the head rears during the warning. */
  rear: 0.16,
  /** Collision radius of the head. */
  headRadius: 0.45,
  /** Strike height above the paddle's centre. */
  aimLift: 0.15,
  /** Chance of a warning-and-lunge anyway when the paddle is out of reach (a feint; it can still connect). */
  feintChance: 0.3,
  /** Wait before trying again when the paddle is out of reach or another snake is busy. */
  retry: [0.8, 1.8],
} as const;

/**
 * Scarab nests (gameplay/hazards/scarabs/scarabs.ts). Each nest is a spawn point with the path its scarabs walk in
 * along. Each storm (see grind below) the nests stir (sand trickles and antennae peek out), then let out a small
 * swarm that walks in and crawls along the floor after the paddle. From a random distance
 * (`hopReach` / `flyReach` short of the paddle's nearer end) it crouches and hops, or opens its wing cases and
 * flies, at where the paddle will be, give or take `aimScatter`; a flyer keeps re-aiming as it goes, but only
 * at `flySteer`, so a quick paddle can dodge it. One that misses lands, recovers, turns round and tries again.
 * One that lands on the paddle clings where it came down, and its weight tips the paddle down on that side:
 * `fullLean` worth of summed cling offsets (-1 left end .. 1 right end) gives a full lean, which turns every
 * bounce up to `leanKick` radians towards the low end (as off a sloping mirror). With riders on both ends the
 * paddle see-saws between them (`teeter*`). The only way to get one off is to return the ball off it: a
 * paddle bounce crushes a clinging scarab only if the ball comes down within `crushReach` of it; nothing else
 * kills one. On the floor they never let the paddle run into them: brought within `startle` of it, one springs
 * up onto it, or with no room on it scuttles off (`flee*`) or leaps over it; while it is full the rest wait
 * `holdOff` away. The ball coming within `scareReach` of where a stirring nest shows
 * scares the swarm back for `scared` seconds (scoring `scareScore`). Pairs are [first level of the world,
 * tenth level]. Timers only run while the ball is in play.
 */
export const SCARAB = {
  /**
   * Scarabs only come with a storm: a stone gate starts grinding open (the nests stir), and `grind` seconds
   * into it the dust storm blows in and the swarm comes out with it, the grinding carrying on under them. Seconds between storms, first level
   * to tenth (between waitMin and waitMax), with `firstDelay` more before a level's first.
   */
  firstDelay: 3,
  waitMin: [14, 9],
  waitMax: [22, 14],
  grind: 1,
  /** Scarabs per storm (shared between the nests), first level to tenth. */
  swarm: [2, 4],
  /** Seconds between scarabs leaving the crack. */
  stagger: 0.6,
  /** Seconds to scramble out of the crack down to the floor. */
  emerge: 0.35,
  /** Crawl speed along the floor, world units per second. */
  speed: [3.4, 4.6],
  /** Body half-length, for reaching the paddle. */
  radius: 0.9,
  /** Most that cling to the paddle at once, one on its front half and one on its back (two in a row on it
   *  would overlap); the rest wait nearby for a place to come free. */
  maxClinging: 2,
  /** Most scarabs out of their nests at once (clinging ones included). */
  maxActive: 6,
  /**
   * Bounce turn towards the low end at full lean, radians (about 43 degrees): twice the drawn paddle's slope,
   * as off a tilted mirror (gameplay/entities/EntityViews.ts derives the drawn tip from this).
   */
  leanKick: 0.75,
  /**
   * Any rider see-saws the paddle end to end: how far it rocks either way (1 = a full lean; past 1 it holds
   * fully over for a moment at each end), from a world's first level to its tenth...
   */
  teeterSwing: [1.1, 1.6],
  /** ...offset towards the end with more riders: this much when they are all on one side (2 v 1 gives a third). */
  teeterBias: 0.4,
  /** ...rocks per second with one rider, first level to tenth... */
  teeterHz: [0.8, 1.4],
  /** ...and how much quicker for each rider beyond the first. */
  teeterHzPerRider: 0.2,
  /** How quickly the paddle follows its lean, per second: brisk enough to keep up with the quickest rocking. */
  leanRate: 24,
  /** How far a scarab landing on the paddle shoves it on the way it was going (units, first level to tenth).
   *  Like a snake bite's (see BITE), it overrides the player's control while it plays out, so it shows even
   *  when the paddle is following a finger or the mouse. */
  landShove: [2.6, 4.2],
  /** Floor kept between scarabs' bodies, so a swarm queues up rather than piling into one spot. */
  crowdGap: 0.35,
  /** How quickly scarabs on the floor too close together ease apart, per second. */
  spreadRate: 10,
  /** Riders scuttle up and down the paddle: speed along it (units per second, first level to tenth)... */
  scuttleSpeed: [2.4, 3.6],
  /** ...pausing this long (seconds) between runs... */
  scuttlePause: [0.15, 0.7],
  /** ...and how quickly one that landed near an end (or is left there when the paddle shrinks) scrambles in. */
  scuttleRush: 8,
  /** Floor between a scarab's body and the paddle at which, on the floor, it reacts to the paddle coming at it. */
  startle: 0.7,
  /** A startled spring onto the paddle: upward speed, and the most it allows for the paddle's motion (units). */
  startleLift: 13,
  startleLead: 2.5,
  /** With no room on the paddle: scuttling out of its way (speed, seconds), or a leap over it (seconds in the air). */
  fleeSpeed: 12,
  fleeTime: 0.45,
  leapOverTime: 0.8,
  /**
   * How far off the paddle the next in line wait while it is full: the nearest on each side. The rest run
   * off and fly away.
   */
  holdOff: 1.6,
  /**
   * Those not next in line for a full paddle fly off into the scene (over awayLeave seconds) and swirl about
   * out there without pause: each loops round a horizontal circle swirlRadius across, swirlRate radians a
   * second, so it swings side to side and in and out of the distance (between the swirlDepth near and far,
   * 0 at the play to 1 as far off as it goes), bobbing swirlBob up and down. The circle's centre drifts
   * (swirlDrift per second) between spots up to awaySpread either side of the middle and awayHeight above the
   * paddle's top, picked every awayRetarget seconds. When a place comes free, one comes back for it (out of
   * the distance over awayReturn seconds, facing the camera as it comes, at up to awaySpeed, steering at
   * awaySteer per second) and swoops down onto the paddle.
   */
  awaySpread: 6,
  awayHeight: [3, 5.5],
  awayRetarget: [1, 2.2],
  awaySpeed: 5,
  swirlRadius: 3.5,
  swirlRate: [0.9, 1.3],
  swirlDepth: [0.35, 1],
  swirlBob: 0.8,
  swirlDrift: 0.6,
  awaySteer: 4,
  awayLeave: 1.3,
  awayReturn: 0.9,
  /** Ball centre within this distance of a scarab flying off or coming back (still near the play, not out in
   *  the distance) swats it out of the air (it tumbles to the floor). */
  swatReach: 1.1,
  /** Take-off distance from the paddle's nearer end (floor between it and the scarab's body), hop and flight. */
  hopReach: [0.8, 3],
  flyReach: [3.5, 8],
  /** Chance each attempt is a flight rather than a hop. */
  flyChance: [0.35, 0.55],
  /** Seconds winding up: a crouch to hop; opening the wing cases and unfolding the wings to fly. */
  hopCrouch: 0.18,
  flyCrouch: 0.42,
  /** A hop: gravity, horizontal speed and the shortest time in the air (enough to clear the paddle's top). */
  hopGravity: 34,
  hopSpeed: 7,
  hopMinTime: 0.45,
  /** A flight: horizontal speed, shortest time, extra height at the top of the arc, and how far below the
   *  paddle's top it aims to come down (so it settles onto it rather than skimming over). */
  flySpeed: 4.6,
  flyMinTime: 0.95,
  flyArc: [2, 3.2],
  flySink: 0.3,
  /** How quickly a flyer can re-aim at the moving paddle, units per second. */
  flySteer: 2.4,
  /** Gravity on a flyer that missed and is dropping to the floor (its wings still slow it). */
  flyFall: 14,
  /** Share of the paddle's motion during the leap a scarab allows for when it aims. */
  aimLead: 0.5,
  /** How far either side of the paddle's centre it may come down, units: wider than the paddle misses. */
  aimScatter: [2.6, 2],
  /** Seconds picking itself up after landing on the floor from a miss (a flyer folding its wings away). */
  hopLand: 0.3,
  flyLand: 0.5,
  /** Seconds before it tries again. */
  regroup: [0.4, 1],
  /** How close to a clinging scarab's middle a returned ball must land to crush it: its half-length plus the
   *  ball, so the ball has to come down on it. */
  crushReach: 1.4,
  /** Seconds a crushed scarab lies squashed on the paddle before it is gone. */
  crushed: 0.3,
  /** Ball centre within this distance of where a stirring nest shows (its warning) scares the swarm back. */
  scareReach: 2.5,
  scared: [10, 6],
  scareScore: 50,
  /** Wait before trying again when another nest is busy or too many scarabs are out. */
  retry: [0.8, 1.6],
} as const;

/**
 * A snake bite shoves the paddle `distance` units towards the centre (never past it). The push eases
 * out at `rate` per second (about a third of a second in all); player control returns once it ends.
 */
export const BITE = {
  distance: 5,
  rate: 16,
} as const;

export const PHASE_BRICK = {
  period: 4.2,
  solidTime: 2.7,
} as const;

/**
 * Refrakt: breaking a Prism brick turns the ball into spinning prismatic light, which shatters any brick
 * (not gunmetal) in one hit and splashes onto the bricks beside it.
 */
export const REFRAKT = {
  /** Seconds it lasts. */
  duration: 9,
  /**
   * Seconds the game holds still as the prism breaks, while its light show plays out (the burst, rings and
   * title are all timed to have cleared by then, so play resumes on a clear screen).
   */
  freeze: 1.5,
  /** Damage each brick next to (not diagonal from) a shattered brick takes from the refracted light. */
  splashDamage: 1,
  /** Damage to the boss per hit (a plain ball does 1). */
  bossDamage: 2,
} as const;

export const EXPLOSION = {
  fuse: 0.09,
  bossRange: 3.2,
  bossDamage: 3,
} as const;

export const BRICK_HP: Readonly<Record<BrickKind, number>> = {
  [BrickKind.Normal]: 1,
  [BrickKind.Tough]: 2,
  [BrickKind.Armored]: 3,
  [BrickKind.Steel]: 1,
  [BrickKind.Explosive]: 1,
  [BrickKind.Prism]: 1,
  [BrickKind.Phase]: 1,
};

export const BRICK_POINTS: Readonly<Record<BrickKind, number>> = {
  [BrickKind.Normal]: 50,
  [BrickKind.Tough]: 100,
  [BrickKind.Armored]: 160,
  [BrickKind.Steel]: 200,
  [BrickKind.Explosive]: 80,
  [BrickKind.Prism]: 120,
  [BrickKind.Phase]: 90,
};

/** Most charges the barrier can hold, and how many each BARRIER pickup adds (pickups stack up to the cap). */
export const SHIELD_CHARGES = 3;
export const SHIELD_PICKUP = 2;
/** Seconds left at which a timed power starts warning that it is about to run out (a tick each second, and its countdown strobes). */
export const POWER_WARN = 3;
export const POWERUP_SCORE = 250;

/** Number of power-up kinds the player picks before each level; only those can drop that level. */
export const LOADOUT_SIZE = 3;

/** Glass tints for normal bricks, cycled by row (sRGB hex): amber, rose, sapphire. */
export const ROW_PALETTE: readonly number[] = [0xff8424, 0xff4f9e, 0x2f84ff];
