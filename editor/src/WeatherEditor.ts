import type { AuthoredWorld } from '../../src/content/authoredWorlds';
import { RELEASABLE_HAZARDS, type ReleasableHazard } from '../../src/gameplay/hazards/hazards';
import {
  defaultWeather,
  PATH_POINTS,
  STORM_SECONDS,
  validateWeather,
  type WeatherSettings,
} from '../../src/gameplay/weather/settings';
import { isWeatherKind, WEATHER_KINDS, WEATHERS } from '../../src/gameplay/weather/weathers';
import type { WeatherInfo } from '../../src/gameplay/weather/weathers';
import { defaultArea } from './defaultAreas';
import { PathTool, type EditPath, type PathGroup, type PathModel } from './PathTool';
import type { EditorScene } from './Scene';

const el = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const round = (n: number): number => Math.round(n * 100) / 100;
const [MIN_POINTS, MAX_POINTS] = PATH_POINTS;

/** How each hazard a storm can release is offered. */
const RELEASE_LABELS: Record<ReleasableHazard, string> = {
  scarabs: 'Scarabs come out with each storm (otherwise they keep their own timer)',
};

/**
 * Edits a world's weather (AuthoredWorld.weather): which one it has, the paths it comes from (drawn with the
 * shared path tool, PathTool, on the plane the weather uses, so they line up with it in the scene), how often its
 * storms come and which hazards they bring. Everything about a kind of weather comes from its WeatherInfo, so a
 * new weather needs nothing here.
 */
export class WeatherEditor {
  private readonly tool: PathTool;

  constructor(
    scene: EditorScene,
    private readonly getData: () => AuthoredWorld,
    private readonly commit: (weather: WeatherSettings | undefined, message: string) => void,
    private readonly preview: (weather: WeatherSettings | undefined) => void,
    private readonly status: (message: string, error?: boolean) => void,
  ) {
    const info = (): WeatherInfo | undefined => {
      const weather = this.getData().weather;
      return weather && WEATHERS[weather.kind];
    };
    const group: PathGroup = {
      kind: 'path',
      get noun() {
        return info()?.paths.noun ?? 'weather line';
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
      tool: 'weather',
      groups: [group],
      get depth() {
        return info()?.paths.depth;
      },
      layer: el('weather-layer'),
      curve: el<HTMLInputElement>('weather-curve'),
      read: () => ({ path: this.read() }),
      write: (model, final, message) => {
        const weather = this.withPaths(model.path);
        if (final) this.commit(weather, message);
        else this.preview(weather);
      },
      revert: () => this.preview(this.getData().weather),
      status,
      clamp: (p) => ({ x: Math.max(-24.9, Math.min(24.9, p.x)), y: Math.max(-11.9, Math.min(13.9, p.y)) }),
      changed: (model, sel) => this.panel(model, sel?.index ?? -1),
    });

    const kind = el<HTMLSelectElement>('weather');
    for (const name of WEATHER_KINDS) kind.add(new Option(WEATHERS[name].label, name));
    kind.addEventListener('change', () => this.setKind(kind.value));
    el('weather-draw').addEventListener('click', () => this.tool.draw('path'));
    el('weather-delete').addEventListener('click', () => this.tool.removeSelected());
    el('weather-reset').addEventListener('click', () => this.resetPaths());
    for (const id of ['weather-every-min', 'weather-every-max'])
      el(id).addEventListener('change', () => this.setEvery());
    const releases = el('weather-releases');
    for (const hazard of RELEASABLE_HAZARDS) {
      const input = Object.assign(document.createElement('input'), { type: 'checkbox' });
      input.dataset.hazard = hazard;
      input.addEventListener('change', () => this.setRelease(hazard, input.checked));
      const label = document.createElement('label');
      label.className = 'check';
      label.append(input, ` ${RELEASE_LABELS[hazard]}`);
      releases.append(label);
    }
    const [shortest, longest] = STORM_SECONDS;
    for (const id of ['weather-every-min', 'weather-every-max'])
      Object.assign(el<HTMLInputElement>(id), { min: String(shortest), max: String(longest), step: '1' });
  }

  refresh(): void {
    this.tool.refresh();
  }

  private read(): EditPath[] {
    return (this.getData().weather?.paths ?? []).map((p) => ({
      points: p.points.map((q) => ({ x: q.x, y: q.y })),
      radius: p.radius ?? 0,
    }));
  }

  /** The world's weather with these paths, checked. */
  private withPaths(paths: EditPath[]): WeatherSettings {
    const weather = this.getData().weather;
    if (!weather) throw new Error('Choose a weather first.');
    return validateWeather({
      ...weather,
      paths: paths.map((p) => ({
        points: p.points.map((q) => ({ x: round(q.x), y: round(q.y) })),
        ...(p.radius ? { radius: round(p.radius) } : {}),
      })),
    });
  }

  private ball() {
    return this.getData().playAreas?.ball ?? defaultArea('ball');
  }

  /** A new weather keeps the paths already drawn (each weather says how many it takes); Clear removes it. */
  private setKind(value: string): void {
    this.tool.stopDrawing();
    const old = this.getData().weather;
    if (!isWeatherKind(value)) {
      this.commit(undefined, 'The world is clear: no weather.');
      return;
    }
    const next = defaultWeather(value, this.ball(), old);
    const label = WEATHERS[value].label;
    this.commit(
      next,
      old?.paths.length
        ? `${label}: it comes from the lines already drawn. Redraw them under Weather if it should come from elsewhere.`
        : `${label}: it starts from its usual lines; adjust them under Weather.`,
    );
  }

  private resetPaths(): void {
    const weather = this.getData().weather;
    if (!weather) return;
    this.tool.stopDrawing();
    this.commit(
      { ...weather, paths: WEATHERS[weather.kind].defaultPaths(this.ball()) },
      'Weather lines reset to where this weather usually comes from.',
    );
  }

  private setEvery(): void {
    const weather = this.getData().weather;
    if (!weather) return;
    const every = ['weather-every-min', 'weather-every-max'].map((id) => Number(el<HTMLInputElement>(id).value));
    try {
      this.commit(validateWeather({ ...weather, every }), `Storms now come every ${every[0]}-${every[1]} seconds.`);
    } catch (error) {
      this.status(error instanceof Error ? error.message : String(error), true);
      this.refresh();
    }
  }

  private setRelease(hazard: ReleasableHazard, on: boolean): void {
    const weather = this.getData().weather;
    if (!weather) return;
    const releases: ReleasableHazard[] = (weather.releases ?? []).filter((h) => h !== hazard);
    if (on) releases.push(hazard);
    const { releases: _old, ...rest } = weather;
    this.commit(
      releases.length ? { ...rest, releases } : rest,
      on ? 'Each storm now brings the scarabs.' : 'The scarabs now come on their own timer.',
    );
  }

  private panel(model: PathModel, selected: number): void {
    const active = document.body.dataset.tool === 'weather';
    el('weather-tools').hidden = !active;
    const weather = this.getData().weather;
    el<HTMLSelectElement>('weather').value = weather?.kind ?? '';
    if (!active) return;
    const info = weather && WEATHERS[weather.kind];
    el('weather-settings').hidden = !info;
    if (!weather || !info) {
      el('weather-summary').textContent =
        'Clear: no weather. Choose one to set where it comes from and how often it storms.';
      return;
    }
    const paths = model.path ?? [];
    const noun = info.paths.noun;
    el<HTMLButtonElement>('weather-draw').disabled = paths.length >= info.paths.max;
    el<HTMLButtonElement>('weather-delete').disabled = selected < 0;
    el('weather-summary').textContent =
      paths.length < info.paths.min
        ? `No ${noun} yet: draw one before this world can be played.`
        : `${paths.length} ${noun}${paths.length === 1 ? '' : 's'} (at most ${info.paths.max})${selected >= 0 ? ` · selected: ${noun} ${selected + 1}` : ''}.`;
    el('weather-hint').textContent = info.paths.hint;
    el<HTMLInputElement>('weather-every-min').value = String(weather.every[0]);
    el<HTMLInputElement>('weather-every-max').value = String(weather.every[1]);
    const hazards = new Set((this.getData().hazards ?? []).map((h) => h.kind));
    for (const input of el('weather-releases').querySelectorAll('input')) {
      const hazard = input.dataset.hazard as ReleasableHazard;
      input.checked = !!weather.releases?.includes(hazard);
      // Offered only where the world has that hazard (or still has it ticked).
      input.closest('label')!.hidden = !hazards.has(hazard) && !input.checked;
    }
  }
}
