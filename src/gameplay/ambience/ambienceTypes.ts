import type { Ambience, AmbienceContext } from './Ambience';
import type { AmbienceKind } from './ambiences';
import { Rain } from './rain/Rain';
import { Snow } from './snow/Snow';
import { Dust } from './dust/Dust';

/** A kind of ambience's class: what it does, and the recordings it plays (loaded only when it is used). */
export interface AmbienceType {
  readonly samples: Readonly<Record<string, string>>;
  new (ctx: AmbienceContext): Ambience;
}

/** The class for each ambience in AMBIENCES (ambiences.ts). */
export const AMBIENCE_TYPES = {
  rain: Rain,
  snow: Snow,
  dust: Dust,
} as const satisfies Record<AmbienceKind, AmbienceType>;
