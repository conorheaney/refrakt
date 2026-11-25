import type { AudioEngine, NoiseBed } from '../../../engine/audio/AudioEngine';

/** Levels before the ambience slider: all kept well under the music. */
const ROOM_LEVEL = 0.05;
/** Seconds between torch crackles (each torch on its own), and faster while it flares. */
const CRACKLE: readonly [number, number] = [0.12, 0.9];

function between([min, max]: readonly [number, number]): number {
  return min + Math.random() * (max - min);
}

/**
 * Background sound for the tomb (weather 'dust', themes/weather/dust/TombDustLayer.ts), on the ambience bus, all
 * synthesised: a low, still room tone; the wall torches crackling from either side (busier and louder when one flares, with a soft whoomp); and a
 * deep stone rumble with small stones falling after it whenever the tomb shifts.
 */
export class TombAmbience {
  private active = false;
  private room: NoiseBed | null = null;
  private untilCrackle = [between(CRACKLE), between(CRACKLE)];
  /** How much each torch (left, right) is flaring, 0-1; set by `flare`, decays on its own. */
  private readonly flaring = [0, 0];

  constructor(private readonly audio: AudioEngine) {}

  /** Starts or stops the tomb sound (a world change, or attract mode). */
  setActive(on: boolean): void {
    this.active = on;
    if (!on) {
      this.room?.stop(1.5);
      this.room = null;
    }
  }

  /**
   * Called every frame while the tomb is loaded.
   * @param simDt simulation time: crackles pause with the game.
   */
  update(realDt: number, simDt: number): void {
    if (!this.active) return;
    const ctx = this.audio.context;
    if (!ctx || ctx.state !== 'running') return;
    // The bed needs a running context, so it starts on the first frame that has one.
    if (!this.room) {
      this.room = this.audio.noiseBed({ filter: 150, q: 0.9, bus: 'ambience' });
      this.room?.setLevel(ROOM_LEVEL, 3);
    }

    for (let side = 0; side < 2; side++) this.flaring[side] = Math.max(0, this.flaring[side] - realDt * 0.3);
    if (simDt <= 0) return;
    const t = ctx.currentTime;
    for (let side = 0; side < 2; side++) {
      this.untilCrackle[side] -= simDt * (1 + this.flaring[side] * 3);
      if (this.untilCrackle[side] > 0) continue;
      this.untilCrackle[side] = between(CRACKLE);
      this.crackle(t, side === 0 ? -0.8 : 0.8, this.flaring[side]);
    }
  }

  /** A torch flaring: side -1 left, 1 right, 0 both; strength 0-1. */
  flare(side: -1 | 0 | 1, strength: number): void {
    if (!this.active) return;
    const ctx = this.audio.context;
    if (!ctx || ctx.state !== 'running') return;
    const t = ctx.currentTime;
    for (const s of side === 0 ? [-1, 1] : [side]) {
      this.flaring[s < 0 ? 0 : 1] = strength;
      const pan = s * 0.75;
      // The flame catching: a soft, low whoomp of air.
      this.audio.noise({ dur: 0.9, vol: 0.16 * strength, filter: 700, endFilter: 160, pan, when: t, bus: 'ambience' });
      this.audio.tone({
        freq: 90,
        endFreq: 60,
        dur: 0.7,
        vol: 0.05 * strength,
        attack: 0.08,
        filter: 300,
        pan,
        when: t,
        bus: 'ambience',
      });
    }
  }

  /**
   * The tomb shifting (TombDustLayer.onRumble): a groan of stone that starts `lead` seconds before the shake,
   * a grinding judder through the whole of it (`rise`, `hold`, `fall` as the shake's envelope), then grit
   * pouring and small stones falling that carry on after the dust has settled. It is all well above the
   * deep sub-bass as well as in it, so it is heard on laptop and phone speakers too.
   */
  rumble(strength: number, lead: number, rise: number, hold: number, fall: number): void {
    if (!this.active) return;
    const ctx = this.audio.context;
    if (!ctx || ctx.state !== 'running') return;
    const t = ctx.currentTime;
    const shake = t + lead;
    const s = strength;
    const bus = 'ambience' as const;
    // The groan: builds from the first warning, through the shake, and dies away after it.
    this.audio.swell({
      source: 'noise',
      filter: 420,
      endFilter: 160,
      q: 1.1,
      vol: 0.75 * s,
      attack: lead + rise,
      hold,
      release: fall + 1.2,
      tremolo: { rate: 6, depth: 0.45 },
      when: t,
      bus,
    });
    // Stone grinding on stone: a rough, judder in the mid range, only while it shakes.
    this.audio.swell({
      source: 'noise',
      filterType: 'bandpass',
      filter: 650,
      endFilter: 380,
      q: 1.4,
      vol: 0.5 * s,
      attack: rise,
      hold,
      release: fall,
      tremolo: { rate: 13, depth: 0.7 },
      pan: -0.3,
      when: shake,
      bus,
    });
    // A low creak whose harmonics carry on small speakers, and the deep weight under everything.
    this.audio.swell({
      source: 'sawtooth',
      freq: 68,
      endFreq: 52,
      filter: 380,
      q: 2,
      vol: 0.12 * s,
      attack: lead + rise,
      hold,
      release: fall,
      tremolo: { rate: 8.5, depth: 0.6 },
      pan: 0.3,
      when: t,
      bus,
    });
    this.audio.swell({
      source: 'sine',
      freq: 44,
      endFreq: 33,
      filter: 200,
      vol: 0.3 * s,
      attack: lead + rise,
      hold,
      release: fall + 0.6,
      when: t,
      bus,
    });
    // Grit pouring from the lintel as the dust falls, trailing off after.
    this.audio.swell({
      source: 'noise',
      filterType: 'bandpass',
      filter: 2800,
      endFilter: 1600,
      q: 0.8,
      vol: 0.16 * s,
      attack: rise + 0.3,
      hold,
      release: fall + 1,
      when: shake,
      bus,
    });
    // Small stones dropping all the way through and for a moment after.
    const until = shake + rise + hold + fall + 1.2;
    let at = shake + 0.2 + Math.random() * 0.2;
    while (at < until) {
      const pan = (Math.random() - 0.5) * 1.6;
      this.audio.noise({
        dur: 0.04 + Math.random() * 0.06,
        vol: (0.1 + Math.random() * 0.15) * s,
        filterType: 'bandpass',
        filter: 600 + Math.random() * 1600,
        pan,
        when: at,
        bus,
      });
      at += 0.08 + Math.random() * 0.3;
    }
  }

  /**
   * A huge stone gate grinding open as a storm begins (the tombGate event; the dust and scarabs follow about a
   * second in, while it carries on): the recording (sfx/stone-gate.wav, mixed from three CC0 Freesound clips:
   * see src/app/audio/SOUND_CREDITS.md), on the effects bus but softened, its harshest highs filtered off;
   * synthesised (gateSynth) only if it has not loaded.
   */
  stoneGate(): void {
    if (!this.active) return;
    const ctx = this.audio.context;
    if (!ctx || ctx.state !== 'running') return;
    const t = ctx.currentTime;
    if (this.audio.sample('stoneGate', { vol: 0.5, filter: 2400, when: t })) return;
    this.gateSynth(t, 3.5);
  }

  /** The gate synthesised: a juddering low grind, a scrape over it, sub-bass weight and grit, then a thud. */
  private gateSynth(t: number, duration: number): void {
    const end = t + duration;
    const hold = Math.max(0.2, duration - 1.1);
    // The grind: low, rough and juddering (an uneven tremolo: two rates beating).
    this.audio.swell({
      source: 'noise',
      filterType: 'bandpass',
      filter: 260,
      endFilter: 150,
      q: 1.6,
      vol: 0.9,
      attack: 0.5,
      hold,
      release: 0.6,
      tremolo: { rate: 7, depth: 0.75 },
      when: t,
    });
    this.audio.swell({
      source: 'noise',
      filterType: 'bandpass',
      filter: 190,
      endFilter: 120,
      q: 2.2,
      vol: 0.55,
      attack: 0.7,
      hold,
      release: 0.5,
      tremolo: { rate: 4.3, depth: 0.6 },
      pan: -0.25,
      when: t,
    });
    // The scrape: stone edges rasping, harsher, panned the other way.
    this.audio.swell({
      source: 'noise',
      filterType: 'bandpass',
      filter: 1300,
      endFilter: 800,
      q: 2.5,
      vol: 0.3,
      attack: 0.3,
      hold,
      release: 0.4,
      tremolo: { rate: 17, depth: 0.85 },
      pan: 0.3,
      when: t,
    });
    // The weight: sub-bass rumble, and a creaking groan whose harmonics carry on small speakers.
    this.audio.swell({
      source: 'sine',
      freq: 38,
      endFreq: 30,
      filter: 160,
      vol: 0.55,
      attack: 0.6,
      hold,
      release: 0.9,
      when: t,
    });
    this.audio.swell({
      source: 'sawtooth',
      freq: 58,
      endFreq: 44,
      filter: 320,
      q: 2.5,
      vol: 0.16,
      attack: 0.8,
      hold,
      release: 0.6,
      tremolo: { rate: 5.5, depth: 0.5 },
      when: t,
    });
    // It catches and slips: short loud grinds every so often, and grit pattering down throughout.
    for (let at = t + 0.35 + Math.random() * 0.3; at < end - 0.4; at += 0.35 + Math.random() * 0.55) {
      this.audio.noise({
        dur: 0.12 + Math.random() * 0.18,
        vol: 0.35 + Math.random() * 0.2,
        filterType: 'bandpass',
        filter: 320 + Math.random() * 300,
        endFilter: 160,
        pan: (Math.random() - 0.5) * 0.8,
        when: at,
      });
    }
    for (let at = t + 0.2; at < end + 0.6; at += 0.06 + Math.random() * 0.2) {
      this.audio.noise({
        dur: 0.03 + Math.random() * 0.05,
        vol: 0.06 + Math.random() * 0.08,
        filterType: 'bandpass',
        filter: 900 + Math.random() * 2200,
        pan: (Math.random() - 0.5) * 1.6,
        when: at,
      });
    }
    // The slab thuds home as the dust blows in.
    this.audio.tone({ freq: 72, endFreq: 34, dur: 0.9, vol: 0.6, when: end - 0.1 });
    this.audio.noise({ dur: 0.5, vol: 0.5, filterType: 'lowpass', filter: 500, endFilter: 120, when: end - 0.1 });
  }

  /** One pop or snap from a torch, louder and brighter while it flares. */
  private crackle(t: number, pan: number, flaring: number): void {
    const pops = Math.random() < 0.3 ? 2 + Math.floor(Math.random() * 3) : 1;
    let at = t;
    for (let i = 0; i < pops; i++) {
      this.audio.noise({
        dur: 0.012 + Math.random() * 0.03,
        vol: (0.02 + Math.random() * 0.035) * (1 + flaring * 1.5),
        filterType: 'bandpass',
        filter: 1800 + Math.random() * 3200,
        pan: pan + (Math.random() - 0.5) * 0.2,
        when: at,
        bus: 'ambience',
      });
      at += 0.02 + Math.random() * 0.06;
    }
  }
}
