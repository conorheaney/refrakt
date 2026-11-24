import { authoredBackgrounds, installWorlds, playableWorld, unfinishedLevels, validateWorld, type AuthoredWorld, type LibraryResult } from './authoredWorlds';
import { replaceBuiltinLevels } from './levels';
import { replaceBuiltinWorld } from './worlds';
import { worldPlayAreas } from '../gameplay/arena/playAreas';
import { worldHazards } from '../gameplay/hazards/hazards';

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
        const missing = unfinishedLevels(world);
        if (missing.length) throw new Error(`Unfinished levels: ${missing.join(', ')}.`);
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

/** Apply validated project replacements before appending additional campaigns. */
export function installFileWorlds(worlds: readonly AuthoredWorld[]): void {
  for (const value of worlds) {
    const data = validateWorld(value);
    if (unfinishedLevels(data).length) continue;
    if (!data.replaces) { installWorlds([data]); continue; }
    const index = data.replaces === 'space' ? 0 : 1;
    replaceBuiltinLevels(index, data.levels);
    replaceBuiltinWorld(index, playableWorld(data));
    authoredBackgrounds.delete(index);
    worldPlayAreas.delete(index);
    worldHazards.delete(index);
    if (data.backgroundImage) authoredBackgrounds.set(index, data.backgroundImage);
    if (data.playAreas) worldPlayAreas.set(index, data.playAreas);
    if (data.hazards) worldHazards.set(index, data.hazards);
  }
}

/** Project files take precedence over an older browser save of the same world. */
export function mergeWorlds(files: readonly AuthoredWorld[], saved: readonly AuthoredWorld[]): AuthoredWorld[] {
  const keys = new Set(files.map((world) => world.key));
  return [...files, ...saved.filter((world) => !keys.has(world.key))];
}
