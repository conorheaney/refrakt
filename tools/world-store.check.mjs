import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createServer as httpServer } from 'node:http';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createServer, preview } from 'vite';
import { createWorldStore, worldFileMiddleware } from './world-store.mjs';

let validator, validateWorld, isPlayable, fixture;
const roots = [];
before(async () => {
  validator = await createServer({ configFile: false, server: { middlewareMode: true, ws: false }, appType: 'custom' });
  ({ validateWorld, isPlayable } = await validator.ssrLoadModule('/src/content/authoredWorlds.ts'));
  fixture = JSON.parse(await readFile('public/worlds/Frozen-Sanctuary.json', 'utf8'));
});
after(async () => {
  await validator?.close();
  const parent = path.resolve('.tmp') + path.sep;
  for (const root of roots) {
    assert.ok(root.startsWith(parent) && path.basename(root).startsWith('world-store-test-'));
    await rm(root, { recursive: true, force: true });
  }
});
async function setup() {
  await mkdir('.tmp', { recursive: true });
  const root = await mkdtemp(path.resolve('.tmp/world-store-test-'));
  roots.push(root);
  const store = createWorldStore(root, validateWorld, isPlayable);
  const world = structuredClone(fixture);
  return { root, store, world };
}
const newRequest = (world) => ({ filename: null, revision: null, world });

test('first save and overwrites always produce distinct timestamped backups outside game files', async () => {
  const { root, store, world } = await setup();
  const first = await store.save(newRequest(world));
  assert.equal(first.complete, true);
  assert.match(first.backup, /^world-backups\/.+--\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-.+\.json$/);
  assert.deepEqual(JSON.parse(await readFile(path.join(root, first.backup))), world);
  const oldText = await readFile(path.join(root, 'public/worlds', first.filename), 'utf8');
  world.levels[0].name = 'FROST REVISION';
  const second = await store.save({ ...first, world });
  assert.notEqual(first.backup, second.backup);
  assert.equal(await readFile(path.join(root, second.backup), 'utf8'), oldText);
  assert.deepEqual(JSON.parse(await store.readGameFile('index.json')), [first.filename]);
  const library = await store.list();
  assert.equal(library.worlds.length, 1);
  assert.equal(library.worlds[0].world.levels[0].name, 'FROST REVISION');
  assert.equal((await readdir(path.join(root, 'world-backups'))).length, 4);
  await assert.rejects(store.readGameFile('../world-backups/' + second.backup), /Invalid world filename/);
});

test('drafts remain loadable by the editor but disappear from the game index until completed', async () => {
  const { store, world } = await setup();
  const rows = world.levels[0].rows;
  world.levels[0].rows = [];
  const draft = await store.save(newRequest(world));
  assert.equal(draft.complete, false);
  assert.deepEqual(JSON.parse(await store.readGameFile('index.json')), []);
  assert.equal((await store.list()).worlds.length, 1);
  world.levels[0].rows = rows;
  const ready = await store.save({ ...draft, world });
  assert.deepEqual(JSON.parse(await store.readGameFile('index.json')), [draft.filename]);
  world.levels[0].rows = [];
  await store.save({ ...ready, world });
  assert.deepEqual(JSON.parse(await store.readGameFile('index.json')), []);
});

test('rejects stale simultaneous saves, external edits, malformed data and unsafe paths without overwriting', async () => {
  const { root, store, world } = await setup();
  const first = await store.save(newRequest(world));
  const current = (await store.list()).worlds[0];
  const changed = structuredClone(world);
  changed.levels[0].name = 'NEW REVISION';
  const simultaneous = await Promise.allSettled([
    store.save({ ...current, world: changed }),
    store.save({ ...current, world }),
  ]);
  assert.equal(simultaneous.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(simultaneous.filter((r) => r.status === 'rejected').length, 1);
  const target = path.join(root, 'public/worlds', first.filename);
  const before = await readFile(target, 'utf8');
  await writeFile(target, before + '\n');
  await assert.rejects(store.save({ ...current, world }), /changed on disk/);
  for (const filename of ['../escape.json', 'nested/world.json', 'index.json', 'C:\\escape.json']) {
    await assert.rejects(store.save({ filename, revision: current.revision, world }), /Invalid world filename/);
  }
  await assert.rejects(store.save(newRequest({ ...world, levels: [] })), /exactly 10/);
  assert.equal(await readFile(target, 'utf8'), before + '\n');
});

test('backup creation failure stops the save before the world or manifest changes', async () => {
  const { root, store, world } = await setup();
  await mkdir(path.join(root, 'public/worlds'), { recursive: true });
  await writeFile(path.join(root, 'public/worlds/index.json'), '[]\n');
  await writeFile(path.join(root, 'world-backups'), 'blocked backup folder');
  await assert.rejects(store.save(newRequest(world)));
  assert.deepEqual(await readdir(path.join(root, 'public/worlds')), ['index.json']);
  assert.equal(await readFile(path.join(root, 'public/worlds/index.json'), 'utf8'), '[]\n');
});

test('HTTP API persists real world data and refuses cross-origin saves; backups cannot be fetched', async () => {
  const { store, world } = await setup();
  const middleware = worldFileMiddleware(store);
  const server = httpServer((req, res) => {
    void middleware(req, res, () => {
      res.writeHead(404);
      res.end();
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    const options = {
      method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/json' },
      body: JSON.stringify(newRequest(world)),
    };
    const denied = await fetch(`${origin}/__world-files`, {
      ...options,
      headers: { ...options.headers, Origin: 'https://other.example' },
    });
    assert.equal(denied.status, 403);
    const response = await fetch(`${origin}/__world-files`, options);
    assert.equal(response.status, 200);
    const saved = await response.json();
    assert.equal((await (await fetch(`${origin}/__world-files`)).json()).worlds.length, 1);
    assert.deepEqual(await (await fetch(`${origin}/worlds/${saved.filename}`)).json(), world);
    assert.equal((await fetch(`${origin}/${saved.backup}`)).status, 404);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('Vite dev and preview expose the project-world library without modifying it', async () => {
  const dev = await createServer({ server: { host: '127.0.0.1', port: 0 } });
  await dev.listen();
  try {
    const port = dev.httpServer.address().port;
    const result = await (await fetch(`http://127.0.0.1:${port}/__world-files`)).json();
    assert.ok(result.worlds.some((entry) => entry.world.world.name === 'Frozen Sanctuary'));
  } finally {
    await dev.close();
  }
  const built = await preview({ preview: { host: '127.0.0.1', port: 0 } });
  try {
    const port = built.httpServer.address().port;
    const response = await fetch(`http://127.0.0.1:${port}/__world-files`);
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.ok(result.worlds.some((entry) => entry.world.world.name === 'The Verdant Hollow'));
  } finally {
    await built.close();
  }
});
