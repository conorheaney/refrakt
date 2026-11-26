const QUERY = '(prefers-reduced-motion: reduce)';

/** The browser's query for the setting, made on first use (null where there is no matchMedia, as in tests). */
let query: MediaQueryList | null | undefined;

/**
 * Whether the player has asked their system to reduce motion (prefers-reduced-motion). The browser is asked once;
 * the answer stays current, since a MediaQueryList's `matches` follows the setting when it changes mid-game.
 */
export function reducedMotion(): boolean {
  if (query === undefined) query = typeof matchMedia === 'function' ? matchMedia(QUERY) : null;
  return query?.matches ?? false;
}
