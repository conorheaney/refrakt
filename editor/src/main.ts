import './style.css';
import { createWorld, unfinishedLevels, validateWorld, withBackground, type AuthoredWorld } from '../../src/content/authoredWorlds';
import { GRID } from '../../src/gameplay/config';
import { BUILTIN_LEVELS, type LevelDef } from '../../src/content/levels';
import { isWeather, WEATHER, type WorldId } from '../../src/content/worlds';
import type { PlayAreas, PolygonArea } from '../../src/gameplay/arena/playAreas';
import { AreaEditor } from './AreaEditor';
import { SnakeEditor } from './SnakeEditor';
import { IcicleEditor } from './IcicleEditor';
import { ScarabEditor } from './ScarabEditor';
import type { HazardDef } from '../../src/gameplay/hazards/hazards';
import { EditorScene } from './Scene';
import { listWorldFiles, saveWorldFile, type WorldFile } from './WorldFiles';
import { FORGE_TEXTURE_URLS } from '../../src/themes/blocks/forge/forgeAssets';
import { AudioEngine } from '../../src/engine/audio/AudioEngine';
import { Music, type MusicMode } from '../../src/app/audio/Music';
import { isMusicTrack, MUSIC_TRACKS } from '../../src/content/musicTracks';
import { renderMusic, toWav } from '../../src/app/audio/renderMusic';

function el<T extends HTMLElement>(id: string): T { return document.getElementById(id) as T; }
const symbols = ['.', '1', '2', '3', 'S', 'X', 'P', 'G'];
const names = ['Eraser', 'Glass', 'Ceramic', 'Armored', 'Steel', 'Explosive', 'Prism', 'Phase'];
const bosses = BUILTIN_LEVELS.flatMap((level) => level.boss ? [level.boss] : []);
let data = createWorld(crypto.randomUUID());
let selected = 0;
let brush = '1';
let dirty = true;
let currentFile: Pick<WorldFile, 'filename' | 'revision'> | null = null;
let fileLibrary: WorldFile[] = [];
let saving = false;
let painting = false;
let strokeSymbol = '1';
let focusedRow = 0;
let undo: AuthoredWorld[] = [];
let redo: AuthoredWorld[] = [];
const cells: HTMLButtonElement[] = [];
// Created once the DOM pieces exist (end of this module); the functions above tolerate their absence.
// eslint-disable-next-line prefer-const
let scene: EditorScene;
let areas: AreaEditor | undefined;
let snakes: SnakeEditor | undefined;
let icicles: IcicleEditor | undefined;
let scarabs: ScarabEditor | undefined;
const paletteButtons: HTMLButtonElement[] = [];

function status(message: string, error = false): void {
  el('status').textContent = message;
  el('status').classList.toggle('error', error);
}
function report(error: unknown): void { status(error instanceof Error ? error.message : String(error), true); }
function markChanged(): void {
  dirty = true;
  el('dirty').textContent = 'Unsaved changes';
  el<HTMLButtonElement>('undo').disabled = undo.length === 0;
  el<HTMLButtonElement>('redo').disabled = redo.length === 0;
}
function snapshot(): void {
  undo.push(structuredClone(data));
  if (undo.length > 100) undo.shift();
  redo = [];
  markChanged();
}
function changeLevel(patch: Partial<LevelDef>): void {
  data.levels[selected] = { ...data.levels[selected], ...patch };
}
/** The level picker in the top bar: each level by number and name, marked if it still needs bricks. */
function refreshTabs(): void {
  const unfinished = unfinishedLevels(data);
  const select = el<HTMLSelectElement>('level-select');
  data.levels.forEach((level, i) => {
    const text = `${String(i + 1).padStart(2, '0')} · ${level.name}${unfinished.includes(i + 1) ? ' · needs bricks' : ''}`;
    const option = select.options[i] ?? select.appendChild(new Option('', String(i)));
    if (option.text !== text) option.text = text;
  });
  select.value = String(selected);
  el<HTMLButtonElement>('level-prev').disabled = selected === 0;
  el<HTMLButtonElement>('level-next').disabled = selected === data.levels.length - 1;
  el('level-number').textContent = String(selected + 1).padStart(2, '0');
  el('level-state').textContent = unfinished.includes(selected + 1) ? 'Needs a breakable brick or a boss before it can be played.' : 'Ready to play.';
}
function selectLevel(index: number): void {
  selected = Math.max(0, Math.min(data.levels.length - 1, index));
  render();
}
function renderGrid(): void {
  const level = data.levels[selected];
  let count = 0;
  cells.forEach((cell, i) => {
    const row = Math.floor(i / GRID.cols);
    const col = i % GRID.cols;
    const symbol = level.rows[row]?.[col] ?? '.';
    cell.dataset.symbol = symbol;
    const texture = data.world.blockStyle === 'forge' ? FORGE_TEXTURE_URLS[symbols.indexOf(symbol) - 1] : undefined;
    if (texture) cell.style.setProperty('--brick', `url("${texture}") center / cover`);
    else cell.style.removeProperty('--brick');
    cell.textContent = symbol === '.' ? '' : symbol;
    cell.setAttribute('aria-label', `Row ${row + 1}, column ${col + 1}: ${names[symbols.indexOf(symbol)]}`);
    if (symbol !== '.') count++;
  });
  el('count').textContent = `${count} bricks · ${GRID.cols} × ${GRID.rows}`;
  refreshTabs();
  // The real game scene behind the grid shows the bricks, scenery and arena exactly as the game will.
  scene?.sync(data, selected);
}
/** Places each brick cell's hit target over the cell as the game camera shows it. */
/** Top edge of the block area on the 1920-wide design stage (240 px at 1920 x 1080); scales with the stage. */
const GRID_TOP_DESIGN_PX = 240;

/**
 * Lays the brick cells out as a flat, axis-aligned grid (no camera perspective): the same overall width and
 * height the game camera gives the grid (its average projected width and its projected height), centred where
 * the camera centres it, with its top edge at GRID_TOP_DESIGN_PX on the design stage. Each painted cell shows
 * its brick in 2D (see style.css), so the editor's own 3D bricks are hidden (see EditorScene).
 */
function layoutGrid(): void {
  const grid = data.world.grid;
  const left = (grid.cols / 2) * grid.cellW;
  const top = grid.topY + grid.cellH / 2;
  const bottom = grid.topY - (grid.rows - 0.5) * grid.cellH;
  const tl = scene.project({ x: -left, y: top });
  const tr = scene.project({ x: left, y: top });
  const bl = scene.project({ x: -left, y: bottom });
  const br = scene.project({ x: left, y: bottom });
  const width = (tr.x - tl.x + (br.x - bl.x)) / 2;
  const height = (bl.y + br.y) / 2 - (tl.y + tr.y) / 2;
  const centreX = (tl.x + tr.x + bl.x + br.x) / 4;
  const stage = el('arena');
  const y0 = GRID_TOP_DESIGN_PX * (stage.clientWidth / 1920);
  const x0 = centreX - width / 2;
  const cw = width / grid.cols;
  const ch = height / grid.rows;
  cells.forEach((cell, i) => {
    const row = Math.floor(i / GRID.cols);
    const col = i % GRID.cols;
    cell.dataset.row = String(row % 3);
    Object.assign(cell.style, { left: `${x0 + col * cw}px`, top: `${y0 + row * ch}px`, width: `${cw}px`, height: `${ch}px` });
  });
  refreshLayers();
}
function refreshLayers(): void {
  areas?.refresh();
  snakes?.refresh();
  icicles?.refresh();
  scarabs?.refresh();
}
/** Replaces the world's hazards (snakes, icicles, scarab nests; undefined: none), with undo. */
function commitHazards(hazards: HazardDef[] | undefined): void {
  snapshot();
  if (hazards?.length) data.hazards = structuredClone(hazards);
  else delete data.hazards;
  render();
}
/** Shows hazards mid-edit in the scene without touching the world or its undo history. */
function previewHazards(hazards: HazardDef[] | undefined): void {
  scene?.sync(hazards ? { ...data, hazards } : data, selected);
}
/** Applies (or with undefined, resets to the default) a ball or paddle play area, with undo. */
function commitArea(mode: 'ball' | 'paddle', area: PolygonArea | undefined): void {
  snapshot();
  const next: PlayAreas = { ...data.playAreas };
  if (area) (next as Record<string, PolygonArea>)[mode] = structuredClone(area);
  else delete next[mode];
  if (next.ball || next.paddle) data.playAreas = next;
  else delete data.playAreas;
  render();
}
function render(): void {
  el<HTMLInputElement>('world-name').value = data.world.name;
  el<HTMLSelectElement>('background').value = data.world.id;
  el<HTMLSelectElement>('music').value = data.world.music ?? 'space';
  if (music) music.track = data.world.music ?? 'space';
  el<HTMLSelectElement>('weather').value = data.world.weather ?? '';
  el<HTMLInputElement>('level-name').value = data.levels[selected].name;
  el<HTMLInputElement>('hue').value = String(data.levels[selected].hue);
  const boss = data.levels[selected].boss;
  el<HTMLSelectElement>('boss').value = boss ? String(bosses.findIndex((item) => JSON.stringify(item) === JSON.stringify(boss))) : '';
  el('remove-background').hidden = !data.backgroundImage;
  el('background-info').textContent = data.backgroundImage ? 'Uploaded image · included in saves and exports.' : 'Upload PNG, JPEG or WebP. Images fill the scene; the selected arena keeps its existing physics.';
  el('world-title').textContent = data.world.name || 'Untitled';
  renderGrid();
  el<HTMLButtonElement>('undo').disabled = undo.length === 0;
  el<HTMLButtonElement>('redo').disabled = redo.length === 0;
  el('dirty').textContent = dirty ? 'Unsaved changes' : 'Saved in game folder';
  refreshLayers();
}
function paint(index: number, symbol: string): void {
  const row = Math.floor(index / GRID.cols);
  const col = index % GRID.cols;
  focusedRow = row;
  const rows = Array.from({ length: GRID.rows }, (_, i) => data.levels[selected].rows[i] ?? '.'.repeat(GRID.cols));
  if (rows[row][col] === symbol) return;
  rows[row] = rows[row].slice(0, col) + symbol + rows[row].slice(col + 1);
  changeLevel({ rows });
  markChanged();
  renderGrid();
}
for (let i = 0; i < GRID.cols * GRID.rows; i++) {
  const cell = document.createElement('button');
  cell.className = 'cell';
  cell.type = 'button';
  cell.dataset.index = String(i);
  cell.addEventListener('focus', () => { focusedRow = Math.floor(i / GRID.cols); });
  cell.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 && event.button !== 2) return;
    event.preventDefault();
    cell.focus();
    snapshot();
    painting = true;
    strokeSymbol = event.button === 2 ? '.' : brush;
    paint(i, strokeSymbol);
  });
  cell.addEventListener('click', (event) => {
    if (event.detail === 0) { snapshot(); paint(i, brush); }
  });
  cell.addEventListener('keydown', (event) => {
    const delta: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -GRID.cols, ArrowDown: GRID.cols };
    if (event.key in delta) {
      event.preventDefault();
      cells[Math.max(0, Math.min(cells.length - 1, i + delta[event.key]))].focus();
    } else if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault(); snapshot(); paint(i, '.');
    }
  });
  cells.push(cell);
  el('grid').append(cell);
}
el('grid').addEventListener('contextmenu', (event) => event.preventDefault());
window.addEventListener('pointermove', (event) => {
  if (!painting) return;
  const target = document.elementFromPoint(event.clientX, event.clientY);
  if (target instanceof HTMLElement && target.classList.contains('cell')) paint(Number(target.dataset.index), strokeSymbol);
});
for (const event of ['pointerup', 'pointercancel', 'blur']) window.addEventListener(event, () => { painting = false; });
symbols.forEach((symbol, i) => {
  const button = document.createElement('button');
  const swatch = document.createElement('span');
  swatch.className = 'swatch'; swatch.dataset.symbol = symbol; swatch.textContent = symbol === '.' ? '×' : symbol;
  button.append(swatch, document.createTextNode(names[i]));
  button.setAttribute('aria-pressed', String(symbol === brush));
  button.addEventListener('click', () => {
    brush = symbol;
    paletteButtons.forEach((item, j) => item.setAttribute('aria-pressed', String(symbols[j] === brush)));
  });
  paletteButtons.push(button); el('palette').append(button);
});
el('level-select').addEventListener('change', () => selectLevel(Number(el<HTMLSelectElement>('level-select').value)));
el('level-prev').addEventListener('click', () => selectLevel(selected - 1));
el('level-next').addEventListener('click', () => selectLevel(selected + 1));
bosses.forEach((boss, i) => el<HTMLSelectElement>('boss').add(new Option(boss.name, String(i))));
el<HTMLSelectElement>('boss').add(new Option('Imported custom boss (keep)', '-1'));
el('world-name').addEventListener('change', () => { snapshot(); data.world = { ...data.world, name: el<HTMLInputElement>('world-name').value }; render(); });
el('level-name').addEventListener('change', () => { snapshot(); changeLevel({ name: el<HTMLInputElement>('level-name').value }); render(); });
el('background').addEventListener('change', () => { snapshot(); data.world = withBackground(data.world, el<HTMLSelectElement>('background').value as WorldId); render(); });
for (const track of MUSIC_TRACKS) el<HTMLSelectElement>('music').add(new Option(track.label, track.id));
el('music').addEventListener('change', () => {
  const value = el<HTMLSelectElement>('music').value;
  if (!isMusicTrack(value)) return;
  snapshot(); data.world = { ...data.world, music: value }; render();
});
for (const item of WEATHER) el<HTMLSelectElement>('weather').add(new Option(item.label, item.id));
el('weather').addEventListener('change', () => {
  const value = el<HTMLSelectElement>('weather').value;
  snapshot();
  const { weather: _clear, ...world } = data.world;
  data.world = isWeather(value) ? { ...world, weather: value } : world;
  render();
});
// Music preview: audition the world's soundtrack live in any part (menu, level, boss) at any intensity, or
// save a recording of it.
let audio: AudioEngine | undefined;
let music: Music | undefined;
let listening = 0;
function previewMode(): MusicMode {
  const value = el<HTMLSelectElement>('music-mode').value;
  return value === 'menu' || value === 'boss' ? value : 'game';
}
function previewIntensity(): number {
  return Number(el<HTMLInputElement>('music-intensity').value);
}
function showIntensity(): void {
  el('music-intensity-value').textContent = `${Math.round(previewIntensity() * 100)}%`;
}
function stopListening(): void {
  if (!listening) return;
  cancelAnimationFrame(listening); listening = 0;
  if (audio && !audio.isMuted) audio.toggleMute();
  el('listen').setAttribute('aria-pressed', 'false');
  el('listen').textContent = '▶ Listen';
}
el('listen').addEventListener('click', () => {
  if (listening) { stopListening(); return; }
  audio ??= new AudioEngine();
  audio.unlock();
  if (audio.isMuted) audio.toggleMute();
  music ??= new Music(audio);
  music.track = data.world.music ?? 'space';
  music.mode = previewMode();
  music.setIntensity(previewIntensity());
  const tick = (): void => { music!.update(); listening = requestAnimationFrame(tick); };
  listening = requestAnimationFrame(tick);
  el('listen').setAttribute('aria-pressed', 'true');
  el('listen').textContent = '■ Stop';
});
el('music-mode').addEventListener('change', () => { if (music) music.mode = previewMode(); });
el('music-intensity').addEventListener('input', () => { showIntensity(); music?.setIntensity(previewIntensity()); });
showIntensity();
el('record').addEventListener('click', async () => {
  const button = el<HTMLButtonElement>('record');
  const track = data.world.music ?? 'space';
  const mode = previewMode();
  const label = MUSIC_TRACKS.find((item) => item.id === track)?.label.split(' — ')[0] ?? track;
  const part = mode === 'game' ? 'level' : mode;
  button.disabled = true;
  button.textContent = 'Recording…';
  try {
    // A minute of the chosen part, easing in from a calm start to the chosen intensity over the first 15
    // seconds so every layer can be heard arriving.
    const intensity = previewIntensity();
    const buffer = await renderMusic(track, [
      { mode, seconds: 15, from: Math.min(intensity, 0.2), to: intensity },
      { mode, seconds: 45, from: intensity, to: intensity },
    ]);
    const link = document.createElement('a');
    link.href = URL.createObjectURL(toWav(buffer));
    link.download = `${label} - ${part} - ${Math.round(intensity * 100)}%.wav`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 10000);
    status(`Saved a one-minute recording of ${label} (${part}, ${Math.round(intensity * 100)}%) to your downloads.`);
  } catch (err) {
    status(`Could not record the music: ${err instanceof Error ? err.message : String(err)}`, true);
  } finally {
    button.disabled = false;
    button.textContent = 'Save recording';
  }
});
el('background-file').addEventListener('change', async () => {
  const input = el<HTMLInputElement>('background-file');
  const file = input.files?.[0]; input.value = '';
  if (!file) return;
  const worldKey = data.key;
  try {
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 10 * 1024 * 1024) throw new Error('Choose a PNG, JPEG or WebP under 10 MB.');
    const bitmap = await createImageBitmap(file);
    try {
      if (data.key !== worldKey) return;
      if (bitmap.width > 8192 || bitmap.height > 8192 || bitmap.width * bitmap.height > 32000000) throw new Error('Choose an image no larger than 8192 pixels per side and 32 megapixels.');
      // Match the game's 16:9 stage. Flatten alpha and resize to keep saves portable and storage modest.
      const canvas = document.createElement('canvas'); canvas.width = 1600; canvas.height = 900;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Image processing is unavailable in this browser.');
      context.fillStyle = '#10151e'; context.fillRect(0, 0, 1600, 900);
      const scale = Math.max(1600 / bitmap.width, 900 / bitmap.height);
      const width = bitmap.width * scale; const height = bitmap.height * scale;
      context.drawImage(bitmap, (1600 - width) / 2, (900 - height) / 2, width, height);
      let image = canvas.toDataURL('image/jpeg', 0.85);
      if (image.length > 1200000) image = canvas.toDataURL('image/jpeg', 0.65);
      if (image.length > 1200000) throw new Error('This image is too detailed to store. Try a smaller or simpler image.');
      snapshot(); data.backgroundImage = image; render();
      status('Background uploaded and cropped to 16:9. Test the level to see it in the game. Save to keep it.');
    } finally { bitmap.close(); }
  } catch (error) { report(error); }
});
el('remove-background').addEventListener('click', () => { snapshot(); delete data.backgroundImage; render(); status('Restored the built-in scenery.'); });
el('hue').addEventListener('change', () => { snapshot(); changeLevel({ hue: Number(el<HTMLInputElement>('hue').value) }); render(); });
el('boss').addEventListener('change', () => {
  const value = el<HTMLSelectElement>('boss').value;
  if (value === '-1') return;
  snapshot(); changeLevel({ boss: value === '' ? undefined : structuredClone(bosses[Number(value)]) }); render();
});
el('fill').addEventListener('click', () => { snapshot(); for (let col = 0; col < GRID.cols; col++) paint(focusedRow * GRID.cols + col, brush); status(`Painted row ${focusedRow + 1}. Undo is available.`); });
el('clear').addEventListener('click', () => {
  snapshot(); changeLevel({ rows: Array.from({ length: GRID.rows }, () => '.'.repeat(GRID.cols)) }); render(); status('Layout cleared. Undo is available.');
});
function history(backwards: boolean): void {
  const source = backwards ? undo : redo;
  const destination = backwards ? redo : undo;
  const previous = source.pop();
  if (!previous) return;
  destination.push(structuredClone(data)); data = previous; markChanged(); render();
}
el('undo').addEventListener('click', () => history(true));
el('redo').addEventListener('click', () => history(false));
window.addEventListener('keydown', (event) => {
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement || el<HTMLDialogElement>('preview').open) return;
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); history(!event.shiftKey); }
});
async function refreshLibrary(): Promise<void> {
  const library = await listWorldFiles();
  // Most recently saved first.
  fileLibrary = [...library.worlds].sort((a, b) => b.modified - a.modified);
  const select = el<HTMLSelectElement>('library');
  select.replaceChildren(new Option('Choose a world from the game folder…', ''));
  fileLibrary.forEach((file) => select.add(new Option(`${file.world.world.name}${unfinishedLevels(file.world).length ? ' · draft' : ''}`, file.filename)));
  select.value = currentFile?.filename ?? '';
  if (library.warnings.length) status(`Some world files could not load: ${library.warnings.join(' ')}`, true);
}
function canReplace(): boolean { return !saving && (!dirty || confirm('Discard unsaved changes to this world?')); }
function replace(next: AuthoredWorld, saved: boolean, file: WorldFile | null = null): void {
  currentFile = file ? { filename: file.filename, revision: file.revision } : null;
  data = structuredClone(next); selected = 0; undo = []; redo = []; dirty = !saved; render();
  el<HTMLSelectElement>('library').value = currentFile?.filename ?? '';
}
el('new').addEventListener('click', () => { if (canReplace()) { replace(createWorld(crypto.randomUUID()), false); status('Created 10 blank levels. Choose a background and start painting.'); } });
el('library').addEventListener('change', () => {
  const filename = el<HTMLSelectElement>('library').value;
  if (!filename) return;
  if (!canReplace()) { el<HTMLSelectElement>('library').value = currentFile?.filename ?? ''; return; }
  const saved = fileLibrary.find((item) => item.filename === filename);
  if (saved) { replace(saved.world, true, saved); status('World loaded from the game folder.'); el<HTMLDialogElement>('world-dialog').close(); }
});
el('refresh-library').addEventListener('click', () => { void refreshLibrary().catch(report); });
el('save').addEventListener('click', async () => {
  if (saving) return;
  saving = true;
  el<HTMLButtonElement>('save').disabled = true;
  const snapshot = structuredClone(data);
  try {
    const saved = await saveWorldFile(snapshot, currentFile);
    currentFile = { filename: saved.filename, revision: saved.revision };
    dirty = JSON.stringify(data) !== JSON.stringify(snapshot);
    render();
    const missing = unfinishedLevels(snapshot);
    status(missing.length
      ? `Draft saved in the game folder. Timestamped backup created. Add bricks to levels ${missing.join(', ')} to make it playable.`
      : `World saved for play in the game folder. Timestamped backup created. Refresh the game to load it.${dirty ? ' You have newer unsaved changes.' : ''}`);
    await refreshLibrary();
  } catch (error) { report(error); }
  finally { saving = false; el<HTMLButtonElement>('save').disabled = false; }
});
el('export').addEventListener('click', () => {
  try {
    const value = validateWorld(data);
    const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = `${data.world.name.replace(/[^a-z0-9_-]/gi, '-') || 'world'}.json`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000); status('Exported world JSON. Keep this file as a backup or import it in another browser.');
  } catch (error) { report(error); }
});
el('import').addEventListener('click', () => el<HTMLInputElement>('import-file').click());
el('import-file').addEventListener('change', async () => {
  const input = el<HTMLInputElement>('import-file'); const file = input.files?.[0]; input.value = '';
  if (!file || !canReplace()) return;
  try {
    if (file.size > 2 * 1024 * 1024) throw new Error('World files must be smaller than 2 MB.');
    const imported = validateWorld(JSON.parse(await file.text()));
    if (saving) throw new Error('Wait for the current save to finish before importing.');
    // Import as a copy so a shared file cannot overwrite an existing world.
    imported.key = crypto.randomUUID(); delete imported.replaces;
    replace(imported, false); status('World imported as a new copy. Save to add it to the game folder.');
  } catch (error) { report(error); }
});
el('test').addEventListener('click', () => {
  stopListening();
  try {
    const value = validateWorld(data);
    if (unfinishedLevels(value).includes(selected + 1)) throw new Error('Add a breakable brick or a boss to this level before testing.');
    sessionStorage.setItem('refrakt.editor-preview', JSON.stringify(value));
    el<HTMLIFrameElement>('game-preview').src = `../?editorPreview=1&stage=${selected}`;
    el<HTMLDialogElement>('preview').showModal();
  } catch (error) { report(error); }
});
function closePreview(): void {
  el<HTMLIFrameElement>('game-preview').src = 'about:blank';
  sessionStorage.removeItem('refrakt.editor-preview');
}
el('close-preview').addEventListener('click', () => el<HTMLDialogElement>('preview').close());
el('preview').addEventListener('close', closePreview);
window.addEventListener('beforeunload', (event) => { if (dirty) { event.preventDefault(); event.returnValue = ''; } });

// ------------------------------------------------------------------ the world dialog and view toggles
el('world-button').addEventListener('click', () => el<HTMLDialogElement>('world-dialog').showModal());
el('guides-toggle').addEventListener('click', () => {
  const off = document.body.classList.toggle('no-guides');
  el('guides-toggle').setAttribute('aria-pressed', String(!off));
});
function setHudHidden(hidden: boolean): void {
  document.body.classList.toggle('hud-hidden', hidden);
  el('show-hud').hidden = !hidden;
  el('hud-toggle').setAttribute('aria-pressed', String(hidden));
}
el('hud-toggle').addEventListener('click', () => setHudHidden(true));
el('show-hud').addEventListener('click', () => setHudHidden(false));
window.addEventListener('keydown', (event) => {
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement || el<HTMLDialogElement>('preview').open) return;
  if (event.key.toLowerCase() === 'h' && !event.ctrlKey && !event.metaKey && !event.altKey) setHudHidden(!document.body.classList.contains('hud-hidden'));
});

// ------------------------------------------------------------------ the game scene and play-area tools
scene = new EditorScene(el('arena'), el<HTMLCanvasElement>('scene'), data);
scene.onLayout = layoutGrid;
scene.onError = (message) => status(message, true);
areas = new AreaEditor(scene, () => data, commitArea, status);
snakes = new SnakeEditor(scene, () => data, commitHazards, previewHazards, status);
icicles = new IcicleEditor(scene, () => data, commitHazards, previewHazards, status);
scarabs = new ScarabEditor(scene, () => data, commitHazards, previewHazards, status);
areas.onModeChange = refreshLayers;
render();
// Opens on the most recently saved world in the game folder (a new one if there are none).
void refreshLibrary().then(() => {
  const latest = fileLibrary[0];
  if (latest && !currentFile && undo.length === 0) { replace(latest.world, true, latest); status(`Opened ${latest.world.world.name}, the most recently saved world. Use the World button to open another.`); }
}).catch(report);
scene.init().then(() => {
  scene.sync(data, selected);
  if (!el('status').classList.contains('error')) status('Paint bricks on the scene, or switch to Ball area / Paddle area to shape where the ball and paddle can go.');
}).catch((error: unknown) => report(new Error(`The game scene could not start: ${error instanceof Error ? error.message : String(error)}`)));
