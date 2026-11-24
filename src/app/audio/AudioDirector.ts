import { FIELD } from '../../gameplay/config';
import type { EventBus } from '../../engine/core/EventBus';
import type { GameEvents } from '../../gameplay/events';
import { BrickKind } from '../../gameplay/types';
import type { WeatherId } from '../../content/worlds';
import type { AudioEngine } from '../../engine/audio/AudioEngine';
import { SnowAmbience } from '../../themes/weather/snow/SnowAmbience';
import { TombAmbience } from '../../themes/weather/dust/TombAmbience';

/** A minor pentatonic, so rising combo pitches always sit inside the soundtrack's key. */
const PENTATONIC: readonly number[] = [0, 3, 5, 7, 10];
/** Refrakt's brighter colour: the major pentatonic, for its sparkles and its climbing shatter chimes. */
const MAJOR_PENTATONIC: readonly number[] = [0, 2, 4, 7, 9];
/** The chord that blooms when a prism breaks: A major add 9, spread over three octaves. */
const REFRAKT_CHORD: readonly number[] = [110, 164.8, 220, 277.2, 329.6, 493.9, 659.3];
/** Level of the crystal hum under an active Refrakt. */
const REFRAKT_HUM = 0.32;

/** Stereo position of a playfield x: +/-0.6 at the Space walls (the wider forest arena is clamped to that). */
function panOf(x: number): number {
  return Math.max(-0.6, Math.min(0.6, (x / FIELD.halfWidth) * 0.6));
}

/** Gain of the rain loop (before the ambience slider): a bed under the music, never over it. */
const RAIN_LEVEL = 0.85;

/** Maps simulation events to synthesised sound effects. */
export class AudioDirector {
  private on = true;
  /** Refrakt is running (its hum should be playing unless sound is off or the game is paused). */
  private refraktOn = false;
  private hushed = false;
  /** Bricks shattered in this Refrakt so far: each chimes one step higher. */
  private refraktStreak = 0;
  private raining = false;
  private snowing = false;
  private dusty = false;
  private readonly snow: SnowAmbience;
  private readonly tomb: TombAmbience;

  /** Disabled during attract mode so the menu stays calm (this also quiets the weather). */
  get enabled(): boolean {
    return this.on;
  }

  set enabled(value: boolean) {
    this.on = value;
    this.updateWeather();
    this.applyRefraktHum(1);
  }

  /** The pause menu: the Refrakt hum waits silently while it is open. */
  setPaused(paused: boolean): void {
    this.hushed = paused;
    this.applyRefraktHum(0.3);
  }

  private setRefraktHum(on: boolean, fade = 1.2): void {
    this.refraktOn = on;
    this.applyRefraktHum(fade);
  }

  private applyRefraktHum(fade: number): void {
    const level = this.refraktOn && this.on && !this.hushed ? REFRAKT_HUM : 0;
    this.audio.setLoop('refraktHum', level, fade, 'sfx');
  }

  /**
   * Called when a level loads: rainy worlds play a loop of heavy rain on the ambience bus, snowy ones a
   * synthesised winter wind (themes/weather/snow/SnowAmbience.ts).
   */
  setWeather(weather: WeatherId | undefined): void {
    this.raining = weather === 'rain';
    this.snowing = weather === 'snow';
    this.dusty = weather === 'dust';
    this.updateWeather();
  }

  /** Every frame in the tomb: the room tone and torch crackles. */
  dustFrame(realDt: number, simDt: number): void {
    this.tomb.update(realDt, simDt);
  }

  /** The tomb shifting (TombDustLayer.onRumble). */
  rumble(strength: number, lead: number, rise: number, hold: number, fall: number): void {
    this.tomb.rumble(strength, lead, rise, hold, fall);
  }

  /** A wall torch flaring (TombDustLayer.onFlare). */
  torchFlare(side: -1 | 0 | 1, strength: number): void {
    this.tomb.flare(side, strength);
  }

  /** Every frame in a snowy world: the wind follows the gusts on screen (SnowLayer.gust). */
  snowFrame(realDt: number, simDt: number, gust: number): void {
    this.snow.update(realDt, simDt, gust);
  }

  private updateWeather(): void {
    this.updateRain();
    this.snow.setActive(this.on && this.snowing);
    this.tomb.setActive(this.on && this.dusty);
  }

  private updateRain(): void {
    this.audio.setLoop('rainHeavy', this.on && this.raining ? RAIN_LEVEL : 0, this.on ? 2.5 : 1);
  }
  private readonly lastPlayed = new Map<string, number>();

  constructor(
    private readonly audio: AudioEngine,
    events: EventBus<GameEvents>,
  ) {
    this.snow = new SnowAmbience(audio);
    this.tomb = new TombAmbience(audio);
    events.on('ballLaunched', ({ x }) => {
      if (this.gate('launch', 0.05)) audio.tone({ freq: 320, endFreq: 720, dur: 0.14, vol: 0.2, type: 'triangle', pan: panOf(x) });
    });

    events.on('ballWall', ({ x }) => {
      if (this.gate('wall', 0.03)) audio.tone({ freq: 260, endFreq: 200, dur: 0.07, vol: 0.12, type: 'triangle', pan: panOf(x) });
    });

    events.on('ballPaddle', ({ x, caught }) => {
      if (!this.gate('paddle', 0.03)) return;
      audio.tone({ freq: 190, endFreq: 110, dur: 0.13, vol: 0.3, pan: panOf(x) });
      audio.tone({ freq: caught ? 520 : 380, dur: 0.07, vol: 0.12, type: 'square', filter: 2000, pan: panOf(x) });
    });

    events.on('brickHit', ({ brick, x }) => {
      if (!this.gate('hit', 0.03)) return;
      if (brick.kind === BrickKind.Steel) {
        audio.tone({ freq: 2100, dur: 0.09, vol: 0.09, type: 'square', pan: panOf(x) });
        audio.tone({ freq: 3150, dur: 0.12, vol: 0.06, type: 'sine', pan: panOf(x) });
      } else {
        audio.tone({ freq: 900, endFreq: 600, dur: 0.07, vol: 0.14, type: 'square', filter: 3000, pan: panOf(x) });
      }
    });

    events.on('brickDestroyed', ({ brick, combo }) => {
      if (!this.gate('break', 0.025)) return;
      const n = Math.min(combo, 24);
      const semis = PENTATONIC[n % 5] + 12 * Math.floor(n / 5);
      const freq = 330 * Math.pow(2, semis / 12);
      const pan = panOf(brick.x);
      audio.tone({ freq, dur: 0.16, vol: 0.2, type: 'triangle', pan });
      audio.tone({ freq: freq * 2, dur: 0.09, vol: 0.07, type: 'sine', pan });
      audio.noise({ dur: 0.07, vol: 0.12, filterType: 'highpass', filter: 3500, pan });
    });

    events.on('explosion', ({ x }) => {
      if (!this.gate('boom', 0.04)) return;
      const pan = panOf(x);
      audio.noise({ dur: 0.55, vol: 0.55, filter: 1400, endFilter: 120, pan });
      audio.tone({ freq: 130, endFreq: 32, dur: 0.5, vol: 0.55, pan });
    });

    // Refrakt: the prism's light breaking free. Recorded glass and magic (src/app/audio/SOUND_CREDITS.md)
    // over a synthesised chord that blooms open, a sparkling run up three octaves, and a crystal hum that
    // rings under the whole effect. Each brick it shatters chimes one step higher up the scale.
    events.on('refraktStarted', ({ x }) => {
      if (!this.enabled) return;
      const pan = panOf(x);
      const t = audio.context?.currentTime ?? 0;
      this.refraktStreak = 0;
      if (!audio.sample('refraktStart', { vol: 0.95, pan: pan * 0.5 })) {
        audio.noise({ dur: 1.2, vol: 0.3, filterType: 'highpass', filter: 2500, endFilter: 9000, pan });
      }
      audio.tone({ freq: 90, endFreq: 26, dur: 1.5, vol: 0.5, pan: 0 });
      REFRAKT_CHORD.forEach((f, i) => {
        const spread = i % 2 === 0 ? -0.45 : 0.45;
        for (const detune of [0.996, 1.004]) {
          audio.swell({ source: 'sawtooth', freq: f * detune, filter: 320, endFilter: 7000, q: 1.4, vol: 0.026, attack: 0.3, hold: 0.45, release: 2.4, pan: detune < 1 ? spread : spread * 0.5 });
        }
      });
      for (let i = 0; i < 16; i++) {
        const n = i % 5;
        const freq = 880 * Math.pow(2, (MAJOR_PENTATONIC[n] + 12 * Math.floor(i / 5)) / 12);
        audio.tone({ freq, dur: 0.5, vol: 0.06, when: t + 0.12 + i * 0.04, pan: -0.6 + (i / 15) * 1.2 });
      }
      this.setRefraktHum(true);
    });

    events.on('refraktBurst', ({ x }) => {
      if (!this.gate('refrakt', 0.045)) return;
      const pan = panOf(x);
      const t = audio.context?.currentTime ?? 0;
      const n = Math.min(this.refraktStreak++, 14);
      const semis = MAJOR_PENTATONIC[n % 5] + 12 * Math.floor(n / 5);
      const rate = 0.85 * Math.pow(2, Math.min(semis, 12) / 12);
      if (!audio.sample('refraktShatter', { vol: 0.6, pan, rate })) {
        audio.noise({ dur: 0.2, vol: 0.16, filterType: 'highpass', filter: 5000, pan });
      }
      const freq = 660 * Math.pow(2, semis / 12);
      audio.tone({ freq, dur: 0.6, vol: 0.07, pan });
      audio.tone({ freq: freq * 1.5, dur: 0.45, vol: 0.035, when: t + 0.03, pan });
      audio.tone({ freq: freq * 2, dur: 0.3, vol: 0.02, when: t + 0.06, pan });
    });

    events.on('refraktEnded', ({ cut }) => {
      this.setRefraktHum(false, cut ? 0.4 : 1.6);
      if (cut || !this.enabled) return;
      const t = audio.context?.currentTime ?? 0;
      audio.sample('refraktEnd', { vol: 0.7 });
      for (let i = 0; i < 8; i++) {
        const k = 7 - i;
        const freq = 880 * Math.pow(2, (MAJOR_PENTATONIC[k % 5] + 12 * Math.floor(k / 5)) / 12);
        audio.tone({ freq, dur: 0.45, vol: 0.045 * (1 - i / 10), when: t + i * 0.07, pan: 0.5 - (i / 7) });
      }
    });

    events.on('ballsSplit', ({ x }) => {
      if (!this.gate('split', 0.05)) return;
      const pan = panOf(x);
      const t = audio.context?.currentTime ?? 0;
      [1320, 1760, 2640].forEach((f, i) => audio.tone({ freq: f, dur: 0.3, vol: 0.09, when: t + i * 0.04, pan }));
    });

    events.on('powerUpCollected', ({ x }) => {
      const t = audio.context?.currentTime ?? 0;
      [0, 4, 7, 12].forEach((s, i) =>
        audio.tone({ freq: 440 * Math.pow(2, s / 12), dur: 0.12, vol: 0.14, type: 'square', filter: 3200, when: t + i * 0.055, pan: panOf(x) }),
      );
    });

    events.on('shieldHit', ({ x }) => {
      audio.tone({ freq: 500, endFreq: 1100, dur: 0.2, vol: 0.2, type: 'triangle', pan: panOf(x) });
    });

    events.on('laserFired', ({ x }) => {
      if (this.gate('laser', 0.05)) audio.tone({ freq: 1500, endFreq: 280, dur: 0.09, vol: 0.08, type: 'sawtooth', filter: 4000, pan: panOf(x) });
    });

    events.on('lifeLost', () => {
      audio.tone({ freq: 420, endFreq: 50, dur: 0.8, vol: 0.35, type: 'sawtooth', filter: 1600 });
      audio.noise({ dur: 0.5, vol: 0.3, filter: 900, endFilter: 100 });
    });

    events.on('gameOver', () => {
      const t = (audio.context?.currentTime ?? 0) + 0.5;
      [7, 3, 0, -5].forEach((s, i) =>
        audio.tone({ freq: 220 * Math.pow(2, s / 12), dur: 0.5, vol: 0.2, type: 'triangle', when: t + i * 0.28 }),
      );
    });

    events.on('levelCleared', () => {
      const t = audio.context?.currentTime ?? 0;
      [0, 4, 7, 12, 16, 19, 24].forEach((s, i) =>
        audio.tone({ freq: 330 * Math.pow(2, s / 12), dur: 0.3, vol: 0.16, type: 'square', filter: 3500, when: t + i * 0.085 }),
      );
    });

    events.on('bossHit', ({ x }) => {
      if (!this.gate('bossHit', 0.04)) return;
      audio.tone({ freq: 110, endFreq: 70, dur: 0.16, vol: 0.35, type: 'square', filter: 900, pan: panOf(x) });
      audio.noise({ dur: 0.1, vol: 0.2, filterType: 'bandpass', filter: 2400, pan: panOf(x) });
    });

    events.on('bossStage', () => {
      audio.tone({ freq: 80, endFreq: 320, dur: 0.7, vol: 0.4, type: 'sawtooth', filter: 1400 });
      audio.noise({ dur: 0.7, vol: 0.3, filter: 400, endFilter: 4000 });
    });

    events.on('bossFired', ({ x }) => {
      if (this.gate('bossFire', 0.05)) audio.tone({ freq: 700, endFreq: 180, dur: 0.2, vol: 0.14, type: 'sawtooth', filter: 2400, pan: panOf(x) });
    });

    events.on('bossDefeated', () => {
      const t = audio.context?.currentTime ?? 0;
      for (let i = 0; i < 7; i++) {
        audio.noise({ dur: 0.4, vol: 0.4, filter: 1600, endFilter: 150, when: t + i * 0.18, pan: Math.sin(i * 2.4) * 0.6 });
        audio.tone({ freq: 140 - i * 8, endFreq: 30, dur: 0.4, vol: 0.4, when: t + i * 0.18 });
      }
      audio.noise({ dur: 1.6, vol: 0.6, filter: 2600, endFilter: 80, when: t + 1.3 });
      audio.tone({ freq: 90, endFreq: 24, dur: 1.5, vol: 0.6, when: t + 1.3 });
    });

    events.on('paddleStunned', ({ x }) => {
      audio.tone({ freq: 160, endFreq: 60, dur: 0.3, vol: 0.35, type: 'square', filter: 1000, pan: panOf(x) });
      audio.noise({ dur: 0.2, vol: 0.25, filter: 2500, pan: panOf(x) });
    });

    this.bindSnakes(events);
  }

  /**
   * Snake sounds: a recorded rattle (with a breathy hiss on top) over the warning, a whoosh for the lunge
   * and a wet bite when it connects. Each falls back to the synthesised version until its clip has loaded.
   */
  private bindSnakes(events: EventBus<GameEvents>): void {
    const audio = this.audio;
    events.on('snakeWarn', ({ x }) => {
      if (!this.gate('snakeWarn', 0.2)) return;
      const pan = panOf(x);
      // The shortest warning is 0.55 s (SNAKE.warn); the rattle fades out just as the lunge begins.
      if (audio.sample('snakeRattle', { vol: 0.5, pan, rate: 0.95 + Math.random() * 0.1, dur: 0.6 })) {
        audio.noise({ dur: 0.55, vol: 0.14, filterType: 'highpass', filter: 4200, endFilter: 6500, pan });
      } else {
        audio.noise({ dur: 0.6, vol: 0.3, filterType: 'highpass', filter: 4200, endFilter: 6500, pan });
        audio.noise({ dur: 0.45, vol: 0.14, filterType: 'bandpass', filter: 7000, pan });
      }
    });
    events.on('snakeStrike', ({ x }) => {
      if (!this.gate('snakeStrike', 0.1)) return;
      const pan = panOf(x);
      if (!audio.sample('snakeStrike', { vol: 0.6, pan, rate: 1.1 + Math.random() * 0.15 })) {
        audio.noise({ dur: 0.12, vol: 0.35, filterType: 'bandpass', filter: 1800, endFilter: 600, pan });
      }
    });
    // Icicles (gameplay/hazards/icicles/icicles.ts), all synthesised.
    events.on('icicleWarn', ({ x }) => {
      if (!this.gate('icicleWarn', 0.2)) return;
      const pan = panOf(x);
      const t = audio.context!.currentTime;
      // Ice cracking: a few dry ticks, then a bright glint.
      for (let i = 0; i < 4; i++) {
        audio.noise({ dur: 0.025, vol: 0.09 - i * 0.015, filterType: 'bandpass', filter: 2600 + Math.random() * 1800, pan, when: t + i * (0.05 + Math.random() * 0.05) });
      }
      audio.tone({ freq: 3136, dur: 0.35, vol: 0.035, attack: 0.002, pan, when: t + 0.22 });
    });
    events.on('icicleFall', ({ x }) => {
      if (this.gate('icicleFall', 0.1)) audio.tone({ freq: 2200, endFreq: 700, dur: 0.6, vol: 0.04, attack: 0.05, pan: panOf(x) });
    });
    events.on('icicleKnocked', ({ x }) => {
      if (!this.gate('icicleKnocked', 0.08)) return;
      const pan = panOf(x);
      const t = audio.context!.currentTime;
      // The snap: a hard, bright crack with a short crunch of ice under it, and a woody knock for weight.
      audio.noise({ dur: 0.035, vol: 0.32, filterType: 'highpass', filter: 5200, pan, when: t });
      audio.noise({ dur: 0.14, vol: 0.2, filterType: 'bandpass', filter: 2400, endFilter: 700, pan, when: t + 0.004 });
      audio.tone({ freq: 900, endFreq: 260, dur: 0.09, vol: 0.12, type: 'triangle', attack: 0.001, pan, when: t });
      // Glassy ring of the freed spike: inharmonic partials like a struck bar, each fading at its own rate.
      const base = 1650 + Math.random() * 350;
      audio.tone({ freq: base, dur: 0.9, vol: 0.05, attack: 0.002, pan, when: t + 0.01 });
      audio.tone({ freq: base * 2.76, dur: 0.55, vol: 0.03, attack: 0.002, pan, when: t + 0.01 });
      audio.tone({ freq: base * 5.4, dur: 0.3, vol: 0.018, attack: 0.002, pan, when: t + 0.01 });
      // Chips and grains of ice skittering after it.
      for (let i = 0; i < 6; i++) {
        audio.noise({ dur: 0.018, vol: 0.07 - i * 0.008, filterType: 'bandpass', filter: 4500 + Math.random() * 3500, pan, when: t + 0.05 + i * (0.03 + Math.random() * 0.05) });
      }
      // A soft rush of air as it drops.
      audio.noise({ dur: 0.5, vol: 0.05, filterType: 'bandpass', filter: 1800, endFilter: 600, pan, when: t + 0.06 });
    });
    events.on('icicleShatter', ({ x, byBall }) => {
      if (!this.gate('icicleShatter', 0.06)) return;
      const pan = panOf(x);
      const t = audio.context!.currentTime;
      audio.noise({ dur: 0.22, vol: byBall ? 0.22 : 0.17, filterType: 'highpass', filter: 3200, pan, when: t });
      // Glassy pieces tinkling as they scatter, high in A minor pentatonic.
      const notes = [1760, 2093, 2349, 2637, 3136];
      for (let i = 0; i < 4; i++) {
        audio.tone({ freq: notes[Math.floor(Math.random() * notes.length)], dur: 0.18, vol: 0.035, attack: 0.002, pan, when: t + 0.02 + i * (0.03 + Math.random() * 0.04) });
      }
    });
    events.on('paddleStruck', ({ x }) => {
      const pan = panOf(x);
      // Ice smashing on the paddle, a dull thud, and a short low wobble as it rocks.
      audio.noise({ dur: 0.25, vol: 0.28, filterType: 'highpass', filter: 3000, pan });
      audio.tone({ freq: 160, endFreq: 70, dur: 0.25, vol: 0.28, pan });
      audio.tone({ freq: 520, endFreq: 380, dur: 0.45, vol: 0.05, attack: 0.01, type: 'triangle', pan });
    });

    // Scarabs (gameplay/hazards/scarabs/scarabs.ts), all synthesised: dry chitinous clicks and skitters.
    const skitter = (pan: number, count: number, vol: number, gap: number): void => {
      const t = audio.context!.currentTime;
      for (let i = 0; i < count; i++) {
        audio.noise({ dur: 0.012, vol: vol * (0.6 + Math.random() * 0.4), filterType: 'bandpass', filter: 3200 + Math.random() * 2600, pan, when: t + i * gap * (0.6 + Math.random() * 0.8) });
      }
    };
    // A storm coming in the tomb: the stone gate grinding open.
    events.on('tombGate', () => this.tomb.stoneGate());
    events.on('scarabWarn', ({ x }) => {
      if (!this.gate('scarabWarn', 0.3)) return;
      const pan = panOf(x);
      // Clicking from behind the stone, and a soft hiss of sand.
      skitter(pan, 14, 0.07, 0.05);
      audio.noise({ dur: 0.8, vol: 0.04, filterType: 'bandpass', filter: 5000, endFilter: 2500, pan });
    });
    events.on('scarabEmerge', ({ x }) => {
      if (this.gate('scarabEmerge', 0.08)) skitter(panOf(x), 5, 0.06, 0.03);
    });
    events.on('scarabCling', ({ x }) => {
      if (!this.gate('scarabCling', 0.06)) return;
      const pan = panOf(x);
      audio.noise({ dur: 0.03, vol: 0.14, filterType: 'bandpass', filter: 1800, pan });
      audio.tone({ freq: 340, endFreq: 260, dur: 0.12, vol: 0.06, type: 'triangle', pan });
      skitter(pan, 4, 0.05, 0.025);
    });
    events.on('scarabCrushed', ({ x }) => {
      if (!this.gate('scarabCrushed', 0.05)) return;
      const pan = panOf(x);
      // The shell cracking and giving way (recorded; pitched a little differently each time), with a soft
      // whump of dust bursting out under it.
      audio.noise({ dur: 0.4, vol: 0.05, filterType: 'lowpass', filter: 900, endFilter: 250, pan });
      if (audio.sample('scarabCrunch', { vol: 0.8, pan, rate: 0.92 + Math.random() * 0.16 })) return;
      // Synthesised fallback: a sharp crunch over a short dull thud.
      audio.noise({ dur: 0.06, vol: 0.18, filterType: 'bandpass', filter: 2600, endFilter: 900, pan });
      audio.tone({ freq: 180, endFreq: 70, dur: 0.12, vol: 0.08, type: 'triangle', pan });
    });
    events.on('scarabLeap', ({ x, fly, time }) => {
      if (!this.gate('scarabLeap', 0.05)) return;
      const pan = panOf(x);
      if (!fly) {
        // A scrabble of feet and a quick flick off the floor.
        skitter(pan, 3, 0.05, 0.015);
        audio.noise({ dur: 0.09, vol: 0.05, filterType: 'bandpass', filter: 2400, endFilter: 4200, pan });
        return;
      }
      // The wing cases click open, then the low drone of the wings, two close tones beating against each other
      // and swelling as it comes closer.
      audio.noise({ dur: 0.02, vol: 0.12, filterType: 'bandpass', filter: 3800, pan });
      const t = audio.context!.currentTime + 0.12;
      const dur = time + 0.35;
      audio.tone({ freq: 118, endFreq: 132, dur, vol: 0.035, type: 'sawtooth', attack: 0.08, filter: 900, pan, when: t });
      audio.tone({ freq: 123, endFreq: 128, dur, vol: 0.03, type: 'sawtooth', attack: 0.1, filter: 1300, pan, when: t });
      audio.noise({ dur, vol: 0.025, filterType: 'bandpass', filter: 260, pan, when: t });
    });
    events.on('scarabLand', ({ x, fly }) => {
      if (!this.gate('scarabLand', 0.05)) return;
      const pan = panOf(x);
      // A light thump of shell on sand, then feet finding their grip.
      audio.tone({ freq: 210, endFreq: 120, dur: 0.07, vol: 0.05, type: 'triangle', pan });
      audio.noise({ dur: 0.12, vol: 0.05, filterType: 'bandpass', filter: 1600, endFilter: 700, pan });
      skitter(pan, fly ? 5 : 3, 0.04, 0.03);
    });
    events.on('scarabBuzz', ({ x, time, depth }) => {
      if (!this.gate('scarabBuzz', 0.05)) return;
      // A droning buzz that swoops in pitch with each turn, faint out in the distance.
      const pan = panOf(x);
      const near = 1 - 0.75 * depth;
      const dur = time + 0.12;
      const f = 125 + Math.random() * 45;
      const to = f * (0.85 + Math.random() * 0.35);
      audio.tone({ freq: f, endFreq: to, dur, vol: 0.03 * near, type: 'sawtooth', attack: 0.04, filter: 1100, pan });
      audio.tone({ freq: f * 1.04, endFreq: to * 1.03, dur, vol: 0.025 * near, type: 'sawtooth', attack: 0.05, filter: 1500, pan });
    });
    events.on('scarabSwatted', ({ x }) => {
      if (!this.gate('scarabSwatted', 0.05)) return;
      const pan = panOf(x);
      audio.noise({ dur: 0.04, vol: 0.16, filterType: 'bandpass', filter: 2600, pan });
      audio.tone({ freq: 240, endFreq: 90, dur: 0.35, vol: 0.05, type: 'sawtooth', filter: 900, pan });
    });
    events.on('scarabBump', ({ x }) => {
      if (this.gate('scarabBump', 0.05)) audio.noise({ dur: 0.025, vol: 0.1, filterType: 'bandpass', filter: 3000, pan: panOf(x) });
    });
    events.on('scarabScared', ({ x }) => {
      if (!this.gate('scarabScared', 0.1)) return;
      const pan = panOf(x);
      skitter(pan, 10, 0.08, 0.02);
      audio.noise({ dur: 0.35, vol: 0.08, filterType: 'bandpass', filter: 1200, endFilter: 400, pan });
      audio.tone({ freq: 660, endFreq: 990, dur: 0.18, vol: 0.05, type: 'triangle', pan });
    });

    events.on('paddleBitten', ({ x }) => {
      const pan = panOf(x);
      if (audio.sample('snakeBite', { vol: 0.7, pan, rate: 0.85 })) {
        // A sour, sinking tone under the bite.
        audio.tone({ freq: 620, endFreq: 300, dur: 0.7, vol: 0.12, type: 'sine', pan });
        audio.tone({ freq: 180, endFreq: 70, dur: 0.4, vol: 0.25, type: 'sawtooth', filter: 700, pan });
      } else {
        audio.tone({ freq: 240, endFreq: 90, dur: 0.35, vol: 0.3, type: 'sawtooth', filter: 900, pan });
        audio.tone({ freq: 620, endFreq: 380, dur: 0.5, vol: 0.08, type: 'sine', pan });
        audio.noise({ dur: 0.15, vol: 0.2, filter: 3000, pan });
      }
    });
  }

  /**
   * Thunder for a lightning strike (themes/weather/rain/RainLayer.ts), starting `delay` seconds after the flash.
   * `strength` 0-1 scales loudness. Every strike is a sharp crack (the close recording) with a long
   * rolling rumble (one of the distant recordings) laid in just behind it, both slowed a little so they
   * are deeper and longer, and a synthesised rumble swelling underneath that carries on after them. The
   * crack and rumble together trip the master compressor, which ducks the music for a moment; that is
   * accepted as part of the storm.
   */
  thunder(delay: number, strength: number): void {
    if (!this.gate('thunder', 1)) return;
    const audio = this.audio;
    const t = audio.context!.currentTime + delay;
    // Kept near the centre: thunder panned far to one side sounds further away.
    const pan = (Math.random() - 0.5) * 0.4;
    const rate = 0.86 + Math.random() * 0.06;
    const played = audio.sample('thunderClose', { vol: 1.5 * strength, pan, when: t, rate, bus: 'ambience' });
    audio.sample(Math.random() < 0.5 ? 'thunderDistant1' : 'thunderDistant2', { vol: 1.1 * strength, pan: -pan, when: t + 0.5, rate: rate * 0.95, bus: 'ambience' });
    // The long rolling tail, under the recordings or the synthesised fallback alike. Its top reaches
    // about 300 Hz so small speakers and headphones still carry it, not only a subwoofer.
    audio.swell({ source: 'noise', filter: 320, endFilter: 60, vol: 0.5 * strength, attack: 0.8, hold: 2.5, release: 5, pan: -pan, when: t + 0.3, bus: 'ambience' });
    audio.swell({ source: 'noise', filter: 220, endFilter: 50, vol: 0.4 * strength, attack: 1.5, hold: 2, release: 6, tremolo: { rate: 2.3, depth: 0.5 }, pan, when: t + 1.2, bus: 'ambience' });
    if (played) return;
    audio.noise({ dur: 0.6, vol: 0.34 * strength, filter: 2600, endFilter: 300, pan, when: t, bus: 'ambience' });
    audio.noise({ dur: 4.5, vol: 0.85 * strength, filter: 240, endFilter: 70, pan, when: t + 0.05, bus: 'ambience' });
    audio.noise({ dur: 3.8, vol: 0.6 * strength, filter: 170, endFilter: 55, pan: -pan, when: t + 0.4, bus: 'ambience' });
    audio.noise({ dur: 3.2, vol: 0.4 * strength, filter: 130, endFilter: 45, pan, when: t + 1, bus: 'ambience' });
  }

  uiClick(): void {
    this.audio.tone({ freq: 660, endFreq: 880, dur: 0.07, vol: 0.12, type: 'triangle' });
  }

  /** Per-sound rate limit so simultaneous events never stack into a wall of noise. */
  private gate(key: string, minInterval: number): boolean {
    if (!this.enabled) return false;
    const ctx = this.audio.context;
    if (!ctx) return false;
    const now = ctx.currentTime;
    const last = this.lastPlayed.get(key) ?? -1;
    if (now - last < minInterval) return false;
    this.lastPlayed.set(key, now);
    return true;
  }
}
