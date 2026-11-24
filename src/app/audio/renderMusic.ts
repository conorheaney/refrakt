import { AudioEngine } from '../../engine/audio/AudioEngine';
import type { MusicTrackId } from '../../content/musicTracks';
import { Music, type MusicMode } from './Music';

/** One stretch of a recording: the part played, for how long, and its intensity ramping from `from` to `to`. */
export interface RecordingPart {
  readonly mode: MusicMode;
  readonly seconds: number;
  readonly from: number;
  readonly to: number;
}

/**
 * Records a soundtrack offline, exactly as the game plays it, for the world editor's "Save recording". The
 * engine runs on an OfflineAudioContext that pauses every quarter second so the music can schedule the next
 * stretch a frame at a time, as it does live (scheduling it all up front would leave thousands of nodes
 * waiting in the graph and crawl). Takes a few seconds per minute of music.
 */
export async function renderMusic(track: MusicTrackId, parts: readonly RecordingPart[], rate = 44100): Promise<AudioBuffer> {
  const total = parts.reduce((sum, part) => sum + part.seconds, 0);
  // A couple of seconds more so the last notes and echoes ring out.
  const ctx = new OfflineAudioContext(2, Math.ceil((total + 2.5) * rate), rate);
  // The engine and music only schedule while the context reports 'running', relative to its clock; the
  // offline context is driven by hand instead.
  let clock = 0;
  Object.defineProperty(ctx, 'state', { get: () => 'running' });
  Object.defineProperty(ctx, 'currentTime', { get: () => clock });
  const engine = new AudioEngine();
  engine.attach(ctx);
  const music = new Music(engine);
  music.track = track;

  const advance = (until: number): void => {
    for (; clock < Math.min(until, total); clock += 1 / 60) {
      let start = 0;
      for (const part of parts) {
        if (clock < start + part.seconds) {
          music.mode = part.mode;
          music.setIntensity(part.from + ((part.to - part.from) * (clock - start)) / part.seconds);
          break;
        }
        start += part.seconds;
      }
      music.update();
    }
  };
  const BLOCK = 0.25;
  for (let at = BLOCK; at < total; at += BLOCK) {
    void ctx.suspend(at).then(() => {
      advance(at + BLOCK);
      void ctx.resume();
    });
  }
  advance(BLOCK);
  return ctx.startRendering();
}

/** A 16-bit PCM WAV file of `buffer`. */
export function toWav(buffer: AudioBuffer): Blob {
  const channels = buffer.numberOfChannels;
  const frames = buffer.length;
  const bytes = frames * channels * 2;
  const out = new DataView(new ArrayBuffer(44 + bytes));
  const text = (at: number, s: string): void => {
    for (let i = 0; i < s.length; i++) out.setUint8(at + i, s.charCodeAt(i));
  };
  text(0, 'RIFF');
  out.setUint32(4, 36 + bytes, true);
  text(8, 'WAVEfmt ');
  out.setUint32(16, 16, true);
  out.setUint16(20, 1, true);
  out.setUint16(22, channels, true);
  out.setUint32(24, buffer.sampleRate, true);
  out.setUint32(28, buffer.sampleRate * channels * 2, true);
  out.setUint16(32, channels * 2, true);
  out.setUint16(34, 16, true);
  text(36, 'data');
  out.setUint32(40, bytes, true);
  const data = Array.from({ length: channels }, (_, c) => buffer.getChannelData(c));
  for (let i = 0, at = 44; i < frames; i++) {
    for (let c = 0; c < channels; c++, at += 2) out.setInt16(at, Math.max(-1, Math.min(1, data[c][i])) * 32767, true);
  }
  return new Blob([out], { type: 'audio/wav' });
}
