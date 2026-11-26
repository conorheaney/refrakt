import type { EventBus } from '../engine/core/EventBus';
import type { Pool } from '../engine/core/Pool';
import type { Random } from '../engine/core/Random';
import type { WorldDef } from '../content/worlds';
import type { PolygonBoundary } from './arena/boundary';
import type { BallPhysics } from './balls/BallPhysics';
import type { BrickField } from './bricks/BrickField';
import type { FieldDef, GridDef } from './config';
import type { GameEvents } from './events';
import type { ScarabSystem } from './hazards/scarabs/scarabs';
import type { PowerUpSystem } from './powerups/PowerUpSystem';
import type { Ball, Paddle, WorldPhase } from './types';

/**
 * The part of World its systems (BallPhysics, BrickField, PowerUpSystem) work through: the
 * shared game state and each other. World implements it and hands itself to each system, so a system's
 * dependencies are spelled out here rather than reached through World's whole surface.
 */
export interface WorldContext {
  readonly events: EventBus<GameEvents>;
  /** The simulation's main random stream (launch angles, drops). Hazards use their own. */
  readonly rng: Random;
  readonly time: number;
  phase: WorldPhase;
  /** Attract mode: infinite lives, auto-launch, no score bonuses. */
  readonly demo: boolean;

  score: number;
  lives: number;
  readonly combo: number;
  readonly multiplier: number;
  setCombo(combo: number): void;
  /** Ends the current life (every ball is gone). */
  loseLife(): void;

  // Arena
  readonly worldDef: WorldDef;
  /** The world's template arena: framing and effects only; the walls are `boundary`. */
  readonly field: FieldDef;
  readonly grid: GridDef;
  /** The walls: the world's drawn ball area. */
  readonly boundary: PolygonBoundary;
  /** Below this, falling power-ups have left the arena (under both the drain and the paddle). */
  readonly lowerLimit: number;

  // Player
  readonly paddle: Paddle;
  readonly balls: Pool<Ball>;
  shieldCharges: number;
  readonly shieldY: number;
  readonly shieldLeft: number;
  readonly shieldRight: number;
  /** Seconds of Refrakt left (started by breaking a Prism brick). */
  refraktTime: number;

  // Systems
  readonly ballPhysics: BallPhysics;
  readonly brickField: BrickField;
  readonly powerUps: PowerUpSystem;
  readonly scarabs: ScarabSystem;
}
