import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

const filenamePattern = /^(?!index\.json$)[\w-]+\.json$/;
const hash = (text) => createHash('sha256').update(text).digest('hex');
function fail(message, status = 400) {
  throw Object.assign(new Error(message), { status });
}

/** One serialized store per server. Backups deliberately live outside public/. */
export function createWorldStore(root, validate, isComplete) {
  const directory = path.join(root, 'public', 'worlds');
  const backups = path.join(root, 'world-backups');
  let queue = Promise.resolve();
  function serial(action) {
    const result = queue.then(action);
    queue = result.catch(() => {});
    return result;
  }
  async function noLink(target) {
    try {
      if ((await lstat(target)).isSymbolicLink()) fail('World paths cannot be symbolic links.');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  async function prepare(forSave = false) {
    await noLink(path.join(root, 'public'));
    await noLink(directory);
    await mkdir(directory, { recursive: true });
    if (forSave) {
      await noLink(backups);
      await mkdir(backups, { recursive: true });
    }
  }
  function worldPath(filename) {
    if (typeof filename !== 'string' || !filenamePattern.test(filename)) fail('Invalid world filename.');
    return path.join(directory, filename);
  }
  async function optionalRead(target) {
    await noLink(target);
    try {
      return await readFile(target, 'utf8');
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
  }
  async function atomicWrite(target, text) {
    const temp = `${target}.${randomUUID()}.tmp`;
    try {
      await writeFile(temp, text, { flag: 'wx' });
      await noLink(target);
      await rename(temp, target);
    } finally {
      await unlink(temp).catch((error) => {
        if (error.code !== 'ENOENT') throw error;
      });
    }
  }
  async function manifest() {
    const raw = await optionalRead(path.join(directory, 'index.json'));
    const files = raw === null ? [] : JSON.parse(raw);
    if (
      !Array.isArray(files) ||
      !files.every((f) => typeof f === 'string' && filenamePattern.test(f)) ||
      new Set(files).size !== files.length
    )
      fail('World index is damaged; repair it before saving.');
    return { raw, files };
  }
  async function entries() {
    const result = [];
    const warnings = [];
    for (const filename of (await readdir(directory)).filter((f) => filenamePattern.test(f)).sort()) {
      try {
        const raw = await optionalRead(worldPath(filename));
        // modified: when it was last saved (ms), so the editor can open the most recent world.
        if (raw !== null)
          result.push({
            filename,
            revision: hash(raw),
            modified: (await lstat(worldPath(filename))).mtimeMs,
            world: validate(JSON.parse(raw)),
          });
      } catch (error) {
        warnings.push(`${filename}: ${error.message}`);
      }
    }
    return { worlds: result, warnings };
  }
  return {
    list: () =>
      serial(async () => {
        await prepare();
        return entries();
      }),
    save: (request) =>
      serial(async () => {
        await prepare(true);
        if (!request || typeof request !== 'object') fail('Invalid save request.');
        const world = validate(request.world);
        const isNew = request.filename === null;
        const filename = isNew
          ? `${world.world.name.replace(/[^a-z0-9_-]+/gi, '-').replace(/^-|-$/g, '') || 'World'}-${world.key}.json`
          : request.filename;
        const target = worldPath(filename);
        const old = await optionalRead(target);
        if (isNew ? old !== null || request.revision !== null : old === null || request.revision !== hash(old)) {
          fail('This world changed on disk. Export your edits, then reload the world before saving.', 409);
        }
        if (old !== null && validate(JSON.parse(old)).key !== world.key)
          fail('World identity changed. Import it as a new copy instead.');
        const library = await entries();
        if (library.warnings.length) fail('Some world files are damaged; repair them before saving.');
        for (const entry of library.worlds) {
          if (entry.filename === filename) continue;
          if (entry.world.key === world.key) fail('Another file already uses this world key.', 409);
          if (world.replaces && entry.world.replaces === world.replaces)
            fail('Another world already replaces this campaign.', 409);
        }
        const index = await manifest();
        const complete = isComplete(world);
        const files = index.files.filter((f) => f !== filename);
        if (complete) {
          const position = index.files.indexOf(filename);
          if (position < 0) files.push(filename);
          else files.splice(position, 0, filename);
        }
        const text = JSON.stringify(world, null, 2) + '\n';
        const stamp = new Date().toISOString().replace(/[:.]/g, '-') + '-' + randomUUID();
        const backup = `${filename.slice(0, -5)}--${stamp}.json`;
        // No main-file write happens unless both backups succeeded. First saves back up the incoming world.
        await writeFile(path.join(backups, backup), old ?? text, { flag: 'wx' });
        await writeFile(path.join(backups, `${backup.slice(0, -5)}--index.json`), index.raw ?? '[]\n', { flag: 'wx' });
        await atomicWrite(target, text);
        try {
          await atomicWrite(path.join(directory, 'index.json'), JSON.stringify(files, null, 2) + '\n');
        } catch (error) {
          if (old === null) await unlink(target);
          else await atomicWrite(target, old);
          throw error;
        }
        return { filename, revision: hash(text), backup: `world-backups/${backup}`, complete };
      }),
    readGameFile: (filename) =>
      serial(async () => {
        await prepare();
        const target = filename === 'index.json' ? path.join(directory, filename) : worldPath(filename);
        const raw = await optionalRead(target);
        if (raw === null) fail('World file not found.', 404);
        return raw;
      }),
  };
}

/** Local, same-origin JSON API. No arbitrary filesystem paths are accepted. */
export function worldFileMiddleware(store) {
  return async (req, res, next) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    if (pathname !== '/__world-files' && !pathname.startsWith('/worlds/')) return next();
    const send = (status, value) => {
      res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(typeof value === 'string' ? value : JSON.stringify(value));
    };
    try {
      // Static game reads remain available; only the editor's disk API is local-only.
      if (pathname.startsWith('/worlds/')) {
        if (req.method !== 'GET') return send(405, { error: 'Method not allowed.' });
        return send(200, await store.readGameFile(decodeURIComponent(pathname.slice('/worlds/'.length))));
      }
      const host = new URL(`http://${req.headers.host}`).hostname;
      const remote = req.socket.remoteAddress;
      if (
        !['localhost', '127.0.0.1', '[::1]'].includes(host) ||
        !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remote)
      )
        fail('World editing is only available on this computer.', 403);
      if (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host)
        fail('Cross-origin access denied.', 403);
      if (req.method === 'GET') return send(200, await store.list());
      if (req.method !== 'POST') return send(405, { error: 'Method not allowed.' });
      if (!req.headers.origin || !req.headers['content-type']?.startsWith('application/json'))
        fail('Same-origin JSON requests are required.', 403);
      const chunks = [];
      let bytes = 0;
      for await (const chunk of req) {
        bytes += chunk.length;
        if (bytes > 2 * 1024 * 1024) fail('World files must be smaller than 2 MB.', 413);
        chunks.push(chunk);
      }
      return send(200, await store.save(JSON.parse(Buffer.concat(chunks).toString('utf8'))));
    } catch (error) {
      send(error.status ?? 400, { error: error.message });
    }
  };
}
