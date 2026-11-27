import * as THREE from 'three';
import type { AudioEngine } from '../../src/engine/audio/AudioEngine';
import { ParticleSystem } from '../../src/engine/render/ParticleSystem';
import { CAMERA_HOME } from '../../src/gameplay/CameraRig';
import { World } from '../../src/gameplay/World';
import type { Ambience, AmbienceContext, AmbienceFrame } from '../../src/gameplay/ambience/Ambience';
import { AMBIENCES, type AmbienceKind } from '../../src/gameplay/ambience/ambiences';
import { AMBIENCE_TYPES } from '../../src/gameplay/ambience/ambienceTypes';
import type { AmbienceSettings } from '../../src/gameplay/ambience/settings';
import { FakeAudio } from './fakeAudio';
import { SHIPPED_CAMPAIGN } from './worlds';

export const DT = 1 / 60;

/** An ambience of `kind` in an empty scene, with the game camera, a recording audio engine and a world to rain on. */
export function ambienceHarness<K extends AmbienceKind>(kind: K) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 16 / 9, 0.5, 400);
  camera.position.set(0, CAMERA_HOME.y, CAMERA_HOME.z);
  camera.lookAt(0, CAMERA_HOME.lookY, 0);
  camera.updateMatrixWorld();
  const audio = new FakeAudio();
  const shakes: number[] = [];
  const state = { soundOn: true };
  const ctx: AmbienceContext = {
    scene,
    camera,
    particles: new ParticleSystem(5000),
    audio: audio as unknown as AudioEngine,
    soundOn: () => state.soundOn,
    shake: (level) => shakes.push(level),
  };
  const ambience = new AMBIENCE_TYPES[kind](ctx) as InstanceType<(typeof AMBIENCE_TYPES)[K]>;
  const world = new World(SHIPPED_CAMPAIGN);
  world.newGame(1);
  const frame: AmbienceFrame = { realDt: DT, simDt: DT, world, ball: null, paddleX: 0 };
  /** Runs it for `seconds`, the game running (`simulating`) or paused, calling `each` after every frame. */
  const run = (seconds: number, simulating = true, each: () => void = () => {}): void => {
    for (let t = 0; t < seconds; t += DT) {
      frame.realDt = DT;
      frame.simDt = simulating ? DT : 0;
      (ambience as Ambience).update(frame);
      audio.context.currentTime += DT;
      each();
    }
  };
  return { scene, camera, audio, shakes, state, ambience, world, frame, run };
}

/** Its usual settings, with these paths. */
export function settings(kind: AmbienceKind, paths: AmbienceSettings['paths']): AmbienceSettings {
  return { kind, paths, every: [...AMBIENCES[kind].every] };
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
