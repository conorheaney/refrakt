import type { WeatherInfo } from '../weathers';

/** What rain is (gameplay/weather/rain/Rain.ts is what it does): headless, for the simulation, validation and the editor. */
export const RAIN: WeatherInfo = {
  label: 'Rain',
  paths: {
    min: 1,
    max: 6,
    depth: 0,
    noun: 'rain line',
    hint: 'Rain falls from these lines and splashes on whatever is under them. Draw one along the top of the scene for rain everywhere, or under a gap in the roof for rain coming through it.',
  },
  every: [18, 38],
  defaultPaths: () => [
    {
      points: [
        { x: -20, y: 12.3 },
        { x: 20, y: 12.3 },
      ],
    },
  ],
};
