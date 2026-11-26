import type { WeatherInfo } from '../weathers';

/** What snow is (gameplay/weather/snow/Snow.ts is what it does): headless, for the simulation, validation and the editor. */
export const SNOW: WeatherInfo = {
  label: 'Snow',
  paths: {
    min: 1,
    max: 6,
    depth: 0,
    noun: 'snow line',
    hint: 'Snow falls from these lines and blows about under each one. Draw one along the top of the scene for snow everywhere, or along an opening for snow coming in through it.',
  },
  every: [24, 40],
  defaultPaths: () => [
    {
      points: [
        { x: -20, y: 12.3 },
        { x: 20, y: 12.3 },
      ],
    },
  ],
};
