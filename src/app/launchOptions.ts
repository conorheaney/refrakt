/**
 * The game's URL flags, read once at boot (main.ts) and passed to Game and GameView, so nothing reads the URL
 * while the game runs and both can be built in tests.
 */
export interface LaunchOptions {
  /** `?level=N`: start a run on level N (1-based; checked against the campaign by Game). Practice and QA. */
  readonly level: number | null;
  /** `?autopilot`: the attract-mode AI plays a real run (HUD, scoring, lives). QA captures. */
  readonly autopilot: boolean;
  /**
   * `?editorPreview&stage=N`: the editor's test play. The world comes from session storage (main.ts) and a
   * run starts straight away on its level N (0-based; 0 when missing or invalid) and lasts that level only.
   */
  readonly editorPreview: { readonly stage: number } | null;
  /** `?debugArena`: draw the walls the ball bounces off over the scene (GameView). */
  readonly debugArena: boolean;
}

export const DEFAULT_LAUNCH_OPTIONS: LaunchOptions = {
  level: null,
  autopilot: false,
  editorPreview: null,
  debugArena: false,
};

/** Reads the flags from a URL query string (`location.search`). Malformed numbers count as absent. */
export function parseLaunchOptions(search: string): LaunchOptions {
  const params = new URLSearchParams(search);
  const integer = (key: string): number | null => {
    const value = params.get(key);
    const n = value === null || value.trim() === '' ? Number.NaN : Number(value);
    return Number.isInteger(n) ? n : null;
  };
  const stage = integer('stage');
  return {
    level: integer('level'),
    autopilot: params.has('autopilot'),
    editorPreview: params.has('editorPreview') ? { stage: stage !== null && stage >= 0 ? stage : 0 } : null,
    debugArena: params.has('debugArena'),
  };
}
