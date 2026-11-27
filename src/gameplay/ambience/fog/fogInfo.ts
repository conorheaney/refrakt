import type { AmbienceInfo } from '../ambiences';

/** The fog's usual colour, a cool slate grey: moody rather than washed-out, still pale enough to read as fog. */
export const FOG_COLOR = '#a3b2bc';

/** What fog is (gameplay/ambience/fog/Fog.ts is what it does): headless, for the simulation, validation and the editor. */
export const FOG: AmbienceInfo = {
  label: 'Fog',
  paths: {
    min: 1,
    max: 6,
    depth: 0,
    noun: 'fog line',
    hint: 'Fog fills the scene above these lines, creeping slowly up and drifting about over each one. Draw one along the floor for fog everywhere, or along a ledge for fog only above it.',
  },
  every: [26, 44],
  options: [
    { key: 'color', label: 'Colour', type: 'color', default: FOG_COLOR },
    { key: 'thickness', label: 'Thickness', type: 'range', min: 0.3, max: 1.8, step: 0.05, default: 1, percent: true },
  ],
  defaultPaths: () => [
    {
      points: [
        { x: -21, y: -10.4 },
        { x: 21, y: -10.4 },
      ],
    },
  ],
};
