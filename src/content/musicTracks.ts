/** Soundtracks a world can choose (WorldDef.music). Every track is in A minor so SFX pitches always fit. */
export type MusicTrackId = 'space' | 'forest' | 'jungle' | 'crystal' | 'desert';

/** Shown in the world editor's Music picker, in this order. */
export const MUSIC_TRACKS: readonly { readonly id: MusicTrackId; readonly label: string }[] = [
  { id: 'space', label: 'Space — synth drive' },
  { id: 'forest', label: 'Forest — organic synth-electronica' },
  { id: 'jungle', label: 'Jungle — adventure drums & brass' },
  { id: 'crystal', label: 'Crystal — fast music-box electronica & ice chimes' },
  { id: 'desert', label: 'Desert — Egyptian adventure, oud & frame drums' },
];

export function isMusicTrack(value: unknown): value is MusicTrackId {
  return MUSIC_TRACKS.some((track) => track.id === value);
}
