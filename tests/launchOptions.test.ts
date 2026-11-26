import { expect, it } from 'vitest';
import { DEFAULT_LAUNCH_OPTIONS, parseLaunchOptions } from '../src/app/launchOptions';

it('reads no flags as the defaults', () => {
  expect(parseLaunchOptions('')).toEqual(DEFAULT_LAUNCH_OPTIONS);
});

it('reads each flag', () => {
  expect(parseLaunchOptions('?level=12&autopilot&debugArena')).toEqual({
    level: 12,
    autopilot: true,
    editorPreview: null,
    debugArena: true,
  });
  expect(parseLaunchOptions('?editorPreview=1&stage=3').editorPreview).toEqual({ stage: 3 });
});

it('treats malformed numbers as absent', () => {
  for (const level of ['abc', '', '2.5', ' ']) expect(parseLaunchOptions(`?level=${level}`).level).toBeNull();
  // The editor's test play always has a stage: level 1 when the given one is missing or invalid.
  for (const stage of ['', 'x', '-1', '1.5']) {
    expect(parseLaunchOptions(`?editorPreview&stage=${stage}`).editorPreview).toEqual({ stage: 0 });
  }
  expect(parseLaunchOptions('?editorPreview').editorPreview).toEqual({ stage: 0 });
});
