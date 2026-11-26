import type { Brick, DamageCause, PowerUpKind } from './types';
import type { WeatherKind } from './weather/weathers';

/** Everything the simulation announces. Views, audio and flow control subscribe; the sim never calls them. */
export interface GameEvents {
  levelLoaded: { index: number; name: string };
  ballLaunched: { x: number; y: number };
  ballWall: { x: number; y: number; nx: number; ny: number };
  ballPaddle: { x: number; y: number; offset: number; caught: boolean };
  ballLost: { x: number; remaining: number };
  ballsSplit: { x: number; y: number };
  brickHit: { brick: Brick; x: number; y: number; nx: number; ny: number };
  brickDestroyed: { brick: Brick; cause: DamageCause; points: number; combo: number };
  brickSpawned: { brick: Brick };
  explosion: { x: number; y: number };
  /** A Refrakt ball shattered a brick; its light splashes onto the neighbours. (x, y) is the brick, (dirX, dirY) the ball's travel as it hit. */
  refraktBurst: { x: number; y: number; dirX: number; dirY: number };
  /** A Prism brick broke and the ball turned to Refrakt light; (x, y) is the brick. */
  refraktStarted: { x: number; y: number };
  /** Refrakt ran out (`cut` when a lost life or a level change ended it early, with no send-off). */
  refraktEnded: { cut: boolean };
  comboChanged: { combo: number; multiplier: number };
  powerUpCollected: { kind: PowerUpKind; x: number; y: number };
  /** A timed power ran out; x is the paddle's position. */
  powerUpExpired: { kind: PowerUpKind; x: number };
  /** A timed power is about to run out: `left` whole seconds remain (POWER_WARN down to 1); x is the paddle's position. */
  powerUpWarning: { kind: PowerUpKind; left: number; x: number };
  shieldHit: { x: number; charges: number };
  laserFired: { x: number; y: number };
  laserHit: { x: number; y: number };
  lifeLost: { lives: number };
  gameOver: { score: number };
  levelCleared: { index: number; bonus: number };
  /** The world's weather storms (gameplay/weather/WeatherClock.ts): a gust, a lightning strike, the tomb shaking. */
  weatherStorm: { kind: WeatherKind };
  /** A wall snake starts its warning; (x, y) is its den. */
  snakeWarn: { x: number; y: number };
  snakeStrike: { x: number; y: number };
  /** A snake bit the paddle; (x, y) is the head. */
  paddleBitten: { x: number; y: number };
  /** An icicle starts to crack before it drops; (x, y) is where it hangs from the ceiling. */
  icicleWarn: { x: number; y: number };
  icicleFall: { x: number; y: number };
  /** The ball knocked a hanging icicle off the ceiling; (x, y) is where it hung. */
  icicleKnocked: { x: number; y: number };
  /** An icicle broke: hit by the ball (`byBall`) or smashed on the floor. (x, y) is its middle or tip. */
  icicleShatter: { x: number; y: number; byBall: boolean };
  /** A falling icicle landed on the paddle and froze it; (x, y) is the tip. */
  paddleStruck: { x: number; y: number };
  /** A scarab nest stirs before its swarm; (x, y) is the foot of its cover's inner edge. */
  scarabWarn: { x: number; y: number };
  /** One scarab sets off from its nest; (x, y) is the nest. */
  scarabEmerge: { x: number; y: number };
  /** A scarab climbed onto the paddle; (x, y) is where it clings. */
  scarabCling: { x: number; y: number };
  /** A clinging scarab was thrown off (by a hard swing or a ball bounce). */
  scarabCrushed: { x: number; y: number };
  /** A scarab takes off for the paddle: a hop, or a flight (`time`: seconds it plans to be in the air). */
  scarabLeap: { x: number; y: number; fly: boolean; time: number };
  /** A scarab that missed the paddle lands on the floor. */
  scarabLand: { x: number; y: number; fly: boolean };
  /** A scarab in the air knocks against the paddle and drops away. */
  scarabBump: { x: number; y: number };
  /** A scarab off in the scene while the paddle is full heads somewhere new, or starts back ('time': seconds
   *  of flying; 'depth': 0 at the play to 1 far off, for how loud it is). */
  scarabBuzz: { x: number; y: number; time: number; depth: number };
  /** A ball swatted a flying scarab out of the air. */
  scarabSwatted: { x: number; y: number };
  /** The ball struck a stirring nest's cover and scared the swarm back; (x, y) is where the ball was. */
  scarabScared: { x: number; y: number };
}
