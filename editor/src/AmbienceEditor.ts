import type { AuthoredWorld } from '../../src/content/authoredWorlds';
import {
  defaultAmbience,
  PATH_POINTS,
  PULSE_SECONDS,
  validateAmbience,
  type AmbienceSettings,
} from '../../src/gameplay/ambience/settings';
import { isAmbienceKind, AMBIENCE_KINDS, AMBIENCES } from '../../src/gameplay/ambience/ambiences';
import type { AmbienceInfo } from '../../src/gameplay/ambience/ambiences';
import { defaultArea } from './defaultAreas';
import { PathTool, type EditPath, type PathGroup, type PathModel } from './PathTool';
import type { EditorScene } from './Scene';

const el = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const round = (n: number): number => Math.round(n * 100) / 100;
const [MIN_POINTS, MAX_POINTS] = PATH_POINTS;

/**
 * Edits a world's ambience (AuthoredWorld.ambience): which one it has (in the World settings dialog) and, under the
 * Ambience layer, the paths it comes from (drawn with the
 * shared path tool, PathTool, on the plane the ambience uses, so they line up with it in the scene), how often its
 * pulses come. Hazards set off by the pulses are the world's choice (see HazardChoice). Everything about a kind of ambience comes from its AmbienceInfo, so a
 * new ambience needs nothing here.
 */
export class AmbienceEditor {
  private readonly tool: PathTool;

  constructor(
    scene: EditorScene,
    private readonly getData: () => AuthoredWorld,
    private readonly commit: (ambience: AmbienceSettings | undefined, message: string) => void,
    private readonly preview: (ambience: AmbienceSettings | undefined) => void,
    private readonly status: (message: string, error?: boolean) => void,
  ) {
    const info = (): AmbienceInfo | undefined => {
      const ambience = this.getData().ambience;
      return ambience && AMBIENCES[ambience.kind];
    };
    const group: PathGroup = {
      kind: 'path',
      get noun() {
        return info()?.paths.noun ?? 'ambience line';
      },
      closed: false,
      // Pink: stands out against sandstone and snow, and no other tool uses it.
      color: '#ff6fd8',
      minPoints: MIN_POINTS,
      maxPoints: MAX_POINTS,
      get maxPaths() {
        return info()?.paths.max ?? 0;
      },
      editable: () => !!info(),
    };
    this.tool = new PathTool(scene, {
      tool: 'ambience',
      groups: [group],
      get depth() {
        return info()?.paths.depth;
      },
      layer: el('ambience-layer'),
      curve: el<HTMLInputElement>('ambience-curve'),
      read: () => ({ path: this.read() }),
      write: (model, final, message) => {
        const ambience = this.withPaths(model.path);
        if (final) this.commit(ambience, message);
        else this.preview(ambience);
      },
      revert: () => this.preview(this.getData().ambience),
      status,
      clamp: (p) => ({ x: Math.max(-24.9, Math.min(24.9, p.x)), y: Math.max(-11.9, Math.min(13.9, p.y)) }),
      changed: (model, sel) => this.panel(model, sel?.index ?? -1),
    });

    const kind = el<HTMLSelectElement>('ambience');
    for (const name of AMBIENCE_KINDS) kind.add(new Option(AMBIENCES[name].label, name));
    kind.addEventListener('change', () => this.setKind(kind.value));
    el('ambience-draw').addEventListener('click', () => this.tool.draw('path'));
    el('ambience-delete').addEventListener('click', () => this.tool.removeSelected());
    el('ambience-reset').addEventListener('click', () => this.resetPaths());
    for (const id of ['ambience-every-min', 'ambience-every-max'])
      el(id).addEventListener('change', () => this.setEvery());
    const [shortest, longest] = PULSE_SECONDS;
    for (const id of ['ambience-every-min', 'ambience-every-max'])
      Object.assign(el<HTMLInputElement>(id), { min: String(shortest), max: String(longest), step: '1' });
  }

  refresh(): void {
    this.tool.refresh();
  }

  private read(): EditPath[] {
    return (this.getData().ambience?.paths ?? []).map((p) => ({
      points: p.points.map((q) => ({ x: q.x, y: q.y })),
      radius: p.radius ?? 0,
    }));
  }

  /** The world's ambience with these paths, checked. */
  private withPaths(paths: EditPath[]): AmbienceSettings {
    const ambience = this.getData().ambience;
    if (!ambience) throw new Error('Choose an ambience first.');
    return validateAmbience({
      ...ambience,
      paths: paths.map((p) => ({
        points: p.points.map((q) => ({ x: round(q.x), y: round(q.y) })),
        ...(p.radius ? { radius: round(p.radius) } : {}),
      })),
    });
  }

  private ball() {
    return this.getData().playAreas?.ball ?? defaultArea('ball');
  }

  /** A new ambience keeps the paths already drawn (each ambience says how many it takes); None removes it. */
  private setKind(value: string): void {
    this.tool.stopDrawing();
    const old = this.getData().ambience;
    if (!isAmbienceKind(value)) {
      this.commit(undefined, 'This world now has no ambience.');
      return;
    }
    const next = defaultAmbience(value, this.ball(), old);
    const label = AMBIENCES[value].label;
    this.commit(
      next,
      old?.paths.length
        ? `${label}: it comes from the lines already drawn. Redraw them under Ambience if it should come from elsewhere.`
        : `${label}: it starts from its usual lines; adjust them under Ambience.`,
    );
  }

  private resetPaths(): void {
    const ambience = this.getData().ambience;
    if (!ambience) return;
    this.tool.stopDrawing();
    this.commit(
      { ...ambience, paths: AMBIENCES[ambience.kind].defaultPaths(this.ball()) },
      'Ambience lines reset to where this ambience usually comes from.',
    );
  }

  private setEvery(): void {
    const ambience = this.getData().ambience;
    if (!ambience) return;
    const every = ['ambience-every-min', 'ambience-every-max'].map((id) => Number(el<HTMLInputElement>(id).value));
    try {
      this.commit(validateAmbience({ ...ambience, every }), `Pulses now come every ${every[0]}-${every[1]} seconds.`);
    } catch (error) {
      this.status(error instanceof Error ? error.message : String(error), true);
      this.refresh();
    }
  }

  private panel(model: PathModel, selected: number): void {
    this.worldFields();
    const active = document.body.dataset.tool === 'ambience';
    el('ambience-tools').hidden = !active;
    if (!active) return;
    const ambience = this.getData().ambience;
    const info = ambience && AMBIENCES[ambience.kind];
    el('ambience-name').textContent = info ? `· ${info.label}` : '';
    el('ambience-settings').hidden = !info;
    if (!ambience || !info) {
      el('ambience-summary').textContent =
        'No ambience. Choose one in World settings, then set where it comes from and how often it pulses here.';
      return;
    }
    const paths = model.path ?? [];
    const noun = info.paths.noun;
    el<HTMLButtonElement>('ambience-draw').disabled = paths.length >= info.paths.max;
    el<HTMLButtonElement>('ambience-delete').disabled = selected < 0;
    el('ambience-summary').textContent =
      paths.length < info.paths.min
        ? `No ${noun} yet: draw one before this world can be played.`
        : `${paths.length} ${noun}${paths.length === 1 ? '' : 's'} (at most ${info.paths.max})${selected >= 0 ? ` · selected: ${noun} ${selected + 1}` : ''}.`;
    el('ambience-hint').textContent = info.paths.hint;
    el<HTMLInputElement>('ambience-every-min').value = String(ambience.every[0]);
    el<HTMLInputElement>('ambience-every-max').value = String(ambience.every[1]);
  }

  /** The World settings dialog's ambience choice. */
  private worldFields(): void {
    el<HTMLSelectElement>('ambience').value = this.getData().ambience?.kind ?? '';
  }
}
