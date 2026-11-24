import { LOADOUT_SIZE, PLAYER, POWERUP_DESCRIPTIONS, POWERUPS } from '../gameplay/config';
import { levelNumber, worldOf, WORLDS } from '../content/worlds';
import type { Quality, Settings } from './Storage';
import { POWERUP_KIND_COUNT, PowerUpKind } from '../gameplay/types';
import type { World } from '../gameplay/World';
import { iconSvg } from '../gameplay/powerups/icons';

export type ScreenId = 'menu' | 'howto' | 'settings' | 'pause' | 'gameover' | 'victory' | 'loadout';
export type UiAction = 'play' | 'resume' | 'restart' | 'menu' | 'pause';

export interface UiCallbacks {
  onAction(action: UiAction): void;
  onSettingsChanged(settings: Settings): void;
  onClick(): void;
  /** The player confirmed a power-up loadout (exactly LOADOUT_SIZE distinct kinds) for the next level. */
  onLoadoutConfirm(kinds: readonly PowerUpKind[]): void;
  /** The menu's world picker chose where a new run starts (an index into WORLDS). */
  onWorldSelected(index: number): void;
}

/** Columns in the loadout picker grid (used for arrow-key navigation; must match the CSS). */
const LOADOUT_COLUMNS = 4;

export interface ResultSummary {
  score: number;
  best: number;
  newBest: boolean;
  level: number;
  bestCombo: number;
}

/** Levels are shown with their world as a prefix: "Space Level 1" ... "Forest Level 10". */
export function stageLabel(levelIndex: number): string {
  return `${worldOf(levelIndex).name} Level ${levelNumber(levelIndex)}`;
}

const fmt = new Intl.NumberFormat('en-US');

const TEMPLATE = /* html */ `
<div class="hud" data-ref="hud">
  <div class="topbar">
    <!-- Cockpit console: a dark instrument panel with a centre bay for the score. Static, no animation. -->
    <svg class="topbar-art" viewBox="0 0 1920 120" preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id="hudPanel" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#070b14" stop-opacity="0.94"/>
          <stop offset="1" stop-color="#0c1322" stop-opacity="0.86"/>
        </linearGradient>
        <linearGradient id="hudEdge" x1="0" x2="1">
          <stop offset="0" stop-color="#6fd0ff" stop-opacity="0"/>
          <stop offset="0.12" stop-color="#6fd0ff" stop-opacity="0.45"/>
          <stop offset="0.88" stop-color="#6fd0ff" stop-opacity="0.45"/>
          <stop offset="1" stop-color="#6fd0ff" stop-opacity="0"/>
        </linearGradient>
      </defs>
      <path d="M0 0 H1920 V64 H1834 L1812 82 H1128 L1106 98 H814 L792 82 H108 L86 64 H0 Z" fill="url(#hudPanel)"/>
      <path d="M0 64 H86 L108 82 H792 L814 98 H1106 L1128 82 H1812 L1834 64 H1920" fill="none" stroke="url(#hudEdge)" stroke-width="1.5"/>
      <path d="M814 98 H1106" stroke="#6fd0ff" stroke-opacity="0.6" stroke-width="2"/>
      <g stroke="#6fd0ff" stroke-opacity="0.28" stroke-width="1.5">
        <path d="M232 22 V60 M716 22 V60 M1204 22 V60 M1420 22 V60"/>
      </g>
    </svg>
    <div class="readout level"><label data-ref="levelLabel">Space Level</label><b data-ref="levelNum">1</b></div>
    <div class="readout score"><label>Score</label><b data-ref="score">0</b></div>
    <div class="readout combo idle" data-ref="combo"><label>Multiplier</label><b data-ref="mult">x1</b></div>
    <div class="readout lives"><label>Lives</label><span class="pips" data-ref="lives"></span></div>
    <div class="readout frametime" data-ref="frametime" title="Frame time over the last half second: average / worst frame interval, and main-thread work per frame (ms)"><label>Frame ms</label><b data-ref="frameMs">--</b><small data-ref="frameCpu">cpu --</small></div>
    <button class="pause-btn" data-action="pause" aria-label="Pause"><i></i><i></i></button>
  </div>
  <div class="boss" data-ref="boss"><label><span>Target</span> <b data-ref="bossName"></b></label><div class="bar"><i data-ref="bossFill"></i></div></div>
</div>
<div class="popups" data-ref="popups"></div>
<div class="banner" data-ref="banner"><h2 data-ref="bannerTitle"></h2><p data-ref="bannerSub"></p></div>

<section class="screen menu" data-screen="menu">
  <h1 class="logo">REFRAKT</h1>
  <p class="tagline">Split the light. Shatter everything.</p>
  <nav>
    <button class="btn primary" data-action="play">Play</button>
    <button class="btn" data-nav="howto">How to play</button>
    <button class="btn" data-nav="settings">Settings</button>
  </nav>
  <div class="world-pick" role="group" aria-label="Starting world" data-ref="worldPick"><span>World</span></div>
  <a class="btn" href="./editor/index.html">World editor</a>
  <p class="hiscore">Best <b data-ref="menuBest">0</b></p>
</section>

<section class="screen panel" data-screen="howto">
  <h2>How to play</h2>
  <div class="cols">
    <div>
      <h3>Controls</h3>
      <ul class="keys">
        <li><kbd>Mouse</kbd> / <kbd>Touch</kbd> move the paddle</li>
        <li><kbd>A</kbd> <kbd>D</kbd> or <kbd>&larr;</kbd> <kbd>&rarr;</kbd> move with keyboard</li>
        <li><kbd>Click</kbd> / <kbd>Space</kbd> launch &amp; release</li>
        <li><kbd>P</kbd> / <kbd>Esc</kbd> pause &nbsp; <kbd>M</kbd> mute</li>
      </ul>
      <h3>Scoring</h3>
      <p>Every brick broken without touching the paddle builds your combo. Every ${PLAYER.comboStep} hits raises the multiplier, up to x${PLAYER.maxMultiplier}.</p>
      <h3>Bricks</h3>
      <ul class="legend">
        <li><i style="--c:linear-gradient(135deg,#ffb36b,#ff4f9e 50%,#2f84ff)"></i>Glass &mdash; one hit</li>
        <li><i style="--c:#25272d"></i>Charcoal glass &mdash; two hits, cracks first</li>
        <li><i style="--c:#8a55ff" class="framed"></i>Framed veined glass &mdash; three hits</li>
        <li><i style="--c:#4a525f"></i>Gunmetal &mdash; only explosions break it</li>
        <li><i style="--c:#ff3a0c"></i>Volatile &mdash; chain explosions</li>
        <li><i style="--c:#ffa51f"></i>Gold star &mdash; refracts into extra balls</li>
        <li><i style="--c:#a58cff;opacity:.6"></i>Phase &mdash; flickers in and out</li>
      </ul>
    </div>
    <div>
      <h3>Power-ups</h3>
      <ul class="legend icons" data-ref="powerLegend"></ul>
    </div>
  </div>
  <nav><button class="btn" data-nav="back">Back</button></nav>
</section>

<section class="screen panel" data-screen="settings">
  <h2>Settings</h2>
  <div class="form">
    <label>Music <input type="range" min="0" max="100" data-ref="music"></label>
    <label>Effects <input type="range" min="0" max="100" data-ref="sfx"></label>
    <label>Ambience <input type="range" min="0" max="100" data-ref="ambience"></label>
    <label>Graphics
      <select data-ref="quality">
        <option value="low">Low</option>
        <option value="medium">Medium</option>
        <option value="high">High</option>
      </select>
    </label>
    <label class="check">Screen shake <input type="checkbox" data-ref="shake"></label>
  </div>
  <nav><button class="btn" data-nav="back">Back</button></nav>
</section>

<section class="screen panel loadout" data-screen="loadout" aria-labelledby="loadoutTitle">
  <h2 id="loadoutTitle">Choose power-ups</h2>
  <p class="loadout-sub"><span data-ref="loadoutLevel">Space Level 1</span> &middot; only the ${LOADOUT_SIZE} you pick can drop this level</p>
  <div class="loadout-grid" role="group" aria-label="Power-ups" data-ref="loadoutGrid"></div>
  <p class="loadout-hint" data-ref="loadoutHint" aria-live="polite"></p>
  <nav><button class="btn primary" data-ref="loadoutStart" data-loadout="start" disabled>Start level</button><button class="btn" data-action="menu">Quit to menu</button></nav>
  <p class="loadout-keys"><kbd>&larr;</kbd><kbd>&rarr;</kbd><kbd>&uarr;</kbd><kbd>&darr;</kbd> / <kbd>Tab</kbd> move &nbsp; <kbd>Enter</kbd> / <kbd>Space</kbd> select &nbsp; <kbd>S</kbd> start &nbsp; <kbd>Esc</kbd> quit</p>
</section>

<section class="screen panel" data-screen="pause">
  <h2>Paused</h2>
  <p class="hiscore">Best <b data-ref="pauseBest">0</b></p>
  <nav>
    <button class="btn primary" data-action="resume">Resume</button>
    <button class="btn" data-nav="settings">Settings</button>
    <button class="btn" data-action="restart">Restart</button>
    <button class="btn" data-action="menu">Quit to menu</button>
  </nav>
</section>

<section class="screen panel" data-screen="gameover">
  <h2 class="bad">Signal lost</h2>
  <div class="result" data-ref="resultOver"></div>
  <nav>
    <button class="btn primary" data-action="restart">Try again</button>
    <button class="btn" data-action="menu">Menu</button>
  </nav>
</section>

<section class="screen panel" data-screen="victory">
  <h2 class="good">Spectrum restored</h2>
  <p class="tagline">World complete.</p>
  <div class="result" data-ref="resultWin"></div>
  <nav>
    <button class="btn primary" data-action="restart">Play again</button>
    <button class="btn" data-action="menu">Menu</button>
  </nav>
</section>

<div class="fatal" data-ref="fatal"></div>
`;

const POPUP_COUNT = 10;

function hexCss(hex: number): string {
  return `#${hex.toString(16).padStart(6, '0')}`;
}

/** DOM overlay: menus, HUD, banners and floating popups. Only touches the DOM when a value changes. */
export class UI {
  private readonly refs = new Map<string, HTMLElement>();
  private readonly screens = new Map<ScreenId, HTMLElement>();
  private readonly popups: HTMLElement[] = [];
  private popupCursor = 0;
  private current: ScreenId | null = null;
  private navReturn: ScreenId = 'menu';
  private bannerTimer = 0;
  /** Loadout picker: one card per power-up kind (index = PowerUpKind) and the picks so far, in order. */
  private readonly pickCards: HTMLButtonElement[] = [];
  private picks: PowerUpKind[] = [];
  private pickBlocked = false;
  /** performance.now() of the last Enter/Space the picker handled; see bindButtons. */
  private loadoutKeyTime = -1e9;

  // Last rendered HUD values, to avoid redundant DOM writes.
  private shown = { score: -1, best: -1, lives: -1, slots: -1, mult: -1, boss: -1, bossOn: false };

  constructor(
    private readonly root: HTMLElement,
    private readonly settings: Settings,
    private readonly callbacks: UiCallbacks,
  ) {
    root.innerHTML = TEMPLATE;
    root.querySelectorAll<HTMLElement>('[data-ref]').forEach((el) => this.refs.set(el.dataset.ref ?? '', el));
    root.querySelectorAll<HTMLElement>('[data-screen]').forEach((el) => this.screens.set(el.dataset.screen as ScreenId, el));

    const popupLayer = this.ref('popups');
    for (let i = 0; i < POPUP_COUNT; i++) {
      const el = document.createElement('span');
      popupLayer.appendChild(el);
      this.popups.push(el);
    }

    this.ref('powerLegend').innerHTML = Array.from({ length: POWERUP_KIND_COUNT }, (_, k) => {
      const info = POWERUPS[k as PowerUpKind];
      const detail = info.duration > 0 ? `${info.duration}s` : k === PowerUpKind.Shield ? 'charges' : 'instant';
      return `<li><span class="mini">${iconSvg(k as PowerUpKind)}</span>${info.name}<em>${detail}</em></li>`;
    }).join('');

    const grid = this.ref('loadoutGrid');
    for (let k = 0; k < POWERUP_KIND_COUNT; k++) {
      const info = POWERUPS[k as PowerUpKind];
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'pick';
      card.dataset.kind = String(k);
      card.setAttribute('aria-pressed', 'false');
      card.style.setProperty('--c', hexCss(info.color));
      card.innerHTML = `<span class="pick-icon">${iconSvg(k as PowerUpKind)}</span><span class="pick-text"><b>${info.name}</b><span>${POWERUP_DESCRIPTIONS[k as PowerUpKind]}</span></span><i class="pick-check" aria-hidden="true"></i>`;
      grid.appendChild(card);
      this.pickCards.push(card);
    }

    // Built-in and saved worlds are selectable in development and production.
    const worldPick = this.ref('worldPick');
    WORLDS.forEach((world, i) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'btn world';
      button.dataset.worldIndex = String(i);
      button.textContent = world.name;
      button.setAttribute('aria-pressed', String(i === 0));
      worldPick.appendChild(button);
    });

    this.bindButtons();
    this.bindSettings();
    window.addEventListener('keydown', this.onLoadoutKey);
  }

  // ------------------------------------------------------------ loadout picker

  /** Opens the power-up picker for a level, pre-selecting `preselect` (an empty list on the first level). */
  openLoadout(levelIndex: number, preselect: readonly PowerUpKind[]): void {
    this.picks = preselect.filter((k, i) => preselect.indexOf(k) === i).slice(0, LOADOUT_SIZE);
    this.pickBlocked = false;
    this.ref('loadoutLevel').textContent = stageLabel(levelIndex);
    this.renderPicks();
    this.showScreen('loadout');
    // Start keyboard users on the first selected card (or the first card), or on Start if ready.
    const focus = this.picks.length === LOADOUT_SIZE ? this.ref('loadoutStart') : this.pickCards[this.picks[0] ?? 0];
    focus.focus({ preventScroll: true });
  }

  private togglePick(kind: PowerUpKind): void {
    const at = this.picks.indexOf(kind);
    if (at >= 0) {
      this.picks.splice(at, 1);
      this.pickBlocked = false;
    } else if (this.picks.length < LOADOUT_SIZE) {
      this.picks.push(kind);
      this.pickBlocked = false;
    } else {
      // A fourth pick is refused (nothing is replaced); the hint explains why.
      this.pickBlocked = true;
    }
    this.renderPicks();
  }

  private renderPicks(): void {
    const full = this.picks.length >= LOADOUT_SIZE;
    this.pickCards.forEach((card, k) => {
      const on = this.picks.includes(k as PowerUpKind);
      card.classList.toggle('on', on);
      card.classList.toggle('locked', full && !on);
      card.setAttribute('aria-pressed', String(on));
      card.setAttribute('aria-disabled', String(full && !on));
    });
    const missing = LOADOUT_SIZE - this.picks.length;
    const start = this.ref<HTMLButtonElement>('loadoutStart');
    start.disabled = missing !== 0;
    this.ref('loadoutHint').textContent =
      missing > 0
        ? `Pick ${missing} more`
        : this.pickBlocked
          ? `${LOADOUT_SIZE} already chosen. Deselect one to swap it.`
          : 'Ready. Only these can drop this level.';
  }

  private confirmLoadout(): void {
    if (this.current !== 'loadout' || this.picks.length !== LOADOUT_SIZE) return;
    const kinds = [...this.picks];
    (document.activeElement as HTMLElement | null)?.blur();
    this.callbacks.onLoadoutConfirm(kinds);
  }

  /** Keyboard control of the picker: arrows move, Enter/Space toggle (or press Start), S starts. */
  private readonly onLoadoutKey = (e: KeyboardEvent): void => {
    if (this.current !== 'loadout' || e.repeat) return;
    const start = this.ref<HTMLButtonElement>('loadoutStart');
    const active = document.activeElement;
    const index = this.pickCards.indexOf(active as HTMLButtonElement);
    const last = this.pickCards.length - 1;
    let target: HTMLElement | null = null;
    switch (e.code) {
      case 'ArrowLeft':
        target = index > 0 ? this.pickCards[index - 1] : index === 0 ? null : this.pickCards[last];
        break;
      case 'ArrowRight':
        target = index >= 0 && index < last ? this.pickCards[index + 1] : index === last ? start : this.pickCards[0];
        break;
      case 'ArrowUp':
        target = index >= LOADOUT_COLUMNS ? this.pickCards[index - LOADOUT_COLUMNS] : index >= 0 ? null : this.pickCards[last - (LOADOUT_COLUMNS - 1)];
        break;
      case 'ArrowDown':
        target = index >= 0 && index + LOADOUT_COLUMNS <= last ? this.pickCards[index + LOADOUT_COLUMNS] : index >= 0 ? start : this.pickCards[0];
        break;
      case 'Enter':
      case 'Space':
      case 'NumpadEnter':
        this.loadoutKeyTime = performance.now();
        if (index >= 0) {
          this.callbacks.onClick();
          this.togglePick(index as PowerUpKind);
        } else if (active === start) {
          this.confirmLoadout();
        } else {
          (this.pickCards[0] as HTMLElement).focus({ preventScroll: true });
        }
        e.preventDefault();
        return;
      case 'KeyS':
        e.preventDefault();
        this.confirmLoadout();
        return;
      case 'Escape':
        // Back out of the run to the main menu.
        e.preventDefault();
        this.callbacks.onClick();
        this.callbacks.onAction('menu');
        return;
      default:
        return;
    }
    e.preventDefault();
    target?.focus({ preventScroll: true });
  };

  private ref<T extends HTMLElement = HTMLElement>(name: string): T {
    const el = this.refs.get(name);
    if (!el) throw new Error(`[UI] missing element "${name}"`);
    return el as T;
  }

  private bindButtons(): void {
    this.root.addEventListener('click', (e) => {
      const target = (e.target as HTMLElement).closest<HTMLElement>('button');
      if (!target) return;
      // Enter/Space on a picker button are handled in onLoadoutKey; the browser's follow-up synthetic click
      // (detail 0, right after that key) is ignored so a key press never acts twice.
      const fromKey = e.detail === 0 && performance.now() - this.loadoutKeyTime < 600;
      if (target.dataset.kind !== undefined) {
        // Picker card: keep focus on it so arrow keys continue from here.
        if (fromKey) return;
        this.callbacks.onClick();
        this.togglePick(Number(target.dataset.kind) as PowerUpKind);
        return;
      }
      if (target.dataset.loadout === 'start') {
        if (fromKey) return;
        this.callbacks.onClick();
        this.confirmLoadout();
        return;
      }
      this.callbacks.onClick();
      target.blur();
      if (target.dataset.worldIndex !== undefined) {
        const index = Number(target.dataset.worldIndex);
        this.ref('worldPick')
          .querySelectorAll<HTMLElement>('button')
          .forEach((b) => b.setAttribute('aria-pressed', String(b === target)));
        this.callbacks.onWorldSelected(index);
        return;
      }
      const nav = target.dataset.nav;
      if (nav === 'back') {
        this.showScreen(this.navReturn);
      } else if (nav === 'howto' || nav === 'settings') {
        if (this.current && this.current !== 'howto' && this.current !== 'settings') this.navReturn = this.current;
        this.showScreen(nav);
      } else if (target.dataset.action) {
        this.callbacks.onAction(target.dataset.action as UiAction);
      }
    });
  }

  private bindSettings(): void {
    const music = this.ref<HTMLInputElement>('music');
    const sfx = this.ref<HTMLInputElement>('sfx');
    const ambience = this.ref<HTMLInputElement>('ambience');
    const quality = this.ref<HTMLSelectElement>('quality');
    const shake = this.ref<HTMLInputElement>('shake');
    music.value = String(Math.round(this.settings.musicVolume * 100));
    sfx.value = String(Math.round(this.settings.sfxVolume * 100));
    ambience.value = String(Math.round(this.settings.ambienceVolume * 100));
    quality.value = this.settings.quality;
    shake.checked = this.settings.screenShake;

    const commit = (): void => {
      this.settings.musicVolume = Number(music.value) / 100;
      this.settings.sfxVolume = Number(sfx.value) / 100;
      this.settings.ambienceVolume = Number(ambience.value) / 100;
      this.settings.quality = quality.value as Quality;
      this.settings.screenShake = shake.checked;
      this.callbacks.onSettingsChanged(this.settings);
    };
    for (const el of [music, sfx, ambience, quality, shake]) el.addEventListener('input', commit);
  }

  get screen(): ScreenId | null {
    return this.current;
  }

  showScreen(id: ScreenId | null): void {
    this.current = id;
    this.screens.forEach((el, key) => el.classList.toggle('visible', key === id));
  }

  setHudVisible(visible: boolean): void {
    this.ref('hud').classList.toggle('visible', visible);
  }

  setLevel(index: number, _name: string): void {
    // Every world shares the HUD; only the label names the world ("Forest Level 2").
    this.ref('levelLabel').textContent = `${worldOf(index).name} Level`;
    this.ref('levelNum').textContent = String(levelNumber(index));
  }

  setMenuBest(best: number): void {
    this.ref('menuBest').textContent = fmt.format(best);
  }

  setResult(screen: 'gameover' | 'victory', r: ResultSummary): void {
    this.ref(screen === 'gameover' ? 'resultOver' : 'resultWin').innerHTML = `
      <div class="big">${fmt.format(r.score)}</div>
      ${r.newBest ? '<div class="newbest">New best score</div>' : `<div class="sub">Best ${fmt.format(r.best)}</div>`}
      <div class="sub" data-result-stage></div>`;
    this.ref(screen === 'gameover' ? 'resultOver' : 'resultWin').querySelector('[data-result-stage]')!.textContent =
      `Reached ${stageLabel(r.level - 1)} · Longest combo ${r.bestCombo}`;
  }

  banner(title: string, subtitle = '', seconds = 1.8): void {
    this.ref('bannerTitle').textContent = title;
    this.ref('bannerSub').textContent = subtitle;
    const el = this.ref('banner');
    el.classList.remove('show');
    void el.offsetWidth; // restart the CSS animation
    el.classList.add('show');
    this.bannerTimer = seconds;
  }

  /** Floating text at a projected playfield position (NDC). */
  /** `grand`: Refrakt's title, large and in sweeping spectrum colours. */
  popup(text: string, ndcX: number, ndcY: number, color: number, style: 'normal' | 'grand' = 'normal'): void {
    const el = this.popups[this.popupCursor];
    this.popupCursor = (this.popupCursor + 1) % this.popups.length;
    el.textContent = text;
    el.classList.toggle('grand', style === 'grand');
    el.style.left = `${(ndcX * 0.5 + 0.5) * 100}%`;
    el.style.top = `${(-ndcY * 0.5 + 0.5) * 100}%`;
    el.style.color = hexCss(color);
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
  }

  showFatal(message: string): void {
    const el = this.ref('fatal');
    el.textContent = '';
    const h = document.createElement('h2');
    h.textContent = 'Refrakt hit a problem';
    const p = document.createElement('p');
    p.textContent = message;
    el.append(h, p);
    el.classList.add('visible');
  }

  /**
   * Frame-time readout: average and worst interval between frames, and the average main-thread work
   * (simulation + rendering) per frame, all in milliseconds. Turns orange when a frame took over 25 ms.
   */
  setFrameStats(avg: number, worst: number, cpu: number): void {
    this.ref('frameMs').textContent = `${avg.toFixed(1)} / ${worst.toFixed(0)}`;
    this.ref('frameCpu').textContent = `cpu ${cpu.toFixed(1)}`;
    this.ref('frametime').classList.toggle('slow', worst > 25);
  }

  update(dt: number, world: World, best: number): void {
    if (this.bannerTimer > 0) {
      this.bannerTimer -= dt;
      if (this.bannerTimer <= 0) this.ref('banner').classList.remove('show');
    }

    const s = this.shown;
    if (world.score !== s.score) {
      s.score = world.score;
      this.ref('score').textContent = fmt.format(world.score);
    }
    if (best !== s.best) {
      s.best = best;
      this.ref('pauseBest').textContent = fmt.format(best);
    }
    const slots = Math.max(PLAYER.lives, world.lives);
    if (world.lives !== s.lives || slots !== s.slots) {
      s.lives = world.lives;
      s.slots = slots;
      let html = '';
      for (let i = 0; i < slots; i++) html += `<i class="${i < world.lives ? 'full' : 'lost'}"></i>`;
      this.ref('lives').innerHTML = html;
    }
    if (world.multiplier !== s.mult) {
      const el = this.ref('mult');
      el.textContent = `x${world.multiplier}`;
      const combo = this.ref('combo');
      if (world.multiplier > s.mult && s.mult > 0) {
        combo.classList.remove('pop');
        void combo.offsetWidth;
        combo.classList.add('pop');
      }
      s.mult = world.multiplier;
      combo.classList.toggle('idle', world.multiplier <= 1);
    }

    const boss = world.boss;
    if (boss.active !== s.bossOn) {
      s.bossOn = boss.active;
      this.ref('boss').classList.toggle('visible', boss.active);
      if (boss.def) this.ref('bossName').textContent = boss.def.name;
    }
    if (boss.active && boss.hp !== s.boss) {
      s.boss = boss.hp;
      this.ref('bossFill').style.transform = `scaleX(${Math.max(0, boss.hp / boss.maxHp)})`;
    }
  }
}
