import type { AudioEngine } from '../../engine/audio/AudioEngine';
import type { MusicTrackId } from '../../content/musicTracks';

export type MusicMode = 'menu' | 'game' | 'boss';

/** Everything a track needs to schedule one 16th-note step. */
interface StepContext {
  readonly a: AudioEngine;
  readonly mode: MusicMode;
  /** 0-63: four bars of sixteen steps. */
  readonly step: number;
  /** Step within the bar, 0-15. */
  readonly pos: number;
  readonly t: number;
  readonly stepDur: number;
  /** Current intensity, 0-1. */
  readonly lvl: number;
  /** This bar's chord, as semitone offsets from A. */
  readonly chord: readonly number[];
  /** Report a downbeat hit so beat-synced visuals can pulse with it. */
  readonly kick: (t: number) => void;
}

interface TrackDef {
  readonly tempo: Readonly<Record<MusicMode, number>>;
  /** Chords as semitone offsets from A; each progression is four bars. */
  readonly progressions: Readonly<Record<MusicMode, readonly (readonly number[])[]>>;
  readonly schedule: (s: StepContext) => void;
}

const LOOKAHEAD = 0.14;

function semitone(base: number, n: number): number {
  return base * Math.pow(2, n / 12);
}

// ------------------------------------------------------------------ Space: driving synth track

const SPACE_ARP: readonly number[] = [0, 1, 2, 3, 2, 1, 4, 2];

function scheduleSpace({ a, pos, t, stepDur, lvl, chord, kick }: StepContext): void {
  const root = chord[0];

  // Pad: one soft chord per bar, always present.
  if (pos === 0) {
    const bar = stepDur * 16;
    for (let i = 0; i < chord.length; i++) {
      a.tone({
        freq: semitone(220, chord[i]) * (i === 1 ? 1.003 : 1),
        type: 'sawtooth',
        dur: bar * 1.05,
        attack: bar * 0.3,
        vol: 0.035,
        filter: 500 + lvl * 1300,
        pan: (i - 1) * 0.4,
        when: t,
        bus: 'music',
      });
    }
  }

  // Kick: four on the floor.
  if (lvl > 0.22 && pos % 4 === 0) {
    a.tone({ freq: 150, endFreq: 42, dur: 0.22, vol: 0.5, when: t, bus: 'music' });
    kick(t);
  }

  // Hats: off-beats, then 16ths when things heat up.
  if (lvl > 0.32 && pos % 4 === 2) {
    a.noise({ dur: 0.05, vol: 0.12, filterType: 'highpass', filter: 7000, when: t, bus: 'music' });
  } else if (lvl > 0.72 && pos % 2 === 1) {
    a.noise({ dur: 0.03, vol: 0.05, filterType: 'highpass', filter: 9000, when: t, bus: 'music' });
  }

  // Snare on 2 and 4.
  if (lvl > 0.5 && (pos === 4 || pos === 12)) {
    a.noise({ dur: 0.16, vol: 0.22, filterType: 'bandpass', filter: 1800, when: t, bus: 'music' });
    a.tone({ freq: 190, endFreq: 120, dur: 0.1, vol: 0.14, type: 'triangle', when: t, bus: 'music' });
  }

  // Bass: driving 8ths with an octave hop.
  if (lvl > 0.16 && pos % 2 === 0) {
    const octave = pos % 8 === 6 ? 12 : 0;
    a.tone({
      freq: semitone(55, root + octave),
      type: 'sawtooth',
      dur: stepDur * 1.7,
      vol: 0.2,
      filter: 260 + lvl * 620,
      when: t,
      bus: 'music',
    });
  }

  // Arpeggio through the echo bus.
  if (lvl > 0.4 && (lvl > 0.62 || pos % 2 === 0)) {
    const idx = SPACE_ARP[pos % SPACE_ARP.length];
    const note = chord[idx % 3] + 12 * Math.floor(idx / 3);
    a.tone({
      freq: semitone(440, note),
      type: 'square',
      dur: stepDur * 0.9,
      vol: 0.028 + lvl * 0.02,
      filter: 1800 + lvl * 2600,
      pan: pos % 2 === 0 ? -0.35 : 0.35,
      when: t,
      bus: 'echo',
    });
  }
}

// ------------------------------------------------------------------ Forest: organic synth-electronica

/** Glassy plucks cascade down two octaves of chord tones and back, like water over stones. */
const FOREST_RIPPLE: readonly number[] = [6, 4, 5, 3, 4, 2, 3, 1, 2, 0, 1, 3, 2, 4, 3, 5];

function scheduleForest({ a, mode, step, pos, t, stepDur, lvl, chord, kick }: StepContext): void {
  const root = chord[0];
  const boss = mode === 'boss';

  // Pad: pairs of detuned triangles for a soft, shimmering wash whose filter opens with intensity.
  if (pos === 0) {
    const bar = stepDur * 16;
    for (let i = 0; i < chord.length; i++) {
      for (const detune of [0.996, 1.004]) {
        a.tone({
          freq: semitone(220, chord[i]) * detune,
          type: 'triangle',
          dur: bar * 1.08,
          attack: bar * 0.35,
          vol: 0.03,
          filter: 600 + lvl * 1800,
          pan: (i - 1) * 0.45 + (detune - 1) * 60,
          when: t,
          bus: 'music',
        });
      }
    }
  }

  // Soft, round kick: four on the floor.
  if (lvl > 0.22 && pos % 4 === 0) {
    a.tone({ freq: 120, endFreq: 45, dur: 0.26, vol: 0.42, type: 'sine', when: t, bus: 'music' });
    kick(t);
  }

  // Leaf-rustle hats: band-passed noise on the off-beats, rippling 16ths at high intensity.
  if (lvl > 0.32 && pos % 4 === 2) {
    a.noise({ dur: 0.08, vol: 0.08, filterType: 'bandpass', filter: 6000, endFilter: 4200, pan: 0.3, when: t, bus: 'music' });
  } else if (lvl > 0.7 && pos % 2 === 1) {
    a.noise({ dur: 0.035, vol: 0.035, filterType: 'bandpass', filter: 8000, pan: -0.3, when: t, bus: 'music' });
  }

  // Clap on 2 and 4: two quick bursts a few milliseconds apart for a natural flam.
  if (lvl > 0.5 && (pos === 4 || pos === 12)) {
    a.noise({ dur: 0.05, vol: 0.12, filterType: 'bandpass', filter: 1500, when: t, bus: 'music' });
    a.noise({ dur: 0.14, vol: 0.14, filterType: 'bandpass', filter: 1300, when: t + 0.014, bus: 'echo' });
  }

  // Bass: sine sub with a rounded triangle on a syncopated pattern, octave hop near the end of the bar.
  if (lvl > 0.16 && (pos === 0 || pos === 3 || pos === 6 || pos === 10 || pos === 12 || (boss && pos % 2 === 0))) {
    const note = root + (pos === 10 ? 12 : 0);
    a.tone({ freq: semitone(55, note), type: 'sine', dur: stepDur * 1.8, vol: 0.22, when: t, bus: 'music' });
    a.tone({ freq: semitone(55, note), type: 'triangle', dur: stepDur * 1.4, vol: 0.08, filter: 300 + lvl * 500, when: t, bus: 'music' });
  }

  // Glassy plucks rippling through the echo: sine plus a quiet octave partial for sparkle.
  if (lvl > 0.38 && (lvl > 0.62 || pos % 2 === 0)) {
    const idx = FOREST_RIPPLE[pos];
    const note = chord[idx % 3] + 12 * Math.floor(idx / 3);
    const freq = semitone(440, note);
    const pan = Math.sin(step * 0.4) * 0.6;
    a.tone({ freq, type: 'sine', dur: 0.2, vol: 0.045 + lvl * 0.02, pan, when: t, bus: 'echo' });
    a.tone({ freq: freq * 2, type: 'sine', dur: 0.07, vol: 0.012, pan, when: t, bus: 'echo' });
  }

  // Water droplets: little rising blips scattered on a fixed, irregular pattern.
  if (lvl > 0.3 && (step * 7) % 11 === 3) {
    a.tone({ freq: 1500 + (step % 5) * 180, endFreq: 2600, dur: 0.06, vol: 0.03, type: 'sine', pan: ((step % 7) - 3) * 0.2, when: t, bus: 'echo' });
  }

  // Counter-melody at high intensity: the chord's top note held over each half bar, an octave up.
  if (lvl > 0.7 && pos % 8 === 0) {
    a.tone({
      freq: semitone(440, chord[2] + (pos === 8 ? 2 : 0)),
      type: 'triangle',
      dur: stepDur * 7.5,
      attack: 0.12,
      vol: 0.04,
      filter: 2400,
      pan: -0.15,
      when: t,
      bus: 'echo',
    });
  }
}

// ------------------------------------------------------------------ Jungle: adventure toms, marimba and brass

const JUNGLE_LOW_TOM = new Set([0, 3, 8, 10]);
const JUNGLE_MID_TOM = new Set([6, 14]);
/** Marimba on a 3-3-2 rhythm: [step in bar, chord-tone index (3+ climbs an octave)]. */
const JUNGLE_MARIMBA = new Map<number, number>([[0, 0], [3, 2], [6, 1], [8, 3], [11, 2], [14, 4]]);
/**
 * Four-bar heroic brass melody over Am - G - F - E: [step 0-63, semitones above A3, length in steps].
 * Climbs through the first three bars and turns on the E chord's G# so the loop pulls back to the start.
 */
const JUNGLE_MELODY: readonly (readonly [number, number, number])[] = [
  [0, 7, 3], [3, 12, 3], [6, 10, 2], [8, 12, 6], [14, 15, 2],
  [16, 14, 6], [22, 12, 2], [24, 10, 4], [28, 7, 4],
  [32, 8, 3], [35, 12, 3], [38, 15, 2], [40, 17, 6], [46, 15, 2],
  [48, 14, 6], [54, 11, 2], [56, 8, 4], [60, 11, 4],
];
const JUNGLE_MELODY_AT = new Map(JUNGLE_MELODY.map(([step, note, len]) => [step, { note, len }]));

function jungleTom(a: AudioEngine, t: number, freq: number, vol: number, pan: number): void {
  a.tone({ freq, endFreq: freq * 0.55, dur: 0.24, vol, type: 'sine', pan, when: t, bus: 'music' });
  a.noise({ dur: 0.03, vol: vol * 0.2, filterType: 'bandpass', filter: freq * 6, pan, when: t, bus: 'music' });
}

function brass(a: AudioEngine, t: number, freq: number, dur: number, vol: number, filter: number): void {
  for (const [detune, pan] of [[0.995, -0.2], [1.005, 0.2]] as const) {
    a.tone({ freq: freq * detune, type: 'sawtooth', dur, attack: 0.035, vol, filter, pan, when: t, bus: 'music' });
  }
}

function scheduleJungle({ a, mode, step, pos, t, stepDur, lvl, chord, kick }: StepContext): void {
  const root = chord[0];
  const boss = mode === 'boss';
  const fillBar = step >= 48;

  // Pad: warm, filtered saw chord with a slow swell, kept low so the drums and brass lead.
  if (pos === 0) {
    const bar = stepDur * 16;
    for (let i = 0; i < chord.length; i++) {
      a.tone({
        freq: semitone(220, chord[i]),
        type: 'sawtooth',
        dur: bar * 1.05,
        attack: bar * 0.25,
        vol: 0.022,
        filter: 450 + lvl * 900,
        pan: (i - 1) * 0.4,
        when: t,
        bus: 'music',
      });
    }
  }

  // Punchy toms: low on a driving pattern, mid answering, high-tom fill rolling into each loop.
  if (lvl > 0.22) {
    if (JUNGLE_LOW_TOM.has(pos) || (boss && pos % 4 === 0)) {
      jungleTom(a, t, 140, 0.45, -0.1);
      if (pos === 0 || pos === 8) kick(t);
    }
    if (lvl > 0.4 && JUNGLE_MID_TOM.has(pos)) jungleTom(a, t, 210, 0.28, 0.25);
    if (lvl > 0.6 && fillBar && pos >= 12) jungleTom(a, t, 320 - (pos - 12) * 35, 0.22, 0.4 - (pos - 12) * 0.25);
  }

  // Rim crack on 2 and 4.
  if (lvl > 0.5 && (pos === 4 || pos === 12)) {
    a.noise({ dur: 0.07, vol: 0.16, filterType: 'bandpass', filter: 2600, when: t, bus: 'music' });
    a.tone({ freq: 330, endFreq: 260, dur: 0.05, vol: 0.08, type: 'triangle', when: t, bus: 'music' });
  }

  // Shaker: 8ths, then 16ths when things heat up.
  if (lvl > 0.32 && pos % 2 === 0) {
    a.noise({ dur: 0.05, vol: pos % 4 === 2 ? 0.08 : 0.05, filterType: 'highpass', filter: 6000, pan: 0.35, when: t, bus: 'music' });
  } else if (lvl > 0.72) {
    a.noise({ dur: 0.03, vol: 0.035, filterType: 'highpass', filter: 7500, pan: 0.35, when: t, bus: 'music' });
  }

  // Bass: plucky, following the toms.
  if (lvl > 0.16 && (JUNGLE_LOW_TOM.has(pos) || pos === 14)) {
    const note = root + (pos === 10 ? 7 : pos === 14 ? 12 : 0);
    a.tone({ freq: semitone(55, note), type: 'triangle', dur: stepDur * 2.2, vol: 0.26, filter: 400 + lvl * 500, when: t, bus: 'music' });
  }

  // Marimba: woody triangle with a quick decay plus a faint high partial; 16th fills at high intensity.
  const marimba = JUNGLE_MARIMBA.get(pos) ?? (lvl > 0.68 && pos % 2 === 1 ? (pos >> 1) % 5 : undefined);
  if (lvl > 0.36 && marimba !== undefined) {
    const note = chord[marimba % 3] + 12 * Math.floor(marimba / 3);
    const freq = semitone(440, note);
    const pan = (marimba - 2) * 0.2;
    a.tone({ freq, type: 'triangle', dur: 0.18, vol: 0.07, pan, when: t, bus: 'music' });
    a.tone({ freq: freq * 3.9, type: 'sine', dur: 0.03, vol: 0.012, pan, when: t, bus: 'music' });
  }

  if (boss) {
    // Bosses get brass stabs on the chord instead of the melody.
    if (lvl > 0.5 && (pos === 0 || pos === 6 || (fillBar && pos === 12))) {
      for (const n of chord) brass(a, t, semitone(220, n), stepDur * 1.6, 0.03, 1100 + lvl * 1200);
    }
    return;
  }

  // Heroic brass lead.
  const phrase = JUNGLE_MELODY_AT.get(step);
  if (lvl > 0.55 && phrase) brass(a, t, semitone(220, phrase.note), stepDur * phrase.len * 0.92, 0.035, 1500 + lvl * 1300);
}

// ------------------------------------------------------------------ Crystal: fast music-box electronica

/** Music-box arpeggio: chord-tone indices (3+ climb an octave) up and down two octaves across the bar. */
const CRYSTAL_ARP: readonly number[] = [0, 1, 2, 3, 4, 5, 4, 3, 1, 2, 3, 4, 5, 4, 3, 2];
/** Broken-beat kick: the downbeat, a skip before beat 3, and a push into the next bar. */
const CRYSTAL_KICK = new Set([0, 6, 10]);
/** Bright bell lead at high intensity over Am - C - G - F: [step 0-63, semitones above A4, length in steps]. */
const CRYSTAL_MELODY: readonly (readonly [number, number, number])[] = [
  [0, 12, 3], [3, 15, 3], [6, 19, 2], [8, 17, 4], [12, 15, 4],
  [16, 15, 3], [19, 19, 3], [22, 22, 2], [24, 19, 8],
  [32, 14, 3], [35, 17, 3], [38, 22, 2], [40, 19, 4], [44, 17, 4],
  [48, 15, 3], [51, 17, 3], [54, 19, 2], [56, 12, 8],
];
const CRYSTAL_MELODY_AT = new Map(CRYSTAL_MELODY.map(([step, note, len]) => [step, { note, len }]));

/** A small glassy bell: a sine with a faint inharmonic partial, like struck ice or a glockenspiel. */
function iceBell(a: AudioEngine, t: number, freq: number, vol: number, dur: number, pan: number): void {
  a.tone({ freq, type: 'sine', dur, attack: 0.002, vol, pan, when: t, bus: 'music' });
  a.tone({ freq: freq * 2.76, type: 'sine', dur: dur * 0.3, attack: 0.002, vol: vol * 0.28, pan, when: t, bus: 'music' });
}

function scheduleCrystal({ a, mode, step, pos, t, stepDur, lvl, chord, kick }: StepContext): void {
  const root = chord[0];
  const boss = mode === 'boss';

  // Pad: detuned sine pairs, a soft shimmering bed that opens up a little with intensity.
  if (pos === 0) {
    const bar = stepDur * 16;
    for (let i = 0; i < chord.length; i++) {
      for (const detune of [0.997, 1.003]) {
        a.tone({ freq: semitone(220, chord[i]) * detune, type: 'sine', dur: bar * 1.05, attack: bar * 0.2, vol: 0.028 + lvl * 0.01, pan: (i - 1) * 0.4 + (detune - 1) * 80, when: t, bus: 'music' });
      }
    }
  }

  // Music-box arpeggio: a plucked sine with a faint tine overtone, 8ths at first, racing 16ths as things heat up.
  if (lvl > 0.14 && (pos % 2 === 0 || lvl > 0.45)) {
    const idx = CRYSTAL_ARP[pos];
    const note = chord[idx % 3] + 12 * Math.floor(idx / 3);
    const freq = semitone(440, note);
    const pan = Math.sin(step * 0.5) * 0.45;
    a.tone({ freq, type: 'sine', dur: 0.16, attack: 0.002, vol: pos % 4 === 0 ? 0.06 : 0.042, pan, when: t, bus: 'music' });
    a.tone({ freq: freq * 3, type: 'sine', dur: 0.04, attack: 0.002, vol: 0.01, pan, when: t, bus: 'music' });
  }

  // Ice chimes on every beat keep time; the downbeat rings brightest.
  if (lvl > 0.18 && pos % 4 === 0) {
    const beat = pos >> 2;
    const note = chord[beat === 0 ? 2 : beat % 2] + 12;
    iceBell(a, t, semitone(440, note), beat === 0 ? 0.05 : 0.032, 0.6, beat % 2 === 0 ? -0.35 : 0.35);
  }

  // Kick: broken beat in play, straight four on the floor in a boss.
  if (lvl > 0.24 && (boss ? pos % 4 === 0 : CRYSTAL_KICK.has(pos))) {
    a.tone({ freq: 130, endFreq: 42, dur: 0.2, vol: 0.42, type: 'sine', when: t, bus: 'music' });
    if (pos % 4 === 0) kick(t);
  }

  // Snare on 2 and 4 (a frosty bandpassed snap), with ghost notes leading into them at high intensity.
  if (lvl > 0.45 && (pos === 4 || pos === 12)) {
    a.noise({ dur: 0.12, vol: 0.17, filterType: 'bandpass', filter: 2400, endFilter: 1500, when: t, bus: 'music' });
    a.tone({ freq: 210, endFreq: 140, dur: 0.07, vol: 0.1, type: 'triangle', when: t, bus: 'music' });
  } else if (lvl > 0.75 && (pos === 7 || pos === 15)) {
    a.noise({ dur: 0.05, vol: 0.06, filterType: 'bandpass', filter: 2600, when: t, bus: 'music' });
  }

  // Hats: 8ths, then running 16ths with accented off-beats.
  if (lvl > 0.32 && (pos % 2 === 0 || lvl > 0.62)) {
    const accent = pos % 4 === 2;
    a.noise({ dur: accent ? 0.045 : 0.025, vol: accent ? 0.08 : 0.04, filterType: 'highpass', filter: 9000, pan: 0.25, when: t, bus: 'music' });
  }

  // Bass: pulsing 8ths that bounce between the root and its octave.
  if (lvl > 0.16 && pos % 2 === 0) {
    const note = root + (pos % 4 === 2 ? 12 : 0);
    a.tone({ freq: semitone(55, note), type: 'triangle', dur: stepDur * 1.5, vol: 0.2, filter: 300 + lvl * 600, when: t, bus: 'music' });
    if (pos % 4 === 0) a.tone({ freq: semitone(55, root), type: 'sine', dur: stepDur * 1.8, vol: 0.14, when: t, bus: 'music' });
  }

  // Bright bell lead through the echo at high intensity (bosses keep to the beat and chimes).
  const phrase = CRYSTAL_MELODY_AT.get(step);
  if (!boss && lvl > 0.6 && phrase) {
    const freq = semitone(440, phrase.note);
    a.tone({ freq, type: 'triangle', dur: stepDur * phrase.len * 0.9, attack: 0.01, vol: 0.045, filter: 3200, pan: 0.1, when: t, bus: 'echo' });
    a.tone({ freq: freq * 2, type: 'sine', dur: 0.12, attack: 0.002, vol: 0.012, pan: 0.1, when: t, bus: 'echo' });
  }
}

// ------------------------------------------------------------------ Desert: Egyptian adventure, oud and frame drums

/**
 * The tune's scale on A: A Bb C D E F G# (A minor with a flattened second and a raised seventh). The half
 * step above A and the wide step from F up to G# give it the Egyptian sound, and it still sits on A minor,
 * so the sound effects stay in tune.
 */
const DESERT_SCALE: readonly number[] = [0, 1, 3, 5, 7, 8, 11];
/** Maqsum, the classic Egyptian rhythm, in eighths: doum (deep) on 1 and 5, tek (crisp) on 2, 4 and 7. */
const DESERT_DOUM = new Set([0, 8]);
const DESERT_TEK = new Set([2, 6, 12]);
/** Baladi for bosses: a heavier doum-doum start. */
const DESERT_BOSS_DOUM = new Set([0, 2, 8, 10]);
/** Oud ostinato on a 3-3-2 rhythm: [step in bar, chord-tone index (3+ climbs an octave), ornamented?]. */
const DESERT_OUD = new Map<number, readonly [number, boolean]>([
  [0, [0, true]], [3, [1, false]], [6, [2, false]], [8, [3, true]], [11, [2, false]], [14, [1, false]],
]);
/**
 * Four-bar soaring reed melody over Am - Bb - Dm - E: [step 0-63, semitones above A4, length in steps]. It
 * falls down the scale from E through the Bb, climbs over the Bb chord, reaches high A and Bb over Dm and
 * turns on G# over E so the loop pulls back home.
 */
const DESERT_MELODY: readonly (readonly [number, number, number])[] = [
  [0, 7, 4], [4, 8, 2], [6, 7, 2], [8, 5, 2], [10, 3, 2], [12, 1, 2], [14, 0, 2],
  [16, 1, 3], [19, 5, 3], [22, 8, 2], [24, 7, 2], [26, 8, 2], [28, 5, 4],
  [32, 12, 4], [36, 13, 2], [38, 12, 2], [40, 11, 2], [42, 8, 2], [44, 7, 4],
  [48, 7, 3], [51, 8, 1], [52, 11, 4], [56, 8, 2], [58, 7, 2], [60, 8, 2], [62, 11, 2],
];
const DESERT_MELODY_AT = new Map(DESERT_MELODY.map(([step, note, len]) => [step, { note, len }]));

/** The next note of the desert scale above `note` (semitones from A), for the oud's grace notes. */
function desertStepUp(note: number): number {
  const octave = Math.floor(note / 12);
  const within = note - octave * 12;
  const next = DESERT_SCALE.find((n) => n > within);
  return next === undefined ? (octave + 1) * 12 : octave * 12 + next;
}

/** Frame drum: the deep doum, or the crisp tek at the rim. */
function frameDrum(a: AudioEngine, t: number, deep: boolean, vol: number, pan: number): void {
  if (deep) {
    a.tone({ freq: 95, endFreq: 52, dur: 0.32, vol, type: 'sine', pan, when: t, bus: 'music' });
    a.noise({ dur: 0.05, vol: vol * 0.25, filter: 500, pan, when: t, bus: 'music' });
  } else {
    a.noise({ dur: 0.045, vol, filterType: 'bandpass', filter: 3400, pan, when: t, bus: 'music' });
    a.tone({ freq: 620, endFreq: 480, dur: 0.04, vol: vol * 0.4, type: 'triangle', pan, when: t, bus: 'music' });
  }
}

/** Oud: a bright, quickly dying pluck with a body note an octave down. */
function oud(a: AudioEngine, t: number, freq: number, vol: number, pan: number): void {
  a.tone({ freq, type: 'sawtooth', dur: 0.26, attack: 0.003, vol, filter: 1900, pan, when: t, bus: 'music' });
  a.tone({ freq: freq / 2, type: 'triangle', dur: 0.2, attack: 0.003, vol: vol * 0.7, pan, when: t, bus: 'music' });
  a.tone({ freq, type: 'triangle', dur: 0.3, vol: vol * 0.25, pan: -pan, when: t + 0.01, bus: 'echo' });
}

/** Reed lead (like a ney or mizmar): scoops up into each note from a little below, then holds it. */
function reed(a: AudioEngine, t: number, freq: number, dur: number, vol: number, filter: number): void {
  a.tone({ freq: freq * 0.95, endFreq: freq, type: 'sawtooth', dur: 0.07, attack: 0.03, vol: vol * 0.7, filter, when: t, bus: 'music' });
  for (const [detune, pan] of [[0.996, -0.15], [1.004, 0.15]] as const) {
    a.tone({ freq: freq * detune, type: 'sawtooth', dur, attack: 0.06, vol, filter, pan, when: t + 0.05, bus: 'music' });
  }
  a.tone({ freq, type: 'sine', dur: dur * 1.2, attack: 0.08, vol: vol * 0.5, when: t + 0.05, bus: 'echo' });
}

function scheduleDesert({ a, mode, step, pos, t, stepDur, lvl, chord, kick }: StepContext): void {
  const root = chord[0];
  const boss = mode === 'boss';
  const fillBar = step >= 48;
  const bar = stepDur * 16;

  // Drone: A and E held under everything, whatever the chord, as in Egyptian music.
  if (pos === 0) {
    for (const [note, pan] of [[0, -0.3], [7, 0.3]] as const) {
      a.tone({ freq: semitone(55, note), type: 'sawtooth', dur: bar * 1.05, attack: bar * 0.2, vol: 0.03, filter: 260 + lvl * 220, pan, when: t, bus: 'music' });
    }
    // Strings: a warm chord swelling under the bar.
    for (let i = 0; i < chord.length; i++) {
      a.tone({ freq: semitone(220, chord[i]), type: 'sawtooth', dur: bar * 1.05, attack: bar * 0.3, vol: 0.018, filter: 500 + lvl * 800, pan: (i - 1) * 0.45, when: t, bus: 'music' });
    }
  }

  // Frame drums: maqsum in play, a heavier baladi for bosses, with ghost taps filling in when it heats up.
  if (lvl > 0.2) {
    const doum = boss ? DESERT_BOSS_DOUM : DESERT_DOUM;
    if (doum.has(pos)) {
      frameDrum(a, t, true, boss ? 0.5 : 0.44, -0.1);
      if (pos === 0 || pos === 8) kick(t);
    }
    if (lvl > 0.3 && DESERT_TEK.has(pos)) frameDrum(a, t, false, 0.17, 0.25);
    else if (lvl > 0.62 && pos % 2 === 1) frameDrum(a, t, false, 0.05, 0.3);
    // A rolling tek fill into each loop.
    if (lvl > 0.6 && fillBar && pos >= 12) frameDrum(a, t, false, 0.08 + (pos - 12) * 0.03, 0.35);
  }

  // Riq jingles: a quick double shimmer on the offbeats.
  if (lvl > 0.35 && pos % 4 === 2) {
    for (const d of [0, 0.03]) a.noise({ dur: 0.05, vol: 0.045, filterType: 'highpass', filter: 7500, pan: -0.35, when: t + d, bus: 'music' });
  }

  // Bass: plucked on the doum, stepping up to the fifth before the bar turns.
  if (lvl > 0.15 && (DESERT_DOUM.has(pos) || pos === 6 || pos === 14)) {
    const note = root + (pos === 14 ? 7 : pos === 6 ? 12 : 0);
    a.tone({ freq: semitone(55, note), type: 'triangle', dur: stepDur * 2.2, vol: 0.26, filter: 380 + lvl * 450, when: t, bus: 'music' });
  }

  // Low strings driving on every beat.
  if (lvl > 0.45 && pos % 4 === 0) {
    for (const detune of [0.997, 1.003]) {
      a.tone({ freq: semitone(110, root) * detune, type: 'sawtooth', dur: stepDur * 1.6, attack: 0.01, vol: 0.03, filter: 700, when: t, bus: 'music' });
    }
  }

  // Oud ostinato, with a quick grace note from the scale step above on its accents.
  const pluck = DESERT_OUD.get(pos) ?? (lvl > 0.7 && pos % 2 === 1 ? ([(pos >> 1) % 4, false] as const) : undefined);
  if (lvl > 0.35 && pluck) {
    const [index, grace] = pluck;
    const note = chord[index % 3] + 12 * Math.floor(index / 3);
    const pan = (index - 1.5) * 0.25;
    if (grace) {
      oud(a, t, semitone(220, desertStepUp(note)), 0.04, pan);
      oud(a, t + Math.min(0.06, stepDur * 0.45), semitone(220, note), 0.065, pan);
    } else {
      oud(a, t, semitone(220, note), 0.06, pan);
    }
  }

  // Finger cymbals ringing on 2 and 4 at full tilt.
  if (lvl > 0.7 && (pos === 4 || pos === 12)) {
    a.tone({ freq: 2960, type: 'sine', dur: 0.5, vol: 0.016, pan: 0.4, when: t, bus: 'echo' });
    a.tone({ freq: 4230, type: 'sine', dur: 0.35, vol: 0.01, pan: 0.4, when: t, bus: 'echo' });
  }

  if (boss) {
    // War drums and string stabs on the chord instead of the melody.
    if (lvl > 0.4 && pos % 4 === 0) a.tone({ freq: 62, endFreq: 38, dur: 0.45, vol: 0.4, type: 'sine', when: t, bus: 'music' });
    if (lvl > 0.5 && (pos === 0 || pos === 6 || (fillBar && pos === 12))) {
      for (const n of chord) reed(a, t, semitone(220, n), stepDur * 1.4, 0.022, 1300 + lvl * 1000);
    }
    return;
  }

  // The soaring lead.
  const phrase = DESERT_MELODY_AT.get(step);
  if (lvl > 0.55 && phrase) reed(a, t, semitone(440, phrase.note), stepDur * phrase.len * 0.95, 0.028, 1700 + lvl * 1100);
}

const TRACKS: Readonly<Record<MusicTrackId, TrackDef>> = {
  space: {
    tempo: { menu: 104, game: 122, boss: 138 },
    progressions: {
      menu: [[0, 3, 7], [-4, 0, 3], [3, 7, 10], [-2, 2, 5]],
      game: [[0, 3, 7], [-4, 0, 3], [3, 7, 10], [-2, 2, 5]],
      boss: [[0, 3, 7], [1, 5, 8], [0, 3, 7], [-5, -1, 2]],
    },
    schedule: scheduleSpace,
  },
  forest: {
    tempo: { menu: 100, game: 120, boss: 134 },
    progressions: {
      // Am - F - Dm - Em: floating and gentle.
      menu: [[0, 3, 7], [-4, 0, 3], [5, 8, 12], [-5, -2, 2]],
      // Am - C - G - D: a bright Dorian lift for play.
      game: [[0, 3, 7], [3, 7, 10], [-2, 2, 5], [5, 9, 12]],
      // Am - F - Bb - E: darker tension for bosses.
      boss: [[0, 3, 7], [-4, 0, 3], [1, 5, 8], [-5, -1, 2]],
    },
    schedule: scheduleForest,
  },
  jungle: {
    tempo: { menu: 96, game: 128, boss: 140 },
    progressions: {
      // Am - F - G - Am: a quest about to begin.
      menu: [[0, 3, 7], [-4, 0, 3], [-2, 2, 5], [0, 3, 7]],
      // Am - G - F - E: the classic adventure descent.
      game: [[0, 3, 7], [-2, 2, 5], [-4, 0, 3], [-5, -1, 2]],
      // Am - Bb - Am - E: menacing half-step stabs.
      boss: [[0, 3, 7], [1, 5, 8], [0, 3, 7], [-5, -1, 2]],
    },
    schedule: scheduleJungle,
  },
  crystal: {
    tempo: { menu: 108, game: 132, boss: 146 },
    progressions: {
      // Am - Em - F - C: bright and open.
      menu: [[0, 3, 7], [-5, -2, 2], [-4, 0, 3], [3, 7, 10]],
      // Am - C - G - F: a quick, glittering climb and fall.
      game: [[0, 3, 7], [3, 7, 10], [-2, 2, 5], [-4, 0, 3]],
      // Am - F - Bb - E: urgent half-step tension.
      boss: [[0, 3, 7], [-4, 0, 3], [1, 5, 8], [-5, -1, 2]],
    },
    schedule: scheduleCrystal,
  },
  desert: {
    tempo: { menu: 92, game: 124, boss: 140 },
    progressions: {
      // Am - Dm - Bb - E: mysterious, the flattened second hanging over the menu.
      menu: [[0, 3, 7], [5, 8, 12], [1, 5, 8], [-5, -1, 2]],
      // Am - Bb - Dm - E: the half-step lift and the pull home through E.
      game: [[0, 3, 7], [1, 5, 8], [5, 8, 12], [-5, -1, 2]],
      // Am - Bb - F - E: the descent to the E, pounding.
      boss: [[0, 3, 7], [1, 5, 8], [-4, 0, 3], [-5, -1, 2]],
    },
    schedule: scheduleDesert,
  },
};

/**
 * Generative, adaptive soundtrack. A 16th-note step sequencer schedules
 * synthesised parts slightly ahead of the audio clock. Layers fade in as
 * `intensity` rises (combo, level progress, boss), so the music follows the
 * action without any pre-rendered stems. Each world picks a `track`.
 */
export class Music {
  mode: MusicMode = 'menu';
  private currentTrack: MusicTrackId = 'space';
  private intensity = 0.15;
  private targetIntensity = 0.15;
  private nextTime = 0;
  private step = 0;
  private readonly kicks: number[] = [0, 0, 0, 0];
  private kickCursor = 0;
  private readonly kick = (t: number): void => {
    this.kicks[this.kickCursor] = t;
    this.kickCursor = (this.kickCursor + 1) % this.kicks.length;
  };

  constructor(private readonly audio: AudioEngine) {}

  get track(): MusicTrackId {
    return this.currentTrack;
  }

  /** Switch soundtrack; a new track starts from its first bar. */
  set track(id: MusicTrackId) {
    if (id === this.currentTrack) return;
    this.currentTrack = id;
    this.step = 0;
  }

  /** 0 = ambient pad only, 1 = everything firing. */
  setIntensity(value: number): void {
    this.targetIntensity = Math.max(0, Math.min(1, value));
  }

  /** Decaying pulse in [0, 1] locked to the kick drum, for beat-synced visuals. */
  get beat(): number {
    const ctx = this.audio.context;
    if (!ctx || ctx.state !== 'running') return 0;
    const now = ctx.currentTime;
    let latest = -1;
    for (const t of this.kicks) if (t <= now && t > latest) latest = t;
    return latest < 0 ? 0 : Math.exp(-(now - latest) * 7);
  }

  /** Call once per frame; schedules any steps that fall inside the look-ahead window. */
  update(): void {
    const ctx = this.audio.context;
    if (!ctx || ctx.state !== 'running') return;
    const now = ctx.currentTime;
    if (this.nextTime < now - 0.2) this.nextTime = now + 0.06; // resync after a stall
    const track = TRACKS[this.currentTrack];
    const stepDur = 60 / track.tempo[this.mode] / 4;
    while (this.nextTime < now + LOOKAHEAD) {
      this.intensity += (this.targetIntensity - this.intensity) * 0.1;
      track.schedule({
        a: this.audio,
        mode: this.mode,
        step: this.step,
        pos: this.step % 16,
        t: this.nextTime,
        stepDur,
        lvl: this.intensity,
        chord: track.progressions[this.mode][Math.floor(this.step / 16) % 4],
        kick: this.kick,
      });
      this.nextTime += stepDur;
      this.step = (this.step + 1) % 64;
    }
  }
}
