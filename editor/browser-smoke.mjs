// Optional Windows browser smoke test: npm run build, then node editor/browser-smoke.mjs.
// Uses installed Chrome/Edge and an isolated profile; no additional npm dependencies.
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createServer as createViteServer } from 'vite';
import { createWorldStore, worldFileMiddleware } from '../tools/world-store.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const artifacts = path.join(root, '.tmp', `editor-smoke-${Date.now()}`);
const profile = path.join(artifacts, 'profile');
await mkdir(profile, { recursive: true });
const browserPath = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].find(existsSync);
if (!browserPath) throw new Error('Install Chrome or Edge to run this optional smoke test.');
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.webp': 'image/webp' };
const validator = await createViteServer({
  root,
  configFile: false,
  server: { middlewareMode: true, ws: false },
  appType: 'custom',
});
const { validateWorld, unfinishedLevels } = await validator.ssrLoadModule('/src/content/authoredWorlds.ts');
await validator.close();
const store = createWorldStore(artifacts, validateWorld, (world) => unfinishedLevels(world).length === 0);
const diskApi = worldFileMiddleware(store);
// A separate world folder prevents smoke saves from touching the real campaigns.
await mkdir(path.join(artifacts, 'public/worlds'), { recursive: true });
await writeFile(path.join(artifacts, 'public/worlds/index.json'), '[]\n');
const serveStatic = async (req, res) => {
  try {
    let url = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (url.endsWith('/')) url += 'index.html';
    const target = path.resolve(root, 'dist', '.' + url);
    if (!target.startsWith(path.join(root, 'dist') + path.sep)) throw new Error('Invalid path');
    res.setHeader('Content-Type', mime[path.extname(target)] ?? 'application/octet-stream');
    res.end(await readFile(target));
  } catch {
    res.writeHead(404);
    res.end();
  }
};
const server = createServer((req, res) => {
  void diskApi(req, res, () => {
    void serveStatic(req, res);
  });
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = spawn(
  browserPath,
  [
    '--headless=new',
    '--remote-debugging-port=0',
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--window-size=1440,1100',
    'about:blank',
  ],
  { windowsHide: true, stdio: 'ignore' },
);
let ws;
const pending = new Map();
const errors = [];
let id = 0;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(fn, label, timeout = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      if (await fn()) return;
    } catch {
      /* wait for navigation/resource */
    }
    await sleep(200);
  }
  throw new Error(`Timed out: ${label}`);
}
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const key = ++id;
    const timeout = setTimeout(() => {
      pending.delete(key);
      reject(new Error(`CDP timeout: ${method}`));
    }, 30000);
    pending.set(key, {
      resolve: (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      reject,
    });
    ws.send(JSON.stringify({ id: key, method, params }));
  });
}
async function evaluate(expression) {
  const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails)
    throw new Error(result.exceptionDetails.text + ': ' + result.exceptionDetails.exception?.description);
  return result.result.value;
}
async function upload(selector, file) {
  const { root: doc } = await send('DOM.getDocument');
  const { nodeId } = await send('DOM.querySelector', { nodeId: doc.nodeId, selector });
  await send('DOM.setFileInputFiles', { nodeId, files: [file] });
}
try {
  await until(() => existsSync(path.join(profile, 'DevToolsActivePort')), 'browser startup');
  const port = (await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0];
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  ws = new WebSocket(targets.find((target) => target.type === 'page').webSocketDebuggerUrl);
  await new Promise((resolve) => ws.addEventListener('open', resolve, { once: true }));
  ws.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data);
    if (message.id) {
      const entry = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) entry?.reject(new Error(message.error.message));
      else entry?.resolve(message.result);
    } else if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails);
    else if (message.method === 'Page.javascriptDialogOpening')
      void send('Page.handleJavaScriptDialog', { accept: true });
  });
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Page.navigate', { url: `${origin}/editor/` });
  await until(() => evaluate('document.querySelectorAll(".cell").length === 156'), 'editor loaded');
  assert.equal(await evaluate('document.querySelectorAll("#level-select option").length'), 10);
  await evaluate(`document.querySelector('#world-name').value='Browser smoke world'; document.querySelector('#world-name').dispatchEvent(new Event('change'));
    document.querySelector('#save').click();`);
  await until(
    () => evaluate('document.querySelector("#status").textContent.includes("Draft saved")'),
    'draft disk save',
  );
  await evaluate(`for(let i=0;i<10;i++){const s=document.querySelector('#level-select');s.value=String(i);s.dispatchEvent(new Event('change'));document.querySelector('#fill').click();}
    document.querySelector('#clear').click(); document.querySelector('#undo').click();`);
  assert.equal(
    await evaluate(`Array.from(document.querySelectorAll('.cell')).filter(cell => cell.dataset.symbol === '1').length`),
    13,
  );
  const imageData = await evaluate(
    `(() => {const c=document.createElement('canvas');c.width=1600;c.height=900;const x=c.getContext('2d');x.fillStyle='#246e7b';x.fillRect(0,0,1600,900);x.fillStyle='#9ee6df';x.beginPath();x.arc(1200,240,160,0,Math.PI*2);x.fill();return c.toDataURL('image/png').split(',')[1];})()`,
  );
  const imagePath = path.join(artifacts, 'background.png');
  await writeFile(imagePath, Buffer.from(imageData, 'base64'));
  await upload('#background-file', imagePath);
  await until(() => evaluate('!document.querySelector("#remove-background").hidden'), 'image upload');
  await evaluate('document.querySelector("#save").click()');
  await until(
    () => evaluate('document.querySelector("#status").textContent.includes("World saved for play")'),
    'complete disk save',
  );
  const saved = (await store.list()).worlds[0].world;
  assert.ok(saved.backgroundImage.startsWith('data:image/jpeg;base64,'));
  assert.equal(await evaluate('localStorage.getItem("refrakt.authored-worlds")'), null);
  const backup = path.join(artifacts, 'world.json');
  await writeFile(backup, JSON.stringify(saved));
  await send('Page.reload');
  await until(() => evaluate('document.querySelectorAll("#library option").length === 2'), 'saved library reload');
  await evaluate('const s=document.querySelector("#library");s.selectedIndex=1;s.dispatchEvent(new Event("change"))');
  assert.equal(await evaluate('document.querySelector("#world-name").value'), 'Browser smoke world');
  // Scarabs (shared path tool): draw a nest (entry point then one path point, finished by clicking the last point
  // again), deselect and reselect it, Shift-click to add a point to its path, save.
  await evaluate(
    'document.querySelector("#mode-scarabs").click(); document.querySelector("#scarab-add-nest").click();',
  );
  const box = await evaluate(
    '(() => { const r = document.querySelector("#areas").getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; })()',
  );
  const at = (fx, fy) => ({ x: box[0] + box[2] * fx, y: box[1] + box[3] * fy });
  const click = async (p, modifiers = 0) => {
    await send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x: p.x,
      y: p.y,
      button: 'left',
      buttons: 1,
      clickCount: 1,
      modifiers,
    });
    await send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x: p.x,
      y: p.y,
      button: 'left',
      buttons: 0,
      clickCount: 1,
      modifiers,
    });
  };
  const count = (selector) => evaluate(`document.querySelectorAll(${JSON.stringify(selector)}).length`);
  await click(at(0.3, 0.75));
  await click(at(0.36, 0.8));
  await click(at(0.36, 0.8));
  await until(
    async () => (await count('#scarab-layer .path.open.selected .path-handle')) === 2,
    'scarab nest drawn (entry and one path point), selected',
  );
  await click(at(0.6, 0.3));
  await until(async () => (await count('#scarab-layer .path.selected')) === 0, 'click on empty space deselects');
  const entry = await evaluate(
    '(() => { const r = document.querySelector("#scarab-layer .path-handle.anchor").getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()',
  );
  await click(entry);
  await until(async () => (await count('#scarab-layer .path.open.selected')) === 1, 'click on a nest selects it');
  await click(at(0.42, 0.85), 8);
  await until(
    async () => (await count('#scarab-layer .path.open.selected .path-handle')) === 3,
    'shift-click adds a point to the end of the path',
  );
  await evaluate('document.querySelector("#save").click()');
  await until(async () => {
    const world = (await store.list()).worlds[0].world;
    const nest = world.hazards?.find((h) => h.kind === 'scarabs');
    return nest?.path?.length === 2;
  }, 'scarab nest and its path saved');
  const screenshot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  await writeFile(path.join(artifacts, 'editor.png'), Buffer.from(screenshot.data, 'base64'));
  await evaluate('document.querySelector("#test").click()');
  await until(
    () =>
      evaluate(
        `document.querySelector('#game-preview').contentDocument?.querySelector('[data-screen="loadout"]')?.classList.contains('visible')`,
      ),
    'real game playtest',
    60000,
  );
  assert.equal(
    await evaluate(
      `document.querySelector('#game-preview').contentDocument.querySelector('[data-ref="loadoutLevel"]').textContent`,
    ),
    'Browser smoke world Level 1',
  );
  await evaluate(
    `const d=document.querySelector('#game-preview').contentDocument;for(let i=0;i<3;i++)d.querySelectorAll('[data-ref="loadoutGrid"] button')[i].click();d.querySelector('[data-ref="loadoutStart"]').click();`,
  );
  await sleep(1500);
  const play = await send('Page.captureScreenshot', { format: 'png' });
  await writeFile(path.join(artifacts, 'playtest.png'), Buffer.from(play.data, 'base64'));
  await evaluate('document.querySelector("#close-preview").click()');
  await until(() => evaluate('document.querySelector("#game-preview").src === "about:blank"'), 'playtest cleanup');
  await upload('#import-file', backup);
  await until(
    () => evaluate('document.querySelector("#status").textContent.includes("imported as a new copy")'),
    'import',
  );
  await evaluate('document.querySelector("#save").click()');
  await until(async () => (await store.list()).worlds.length === 2, 'imported copy saved to disk');
  assert.equal(JSON.parse(await store.readGameFile('index.json')).length, 2);
  await send('Page.navigate', { url: `${origin}/` });
  // The game plays world files only: the two saved here (the smoke folder has no others).
  await until(
    () => evaluate('document.querySelectorAll("[data-world-index]").length === 2'),
    'main screen worlds',
    60000,
  );
  await evaluate(
    `document.querySelector('[data-world-index="0"]').click();document.querySelector('[data-action="play"]').click();`,
  );
  await until(
    () => evaluate(`document.querySelector('[data-screen="loadout"]').classList.contains('visible')`),
    'saved-world run',
  );
  assert.equal(
    await evaluate(`document.querySelector('[data-ref="loadoutLevel"]').textContent`),
    'Browser smoke world Level 1',
  );
  assert.equal(errors.length, 0, JSON.stringify(errors));
  console.log(
    `PASS: painting, undo, upload, draft/ready save, reload, scarab nest and path editing, export-format import, original-game playtest, main-menu selection. Screenshots: ${artifacts}`,
  );
} finally {
  if (ws?.readyState === WebSocket.OPEN) {
    try {
      await send('Browser.close');
    } catch {
      /* browser may close before replying */
    }
    ws.close();
  }
  if (browser.exitCode === null) browser.kill();
  server.closeAllConnections();
  server.close();
}
