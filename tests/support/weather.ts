import * as THREE from 'three';
import type { AudioEngine } from '../../src/engine/audio/AudioEngine';
import { ParticleSystem } from '../../src/engine/render/ParticleSystem';
import { CAMERA_HOME } from '../../src/gameplay/CameraRig';
import { World } from '../../src/gameplay/World';
import type { Weather, WeatherContext, WeatherFrame } from '../../src/gameplay/weather/Weather';
import { WEATHERS, type WeatherKind } from '../../src/gameplay/weather/weathers';
import { WEATHER_TYPES } from '../../src/gameplay/weather/weatherTypes';
import type { WeatherSettings } from '../../src/gameplay/weather/settings';
import { FakeAudio } from './fakeAudio';
import { SHIPPED_CAMPAIGN } from './worlds';

export const DT = 1 / 60;

/** A weather of `kind` in an empty scene, with the game camera, a recording audio engine and a world to rain on. */
export function weatherHarness<K extends WeatherKind>(kind: K) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 16 / 9, 0.5, 400);
  camera.position.set(0, CAMERA_HOME.y, CAMERA_HOME.z);
  camera.lookAt(0, CAMERA_HOME.lookY, 0);
  camera.updateMatrixWorld();
  const audio = new FakeAudio();
  const shakes: number[] = [];
  const state = { soundOn: true };
  const ctx: WeatherContext = {
    scene,
    camera,
    particles: new ParticleSystem(5000),
    audio: audio as unknown as AudioEngine,
    soundOn: () => state.soundOn,
    shake: (level) => shakes.push(level),
  };
  const weather = new WEATHER_TYPES[kind](ctx) as InstanceType<(typeof WEATHER_TYPES)[K]>;
  const world = new World(SHIPPED_CAMPAIGN);
  world.newGame(1);
  const frame: WeatherFrame = { realDt: DT, simDt: DT, world, ball: null, paddleX: 0 };
  /** Runs it for `seconds`, the game running (`simulating`) or paused, calling `each` after every frame. */
  const run = (seconds: number, simulating = true, each: () => void = () => {}): void => {
    for (let t = 0; t < seconds; t += DT) {
      frame.realDt = DT;
      frame.simDt = simulating ? DT : 0;
      (weather as Weather).update(frame);
      audio.context.currentTime += DT;
      each();
    }
  };
  return { scene, camera, audio, shakes, state, weather, world, frame, run };
}

/** Its usual settings, with these paths. */
export function settings(kind: WeatherKind, paths: WeatherSettings['paths']): WeatherSettings {
  return { kind, paths, every: [...WEATHERS[kind].every] };
}

/** Whether (x, y) lies on the polyline through `points` (straight segments, as a line with no curve). */
export function onLine(points: readonly { x: number; y: number }[], x: number, y: number): boolean {
  return points.slice(1).some((b, i) => {
    const a = points[i];
    const ex = b.x - a.x,
      ey = b.y - a.y;
    const u = Math.max(0, Math.min(1, ((x - a.x) * ex + (y - a.y) * ey) / (ex * ex + ey * ey)));
    return Math.hypot(x - a.x - ex * u, y - a.y - ey * u) < 1e-4;
  });
}
