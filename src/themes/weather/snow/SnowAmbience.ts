import type { AudioEngine } from '../../../engine/audio/AudioEngine';

/** Gain of a gust (before the ambience slider): a clear howl, still under the music. */
const GUST_LEVEL = 1;
/** Length of the recording (themes/weather/snow/sfx/winter-storm.mp3) in seconds, and of each gust taken from it. */
const RECORDING = 61;
/** Each gust's sound runs a little past the gust on screen (7-10 s); gusts come in pairs (SnowLayer). */
const GUST_MIN = 11;
const GUST_MAX = 15;

/** Seconds of play before the first distant ice creak, and between creaks after that. */
const CREAK_FIRST: readonly [number, number] = [14, 24];
const CREAK: readonly [number, number] = [28, 55];

function between([min, max]: readonly [number, number]): number {
  return min + Math.random() * (max - min);
}

/**
 * Background sound for snowy worlds, on the ambience bus (Ambience slider), under the music. The wind is
 * only heard when it blows: each gust seen on screen (themes/weather/snow/SnowLayer.ts) plays a different stretch of a
 * stereo recording of a howling winter storm (DBlover, CC0; see app/audio/SOUND_CREDITS.md), faded in
 * and out and leaning gently from right to left the way the snow is blowing; the calm in between is quiet.
 * Now and then ice creaks and crackles in the distance (synthesised). The world's ice chimes are part of
 * its soundtrack (the 'crystal' track in app/audio/Music.ts), where they keep time.
 */
export class SnowAmbience {
  private active = false;
  private untilCreak = between(CREAK_FIRST);
  private lastGust = 0;
  private lastOffset = -RECORDING;

  constructor(private readonly audio: AudioEngine) {}

  /** Starts or stops the snowscape (a world change, or attract mode). */
  setActive(on: boolean): void {
    if (on && !this.active) this.untilCreak = between(CREAK_FIRST);
    this.active = on;
  }

  /**
   * Called every frame while a snowy world is loaded.
   * @param realDt wall-clock time (unused; kept beside simDt to match the view's frame callback). Gusts
   *               themselves keep blowing in pauses, like the snow.
   * @param simDt  simulation time: creaks only come while the game runs.
   * @param gust   current gust strength, 0-1 (SnowLayer.gust).
   */
  update(_realDt: number, simDt: number, gust: number): void {
    if (!this.active) return;
    const ctx = this.audio.context;
    if (!ctx || ctx.state !== 'running') return;
    const t = ctx.currentTime;
    if (this.lastGust < 0.02 && gust >= 0.02) this.blow(t);
    this.lastGust = gust;

    if (simDt <= 0) return;
    this.untilCreak -= simDt;
    if (this.untilCreak <= 0) {
      this.untilCreak = between(CREAK);
      this.creak(t);
    }
  }

  /** One gust: a random stretch of the recording (well away from the last one), swept from right to left. */
  private blow(t: number): void {
    const dur = GUST_MIN + Math.random() * (GUST_MAX - GUST_MIN);
    let offset = Math.random() * (RECORDING - dur);
    if (Math.abs(offset - this.lastOffset) < dur) offset = (offset + RECORDING / 2) % (RECORDING - dur);
    this.lastOffset = offset;
    // The recording is already stereo, so the drift is only a gentle lean of its balance.
    const from = 0.25 + Math.random() * 0.15;
    this.audio.sample('winterStorm', {
      vol: GUST_LEVEL * (0.8 + Math.random() * 0.3),
      offset,
      dur,
      fadeIn: 2.5,
      fadeOut: 4.5,
      pan: from,
      panTo: -from,
      when: t,
      bus: 'ambience',
    });
  }

  /** Ice settling far off: a low groan with a dry crackle running through it. */
  private creak(t: number): void {
    const pan = (Math.random() - 0.5) * 1.4;
    const start = 55 + Math.random() * 25;
    this.audio.tone({
      freq: start,
      endFreq: start * 0.72,
      dur: 2.4,
      vol: 0.09,
      attack: 0.5,
      type: 'sawtooth',
      filter: 240,
      pan,
      when: t,
      bus: 'ambience',
    });
    this.audio.tone({
      freq: start * 1.5,
      endFreq: start * 1.15,
      dur: 1.8,
      vol: 0.035,
      attack: 0.4,
      type: 'sawtooth',
      filter: 400,
      pan,
      when: t + 0.15,
      bus: 'ambience',
    });
    const cracks = 4 + Math.floor(Math.random() * 6);
    let at = t + 0.3 + Math.random() * 0.4;
    for (let i = 0; i < cracks; i++) {
      this.audio.noise({
        dur: 0.025 + Math.random() * 0.04,
        vol: 0.05 + Math.random() * 0.07,
        filterType: 'bandpass',
        filter: 1400 + Math.random() * 2400,
        pan: pan + (Math.random() - 0.5) * 0.3,
        when: at,
        bus: 'ambience',
      });
      at += 0.03 + Math.random() * 0.16;
    }
  }
}
