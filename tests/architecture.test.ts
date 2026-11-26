import { describe, expect, it } from 'vitest';

declare global {
  interface ImportMeta {
    /** Vite's build-time glob import. */
    glob(pattern: string, options: { query: '?raw'; import: 'default'; eager: true }): Record<string, string>;
  }
}

/**
 * Keeps the src/ layout honest. Each top-level folder is a layer and may only import from its own layer or
 * lower ones:
 *
 *   engine    generic code with no game knowledge (core utilities, renderer, audio engine, input)
 *   content   world and level data and loading      } one tier: worlds name gameplay types, and the rules run
 *   gameplay  rules, tuning and each element's view } a content Campaign
 *   themes    the scenery every world shares
 *   app       puts everything together (Game, GameView, HUD, audio director, entry point)
 */
const RANK: Record<string, number> = { engine: 0, content: 1, gameplay: 1, themes: 2, app: 3 };

// Every source file's text, keyed by its path under src/ ('gameplay/World.ts').
const SOURCES = Object.fromEntries(
  Object.entries(import.meta.glob('../src/**/*.ts', { query: '?raw', import: 'default', eager: true }))
    .filter(([file]) => !file.endsWith('.d.ts'))
    .map(([file, text]) => [file.slice('../src/'.length), text]),
);
const files = Object.keys(SOURCES);
const IMPORT = /(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g;
const layerOf = (file: string): string => file.split('/')[0];

/** Resolves a relative specifier the way the bundler does for these sources (extension optional). */
function resolveSpec(file: string, spec: string): string {
  const parts = file.split('/').slice(0, -1);
  for (const part of spec.split('/')) {
    if (part === '..') parts.pop();
    else if (part !== '.') parts.push(part);
  }
  const base = parts.join('/');
  return [base, `${base}.ts`, `${base}/index.ts`].find((c) => c in SOURCES) ?? base;
}

function importsOf(file: string): { local: string[]; packages: string[] } {
  const local: string[] = [];
  const packages: string[] = [];
  for (const [, spec] of SOURCES[file].matchAll(IMPORT)) {
    if (spec.startsWith('.')) local.push(resolveSpec(file, spec));
    else packages.push(spec);
  }
  return { local, packages };
}

describe('source layout', () => {
  it('puts every source file in a known layer', () => {
    const unknown = files.filter((f) => !(layerOf(f) in RANK));
    expect(unknown).toEqual([]);
  });

  it('only imports from the same or a lower layer', () => {
    const violations: string[] = [];
    for (const file of files) {
      const from = layerOf(file);
      for (const target of importsOf(file).local) {
        const to = layerOf(target);
        if (RANK[to] > RANK[from]) violations.push(`${file} -> ${target}`);
      }
    }
    expect(violations).toEqual([]);
  });

  it('keeps engine free of game code', () => {
    const leaks = files
      .filter((f) => layerOf(f) === 'engine')
      .flatMap((f) =>
        importsOf(f)
          .local.filter((t) => layerOf(t) !== 'engine')
          .map((t) => `${f} -> ${t}`),
      );
    expect(leaks).toEqual([]);
  });

  // The simulation runs headless in tests, and world validation runs in Node (tools/world-store), so neither
  // may pull in three.js, however indirectly.
  it.each(['gameplay/World.ts', 'content/authoredWorlds.ts', 'content/fileWorlds.ts'])('%s stays headless', (entry) => {
    const seen = new Set<string>();
    const offenders: string[] = [];
    const walk = (file: string): void => {
      if (seen.has(file)) return;
      seen.add(file);
      const { local, packages } = importsOf(file);
      if (packages.some((p) => p === 'three' || p.startsWith('three/'))) offenders.push(file);
      local.forEach(walk);
    };
    walk(entry);
    expect(offenders).toEqual([]);
  });
});
