/**
 * The game is authored for a 1920-wide design stage that is uniformly scaled
 * to fit the window. Its height adapts to the window between 16:9 (1080) and
 * 4:3 (1440), so taller windows get a taller stage instead of letterbox bars;
 * windows wider than 16:9 are pillarboxed.
 */
export const STAGE_WIDTH = 1920;
export const STAGE_HEIGHT = 1080;
export const STAGE_ASPECT = STAGE_WIDTH / STAGE_HEIGHT;
/** Tallest supported stage (4:3). The camera's vertical framing is unchanged; only side scenery is trimmed. */
export const STAGE_MIN_ASPECT = 4 / 3;

export interface StageLayout {
  /** CSS pixel size of the fitted stage. */
  readonly width: number;
  readonly height: number;
  /** Uniform scale from design pixels to CSS pixels. */
  readonly scale: number;
  /** Width / height of the stage, in [STAGE_MIN_ASPECT, STAGE_ASPECT]. */
  readonly aspect: number;
}

/**
 * Fits the stage element into the window (centred) and scales the DOM overlay
 * so it can be laid out in design coordinates (1920 wide, 1080-1440 tall).
 * The canvas fills the stage at its real pixel size, so pointer coordinates
 * relative to the canvas rect stay correct at any scale.
 */
export function layoutStage(stage: HTMLElement, ui: HTMLElement): StageLayout {
  const vw = Math.max(1, window.innerWidth);
  const vh = Math.max(1, window.innerHeight);
  const aspect = Math.min(STAGE_ASPECT, Math.max(STAGE_MIN_ASPECT, vw / vh));
  const designHeight = STAGE_WIDTH / aspect;
  const scale = Math.min(vw / STAGE_WIDTH, vh / designHeight);
  const width = Math.round(STAGE_WIDTH * scale);
  const height = Math.round(designHeight * scale);
  stage.style.width = `${width}px`;
  stage.style.height = `${height}px`;
  stage.style.left = `${Math.floor((vw - width) / 2)}px`;
  stage.style.top = `${Math.floor((vh - height) / 2)}px`;
  ui.style.height = `${Math.round(designHeight)}px`;
  ui.style.transform = `scale(${scale})`;
  return { width, height, scale, aspect: width / Math.max(1, height) };
}
