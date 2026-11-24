import { expect, it } from 'vitest';
import type { AudioEngine, NoiseOptions, ToneOptions } from '../src/engine/audio/AudioEngine';
import { Music } from '../src/app/audio/Music';
import { MUSIC_TRACKS, type MusicTrackId } from '../src/content/musicTracks';
import verdantHollow from '../public/worlds/Verdant-Hollow.json';
import jungleRuins from '../public/worlds/Jungle-Ruins-jungle-ruins.json';
import pharoughsTomb from '../public/worlds/Pharoughs-Tomb.json';
import { createWorld, validateWorld, withBackground } from '../src/content/authoredWorlds';

/** Runs `seconds` of a track at full intensity against a fake engine and returns what it scheduled. */
function render(track: MusicTrackId, seconds = 8): { tones: ToneOptions[]; noises: NoiseOptions[]; beatSeen: boolean } {
  const tones: ToneOptions[] = [];
  const noises: NoiseOptions[] = [];
  const context = { state: 'running', currentTime: 0 };
  const audio = { context, tone: (o: ToneOptions) => tones.push(o), noise: (o: NoiseOptions) => noises.push(o) } as unknown as AudioEngine;
  const music = new Music(audio);
  music.track = track;
  music.mode = 'game';
  music.setIntensity(1);
  let beatSeen = false;
  for (let t = 0; t < seconds; t += 1 / 60) {
    context.currentTime = t;
    music.update();
    if (music.beat > 0.5) beatSeen = true;
  }
  return { tones, noises, beatSeen };
}

it('plays distinct, well-formed forest, jungle, crystal and desert tracks with a beat for visuals', () => {
  const forest = render('forest');
  const space = render('space');
  const jungle = render('jungle');
  const crystal = render('crystal');
  const desert = render('desert');
  for (const result of [forest, space, jungle, crystal, desert]) {
    expect(result.tones.length).toBeGreaterThan(50);
    expect(result.beatSeen).toBe(true);
    for (const o of result.tones) {
      expect(Number.isFinite(o.freq) && o.freq > 20 && o.freq < 8000).toBe(true);
      expect(o.vol).toBeLessThanOrEqual(0.5);
      expect(o.bus === 'music' || o.bus === 'echo').toBe(true);
    }
  }
  // Each track has its own sound, not a re-skin of another.
  const signature = (r: typeof space) => JSON.stringify(r.tones.slice(0, 40).map((o) => [o.type, Math.round(o.freq)]));
  expect(new Set([signature(space), signature(forest), signature(jungle), signature(crystal), signature(desert)]).size).toBe(5);
  // Crystal keeps time with ice chimes: a ringing bell on every beat at 132 BPM.
  const chimes = crystal.tones.filter((o) => o.type === 'sine' && o.dur === 0.6);
  expect(chimes.length).toBeGreaterThan(8);
  for (let i = 1; i < chimes.length; i++) expect(chimes[i].when! - chimes[i - 1].when!).toBeCloseTo(60 / 132, 2);
  // Forest stays soft (sine/triangle only); jungle carries a sawtooth brass lead.
  expect(forest.tones.every((o) => o.type === undefined || o.type === 'sine' || o.type === 'triangle')).toBe(true);
  expect(jungle.tones.some((o) => o.type === 'sawtooth' && o.bus === 'music' && (o.attack ?? 0) > 0.03 && o.dur < 2)).toBe(true);
});

it('stores the chosen track in a world and keeps it through validation and scene changes', () => {
  const data = createWorld('music-test');
  expect(data.world.music).toBeUndefined();
  expect(withBackground(data.world, 'forest').music).toBe('forest'); // forest scenery defaults to its own track
  data.world = { ...data.world, music: 'forest' };
  expect(validateWorld(data).world.music).toBe('forest');
  expect(withBackground(data.world, 'space').music).toBe('forest');
  expect(() => validateWorld({ ...data, world: { ...data.world, music: 'disco' } })).toThrow('Unsupported music track');
  expect(MUSIC_TRACKS.map((track) => track.id)).toEqual(['space', 'forest', 'jungle', 'crystal', 'desert']);
});

it('stores weather in a world and keeps it through validation and scene changes', () => {
  const data = createWorld('weather-test');
  expect(data.world.weather).toBeUndefined();
  data.world = { ...data.world, weather: 'rain' };
  expect(validateWorld(data).world.weather).toBe('rain');
  expect(withBackground(data.world, 'forest').weather).toBe('rain');
  expect(() => validateWorld({ ...data, world: { ...data.world, weather: 'hail' } })).toThrow('Unsupported weather');
  expect(validateWorld(jungleRuins).world.weather).toBe('rain');
  expect(validateWorld(verdantHollow).world.weather).toBeUndefined();
});

it('gives the forest, jungle and tomb campaigns their own tracks', () => {
  expect(validateWorld(verdantHollow).world.music).toBe('forest');
  expect(validateWorld(jungleRuins).world.music).toBe('jungle');
  expect(validateWorld(pharoughsTomb).world.music).toBe('desert');
});
