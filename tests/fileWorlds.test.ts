import { expect, it } from 'vitest';
import { createWorld } from '../src/content/authoredWorlds';
import { buildCampaign, loadFileWorlds } from '../src/content/fileWorlds';

const base = new URL('https://example.test/refrakt/worlds/');
function world(key: string) {
  const data = createWorld(key);
  data.levels = data.levels.map((level) => ({ ...level, rows: ['......1......'] }));
  return data;
}
function requestFor(entries: Record<string, unknown>): typeof fetch {
  return async (input) => {
    const url = String(input);
    expect(url.startsWith(base.href)).toBe(true);
    const filename = url.slice(base.href.length);
    return new Response(JSON.stringify(entries[filename] ?? null), { status: filename in entries ? 200 : 404 });
  };
}

it('loads complete project worlds in manifest order under a subpath without storage', async () => {
  const a = world('a'), b = world('b');
  const result = await loadFileWorlds(base, requestFor({ 'index.json': ['b.json', 'a.json'], 'a.json': a, 'b.json': b }));
  expect(result).toEqual({ worlds: [b, a], warnings: [] });
});

it('keeps good worlds when another file is missing, malformed, unfinished or duplicated', async () => {
  const good = world('good');
  const result = await loadFileWorlds(base, requestFor({
    'index.json': ['missing.json', 'bad.json', 'draft.json', 'good.json', 'duplicate.json'],
    'bad.json': {}, 'draft.json': createWorld('draft'), 'good.json': good, 'duplicate.json': good,
  }));
  expect(result.worlds).toEqual([good]);
  expect(result.warnings).toHaveLength(4);
});

it('handles a missing manifest or network failure without stopping built-in gameplay', async () => {
  expect((await loadFileWorlds(base, requestFor({}))).warnings).toHaveLength(1);
  const result = await loadFileWorlds(base, async () => { throw new Error('offline'); });
  expect(result.worlds).toEqual([]);
  expect(result.warnings[0]).toContain('offline');
});

it('rejects malformed manifests and paths outside the world folder', async () => {
  for (const manifest of [{ files: [] }, ['../private.json'], ['https://other.test/world.json'], ['index.json']]) {
    const result = await loadFileWorlds(base, requestFor({ 'index.json': manifest }));
    expect(result.worlds).toEqual([]);
    expect(result.warnings).toHaveLength(1);
  }
});

it('prefers project data while retaining unrelated browser worlds without mutating saves', () => {
  const project = world('tomb'), old = world('tomb'), other = world('other');
  old.world = { ...old.world, name: 'Older Tomb' };
  const saved = [old, other];
  expect(buildCampaign([project], saved).worlds.map((entry) => entry.def)).toEqual([project.world, other.world]);
  expect(saved).toEqual([old, other]);
  expect(old.world.name).toBe('Older Tomb');
});
