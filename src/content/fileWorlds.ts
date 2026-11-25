import { authoredEntry, isPlayable, playProblems, validateWorld, type AuthoredWorld, type LibraryResult } from './authoredWorlds';
import { Campaign, type WorldEntry } from './campaign';
import { STAGES_PER_WORLD } from './worlds';

/** The manifest provides stable play order on both Vite and static hosting. */
export async function loadFileWorlds(base: URL, request: typeof fetch = fetch): Promise<LibraryResult> {
  const worlds: AuthoredWorld[] = [];
  const warnings: string[] = [];
  async function json(url: URL): Promise<unknown> {
    const response = await request(url, { cache: 'no-cache' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  }
  try {
    const files = await json(new URL('index.json', base));
    if (!Array.isArray(files) || !files.every((file) => typeof file === 'string' && /^[\w-]+\.json$/.test(file) && file !== 'index.json')) {
      throw new Error('World index must be an array of JSON filenames.');
    }
    const results = await Promise.all(files.map(async (file) => {
      try {
        const world = validateWorld(await json(new URL(file, base)));
        if (!isPlayable(world)) throw new Error(`Not ready to play: ${playProblems(world)}.`);
        return { file, world };
      } catch (error) { return { file, error }; }
    }));
    for (const result of results) {
      if (!result.world) warnings.push(`${result.file}: ${String(result.error)}`);
      else if (worlds.some((world) => world.key === result.world.key)) warnings.push(`${result.file}: duplicate world key.`);
      else if (result.world.replaces && worlds.some((world) => world.replaces === result.world.replaces)) warnings.push(`${result.file}: duplicate campaign replacement.`);
      else worlds.push(result.world);
    }
  } catch (error) { warnings.push(`World files unavailable: ${String(error)}`); }
  return { worlds, warnings };
}

/**
 * The campaign the game plays. Project files that take the Space and Forest slots (`replaces`) come first, in
 * that order, as the main campaign; then the other project files in manifest order; then browser saves whose
 * key no project file uses (a save's `replaces` is ignored). Worlds that can't be played yet (unfinished
 * levels, missing areas) are skipped. Throws when nothing is playable.
 */
export function buildCampaign(files: readonly AuthoredWorld[], saved: readonly AuthoredWorld[] = []): Campaign {
  const playableFiles = files.map((value) => validateWorld(value)).filter(isPlayable);
  const main = (['space', 'forest'] as const)
    .map((slot) => playableFiles.find((world) => world.replaces === slot))
    .filter((world): world is AuthoredWorld => world !== undefined);
  const fileKeys = new Set(files.map((world) => world.key));
  const playableSaves = saved.filter((world) => !fileKeys.has(world.key)).map((value) => validateWorld(value)).filter(isPlayable);
  const ordered = [...main, ...playableFiles.filter((world) => !main.includes(world)), ...playableSaves];
  const entries: WorldEntry[] = [];
  for (const world of ordered) entries.push(authoredEntry(world, entries.length * STAGES_PER_WORLD));
  return new Campaign(entries, main.length);
}
