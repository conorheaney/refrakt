import { BALL, PADDLE, PLAYER, SHIELD_CHARGES, SHIELD_PICKUP } from '../config';
import { PowerUpKind } from '../types';
import type { WorldContext } from '../WorldContext';

/**
 * What an active timed power-up changes while it runs. The simulation asks PowerUpSystem for these
 * (`grants`, `ballSpeedScale`) instead of checking particular kinds.
 */
export interface PowerUpModifiers {
  /** Multiplies the ball's speed. */
  readonly ballSpeedScale?: number;
  /** The ball smashes through bricks (not steel) without bouncing. */
  readonly pierce?: boolean;
  /** The paddle catches the ball on contact; it is released on input, after a hold, or when this ends. */
  readonly catchBall?: boolean;
  /** The paddle grows to the world's expanded width. */
  readonly widePaddle?: boolean;
  /** The paddle fires twin lasers. */
  readonly lasers?: boolean;
}

export type PowerUpFlag = Exclude<keyof PowerUpModifiers, 'ballSpeedScale'>;

/**
 * Everything about one kind of power-up: its look, its tuning and its rules. Adding a kind is one entry here
 * (plus its icon in powerups/icons.ts, which the compiler asks for).
 */
export interface PowerUpDef {
  readonly name: string;
  readonly letter: string;
  readonly color: number;
  /** Seconds the effect lasts; 0 for instant effects. */
  readonly duration: number;
  /** Relative chance among the kinds allowed to drop. */
  readonly weight: number;
  /** One line for the loadout picker. */
  readonly description: string;
  /** In force while the timer runs (timed kinds only). */
  readonly modifiers?: PowerUpModifiers;
  /** Runs on pickup, after a timed kind's timer is (re)started. */
  readonly onCollect?: (world: WorldContext, x: number, y: number) => void;
  /** Runs when a timed kind's timer runs out. */
  readonly onExpire?: (world: WorldContext) => void;
}

/** "<n> s" with a non-breaking space, so the unit never wraps onto its own line. */
const secs = (seconds: number): string => `${seconds} s`;

const EXPAND = 18;
const LASER = 12;
const SLOW = 10;
const FIRE = 8;
const MAGNET = 14;

export const POWERUPS: Readonly<Record<PowerUpKind, PowerUpDef>> = {
  [PowerUpKind.Expand]: {
    name: 'EXPAND',
    letter: 'E',
    color: 0x4dff88,
    duration: EXPAND,
    weight: 18,
    description: `Widens the paddle by ${Math.round((PADDLE.expandedWidth / PADDLE.width - 1) * 100)}% for ${secs(EXPAND)}.`,
    modifiers: { widePaddle: true },
  },
  [PowerUpKind.Multi]: {
    name: 'MULTIBALL',
    letter: 'M',
    color: 0x2be0ff,
    duration: 0,
    weight: 16,
    description: 'Splits every ball in play into three.',
    onCollect: (world) => world.ballPhysics.splitAll(),
  },
  [PowerUpKind.Laser]: {
    name: 'LASER',
    letter: 'L',
    color: 0xff3b6b,
    duration: LASER,
    weight: 14,
    description: `The paddle fires twin lasers for ${secs(LASER)}.`,
    modifiers: { lasers: true },
  },
  [PowerUpKind.Slow]: {
    name: 'SLOW',
    letter: 'S',
    color: 0x4d7dff,
    duration: SLOW,
    weight: 12,
    description: `Slows the ball to ${Math.round(BALL.slowFactor * 100)}% speed for ${secs(SLOW)}.`,
    modifiers: { ballSpeedScale: BALL.slowFactor },
  },
  [PowerUpKind.Fire]: {
    name: 'FIREBALL',
    letter: 'F',
    color: 0xff8a2b,
    duration: FIRE,
    weight: 10,
    description: `The ball smashes straight through bricks (not gunmetal) for ${secs(FIRE)}.`,
    modifiers: { pierce: true },
  },
  [PowerUpKind.Magnet]: {
    name: 'MAGNET',
    letter: 'U',
    color: 0xb04dff,
    duration: MAGNET,
    weight: 10,
    description: `The paddle catches the ball so you can aim the release, for ${secs(MAGNET)}.`,
    modifiers: { catchBall: true },
    onExpire: (world) => world.ballPhysics.launchStuck(),
  },
  [PowerUpKind.Shield]: {
    name: 'BARRIER',
    letter: 'B',
    color: 0x7dfff0,
    duration: 0,
    weight: 12,
    description: `A barrier across the floor that saves the ball ${SHIELD_PICKUP} times; more stack up to ${SHIELD_CHARGES}.`,
    onCollect: (world) => {
      world.shieldCharges = Math.min(SHIELD_CHARGES, world.shieldCharges + SHIELD_PICKUP);
    },
  },
  [PowerUpKind.Life]: {
    name: 'EXTRA LIFE',
    letter: '+',
    color: 0xff6bd0,
    duration: 0,
    weight: 3,
    description: `One extra life (up to ${PLAYER.maxLives}).`,
    onCollect: (world) => {
      world.lives = Math.min(PLAYER.maxLives, world.lives + 1);
    },
  },
};
