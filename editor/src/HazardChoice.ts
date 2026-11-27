import type { AuthoredWorld } from '../../src/content/authoredWorlds';
import {
  CUEABLE_HAZARDS,
  hazardOf,
  isWorldHazard,
  WORLD_HAZARDS,
  type HazardCue,
  type HazardCues,
  type HazardDef,
  type WorldHazard,
} from '../../src/gameplay/hazards/hazards';
import type { Mode } from './AreaEditor';

const el = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

/** How each hazard is named in the editor, and the layer it is placed with. */
const HAZARDS: Record<WorldHazard, { label: string; layer: Mode; layerName: string }> = {
  snakes: { label: 'Wall snakes', layer: 'snakes', layerName: 'Snakes' },
  icicles: { label: 'Icicles', layer: 'icicles', layerName: 'Icicles' },
  scarabs: { label: 'Scarabs', layer: 'scarabs', layerName: 'Scarab nests' },
};

/** A world's hazard settings: which hazard it has, where they are placed and what sets them off. */
export interface HazardParts {
  readonly hazard?: WorldHazard;
  readonly hazards?: HazardDef[];
  readonly hazardCues?: HazardCues;
}

/**
 * The World settings dialog's hazard: which one the world has (AuthoredWorld.hazard; only its layer is offered,
 * where they are placed) and, for one that can be set off by a cue, whether it comes on its own timer or with
 * each ambience pulse (AuthoredWorld.hazardCues). Changing the hazard removes any of the old one placed.
 */
export class HazardChoice {
  constructor(
    private readonly getData: () => AuthoredWorld,
    private readonly commit: (parts: HazardParts, message: string) => void,
    private readonly showLayer: (mode: Mode | undefined) => void,
  ) {
    const select = el<HTMLSelectElement>('hazard');
    for (const hazard of WORLD_HAZARDS) select.add(new Option(HAZARDS[hazard].label, hazard));
    select.addEventListener('change', () => this.setHazard(select.value));
    el('hazard-cue').addEventListener('change', () => this.setCue(el<HTMLSelectElement>('hazard-cue').value));
  }

  /** Shows the world's hazard in the dialog, and offers only its layer. */
  refresh(): void {
    const data = this.getData();
    const hazard = data.hazard;
    el<HTMLSelectElement>('hazard').value = hazard ?? '';
    const cueable = !!hazard && (CUEABLE_HAZARDS as readonly string[]).includes(hazard);
    el('hazard-cue-field').hidden = !cueable;
    const cue = cueable ? data.hazardCues?.[hazard as keyof HazardCues] : undefined;
    el<HTMLSelectElement>('hazard-cue').value = cue ?? '';
    const placed = (data.hazards ?? []).length;
    el('hazard-hint').textContent = !hazard
      ? ''
      : cue === 'pulse' && !data.ambience
        ? 'This world has no ambience, so there are no pulses: they keep their own timer until it has some.'
        : placed
          ? ''
          : `None placed yet: place them under the ${HAZARDS[hazard].layerName} layer.`;
    for (const name of WORLD_HAZARDS) el(`mode-${HAZARDS[name].layer}`).hidden = name !== hazard;
    this.showLayer(hazard && HAZARDS[hazard].layer);
  }

  private setHazard(value: string): void {
    const data = this.getData();
    const next = isWorldHazard(value) ? value : undefined;
    if (next === data.hazard) return;
    const old = (data.hazards ?? []).filter((def) => hazardOf(def) !== next);
    if (
      old.length &&
      !confirm(
        `Remove the ${old.length} ${data.hazard ? HAZARDS[data.hazard].label.toLowerCase() : 'hazards'} placed in this world?`,
      )
    ) {
      this.refresh();
      return;
    }
    this.commit(
      { hazard: next, hazards: undefined, hazardCues: undefined },
      next
        ? `This world now has ${HAZARDS[next].label.toLowerCase()}: place them under the ${HAZARDS[next].layerName} layer.`
        : 'This world now has no hazard.',
    );
  }

  private setCue(value: string): void {
    const hazard = this.getData().hazard;
    if (!hazard) return;
    const cue: HazardCue | undefined = value === 'pulse' ? 'pulse' : undefined;
    const label = HAZARDS[hazard].label;
    this.commit(
      { hazard, hazards: this.getData().hazards, hazardCues: cue ? ({ [hazard]: cue } as HazardCues) : undefined },
      cue ? `${label} now come with each ambience pulse.` : `${label} now come on their own timer.`,
    );
  }
}
