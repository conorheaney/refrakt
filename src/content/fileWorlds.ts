import { authoredEntry, installWorlds, unfinishedLevels, validateWorld, type AuthoredWorld, type LibraryResult } from './authoredWorlds';
import { STAGES_PER_WORLD } from './worlds';
import type { Campaign } from './campaign';

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

/**
 * `campaign` with the project's world files applied in order: a file that `replaces` Space or Forest takes
 * over that built-in slot (keeping its campaign position); any other is appended.
 */
export function installFileWorlds(campaign: Campaign, worlds: readonly AuthoredWorld[]): Campaign {
  for (const value of worlds) {
    const data = validateWorld(value);
    if (unfinishedLevels(data).length) continue;
    if (!data.replaces) { campaign = installWorlds(campaign, [data]); continue; }
    const index = data.replaces === 'space' ? 0 : 1;
    campaign = campaign.withWorldAt(index, authoredEntry(data, index * STAGES_PER_WORLD));
  }
  return campaign;
}

/** Project files take precedence over an older browser save of the same world. */
export function mergeWorlds(files: readonly AuthoredWorld[], saved: readonly AuthoredWorld[]): AuthoredWorld[] {
  const keys = new Set(files.map((world) => world.key));
  return [...files, ...saved.filter((world) => !keys.has(world.key))];
}
