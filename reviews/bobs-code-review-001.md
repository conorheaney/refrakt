# Refrakt — Code Review #001

**Reviewer:** Bob (senior TypeScript / AAA game developer)
**Date:** 2026-11-24
**Scope:** Full read-only review of the repository at commit `b71285a` ("Move power-up countdowns onto the paddle; add expiry and shield feedback").

No project files were changed during the review and `git status` stayed clean. Paths below are relative to the repository root.

---

## Contents

1. [Executive summary](#executive-summary)
2. [Architecture overview](#architecture-overview)
3. [Findings: Structure](#findings-structure)
4. [Findings: Performance](#findings-performance)
5. [Findings: Quality — correctness](#findings-quality--correctness)
6. [Findings: Quality — readability, tests, tooling](#findings-quality--readability-tests-tooling)
7. [Prioritized roadmap](#prioritized-roadmap)
8. [Tooling and results](#tooling-and-results)

**Severity:** Critical / High / Medium / Low. **Effort:** S (small) / M (medium) / L (large).

---

## Executive summary

This is a healthy codebase, better than most junior-team projects I review.

**Done well:**

- The simulation is headless and allocation-aware. It runs on a fixed 120 Hz timestep (`FixedStepper`), uses a seeded random generator with separate streams for power-ups and hazards, keeps entities in fixed-size pools, and talks to the rest of the game only through a typed `EventBus`.
- Rendering is properly batched: bricks and debris use instanced meshes and particles use preallocated typed arrays.
- TypeScript strict mode is on and there is no `any` anywhere in `src`.
- There are 186 tests, including a deterministic-replay test and an architecture test that enforces the import layers and keeps the simulation free of three.js.
- Imported world files are validated defensively, and the local dev endpoint that saves world files is locked down properly (filename regex, atomic writes, backups, same-origin and localhost checks).

**The real problems** are structural drift and a split code path:

- All 7 shipped world files use editor-drawn ball areas. That code path (`playAreas.ts`) allocates on every step, has no cheap pre-filter, lacks the anti-stuck logic, and measured about 10–15× slower per step than the optimised outline path, which only the built-in Forest uses.
- World data lives in module-level mutable globals.
- `World.ts` (1,282 lines) and `GameView.ts` (720 lines) are god objects.
- Adding a power-up or hazard means editing about 8–10 files.
- The `Game` state machine and input pipeline have no tests.
- There is no lint, formatter or CI.

I found a handful of confirmed small bugs and no critical ones.

---

## Architecture overview

- **`src/engine`** (game-agnostic): fixed timestep and hit-stop/slow-mo (`core/Time.ts`), `Pool`, `Random`, `EventBus`, `StateMachine`, `Input`, `Renderer` (post-processing chain with bloom, screen effects, tone mapping, and resolution scaling that adapts to frame rate), `ParticleSystem`, `AudioEngine` (Web Audio buses, samples, loops).
- **`src/gameplay`**:
  - `World.ts` is the whole simulation: paddle, ball physics, bricks, power-ups, drops, lasers, boss, scoring.
  - `arena/` holds collision primitives (`collision.ts`), the rect/outline boundaries (`boundary.ts`) and the editor's polygon play areas (`playAreas.ts`).
  - `hazards/` holds the snake, icicle and scarab systems plus their views.
  - Per-entity views live in `entities/EntityViews.ts`, `bricks/BrickView.ts` and `refrakt/RefraktFx.ts`.
  - Tuning values are in `config.ts`, types in `types.ts`, the event map in `events.ts`.
- **`src/content`**: built-in `LEVELS` and `WORLDS` (both `export let`), loading and validation of authored and file worlds, and side registries (`worldPlayAreas`, `worldHazards`, `authoredBackgrounds`) keyed by world index.
- **`src/themes`**: scenery (Space/Forest `Environment`, floor `Reflector`), weather layers (rain, snow, dust) and the forge brick style.
- **`src/app`**:
  - `main.ts` boots: fetches the world files, installs them into the globals, and preloads all background textures.
  - `Game.ts` is the composition root and owns the frame loop, the state machine (menu, loadout, playing, paused, transition, game over, victory) and the pointer-to-step input mapping.
  - `GameView.ts` copies simulation state into the scene with interpolation and turns events into visual effects.
  - Also here: `AudioDirector` (events to sound), `Music` (scheduler driven by `requestAnimationFrame`), `UI` (DOM HUD and menus) and `Storage`.
- **`editor/`**: a standalone world editor (module-level state) sharing `src` validation.
- **`tools/`**: the dev-server plugin and world store.

**Data flow per frame:**

```
Game.frame
  → fsm.update
    → simulate
        apply hit-stop / slow-mo
        sample input
        stepper.advance → World.step × N   (emits events → Game, GameView, AudioDirector)
  → GameView.update   (interpolate, effects)
  → Renderer.render
```

---

## Findings: Structure

### S1. Mutable global content registries — High, effort M–L

- `src/content/worlds.ts:54` (`export let WORLDS`, replaced wholesale at :63–75), `src/content/levels.ts:43` (`export let LEVELS`), `src/gameplay/arena/playAreas.ts:15`, `src/gameplay/hazards/hazards.ts` (`worldHazards`), `src/content/authoredWorlds.ts:26`.
- `World.loadLevel` (`src/gameplay/World.ts:301–327`) reads all of these directly.
- Several side maps are keyed by a numeric world index, so correctness depends on install order (`authoredWorlds.ts:159–163`, `fileWorlds.ts:47–52`, `main.ts:31–35`).

**Why it matters:** hidden coupling, test pollution, no clean way to reload or preview, and fragile indexing.

**Fix:** build one immutable `Campaign` object at boot and inject it. Delete the `let` exports.

```ts
interface WorldEntry {
  def: WorldDef;
  levels: LevelDef[];
  cells: BrickCells;
  playAreas: PlayAreas;
  hazards: HazardDef[];
  background?: BackgroundSource;
}
interface Campaign { readonly worlds: readonly WorldEntry[] }

const world = new World(campaign);
const view = new GameView(/* ... */, campaign);
```

### S2. `World.ts` is a god object (1,282 lines) — Medium, effort L

- Ball sweep, depenetration, bricks, effects, drops, lasers, boss, scoring and outcome all share private state.
- Power-up behaviour is scattered as `effectTime[PowerUpKind.X]` checks: Slow at :253, Fire at :627, Magnet at :821 and :438, Expand at :471, Laser at :1099, plus the `collect()` if-chain at :443–464.
- Adding a power-up today touches: the `types.ts` enum, the hand-maintained `POWERUP_KIND_COUNT` (`types.ts:24`), `POWERUPS` and `POWERUP_DESCRIPTIONS` in `config.ts`, `World.collect`, `powerups/icons.ts`, `PaddlePowers` glyphs and `PADDLE_POWERS`, `AudioDirector`, and the UI column constant.

**Fix:**

- Extract `BallPhysics`, `BrickField`, `PowerUps` (effects, drops, loadout) and `BossSystem` behind a shared context object.
- Make power-ups a data-driven table:

  ```ts
  interface PowerUpSpec {
    duration: number;
    weight: number;
    onCollect?(ctx: WorldContext): void;
    onExpire?(ctx: WorldContext): void;
    modifiers: { speedScale?: number; pierce?: boolean; catch?: boolean };
  }
  ```

- Derive the count instead of hand-coding it, e.g. `export const POWERUP_KINDS = [...] as const`, or `Object.values(PowerUpKind).filter(Number.isInteger).length`.

### S3. No common hazard interface — Medium, effort S–M

- `World` hard-codes the three systems at `World.ts:199–203`, `:325–327`, `:413–415` and `:925–927`.
- Their signatures differ: snakes' `update` returns void while icicles and scarabs return points.
- Naming bug: `World.hazards` is the `SnakeSystem` (:199), even though "hazards" is the umbrella term everywhere else.

**Fix:**

```ts
interface HazardSystem {
  load(defs: HazardDef[], difficulty: number): void;
  update(dt: number, paddle: Paddle, balls: Ball[], live: boolean): number; // points
  reset(): void;
}
readonly hazardSystems: HazardSystem[];
```

Rename the existing field to `snakes`.

### S4. Two separate implementations of "ball vs polygon arena" — High, effort M

- `OutlineBoundary` (`src/gameplay/arena/boundary.ts:173–356`): typed arrays, bounding-box rejection, no allocations, implements `ArenaBoundary`.
- `sweepArea` plus the inline depenetration (`playAreas.ts:202–229`, `World.ts:868–885`): object segments, allocations, no pre-filter.
- `World.moveBall` branches between them at :648–664.
- The anti-wedge `TrapGuard` only runs when `boundary.kind === 'outline'` (:744). With a drawn ball area, `this.boundary` is still the rect, so **custom-area worlds get no anti-stuck handling**.

**Fix:** implement `PolygonAreaBoundary implements ArenaBoundary` (precomputed normals, lengths and boxes; drain edge as a flag) and remove the `ballBoundary` branch. Expose a capability such as `boundary.canTrap` instead of checking `kind`.

### S5. `Game` mixes the composition root with game-feel logic — Medium, effort M

- Pointer interpolation and the shove-offset bookkeeping (`src/app/Game.ts:202–248`) read and write simulation state (`paddle.shove`, `paddle.x`).
- `tests/smoothness.test.ts:21–53` says it "Mirrors Game.simulate/tick", so the test exercises a copy, not the real code.

**Fix:** extract a `PointerDriver` (from/to interpolation plus offset wear) into `gameplay/` and use it from both `Game` and the tests.

### S6. A second, ad-hoc event channel from view to audio — Low, effort S

- `GameView` exposes setter callbacks (`onThunder`, `onWeather`, `onSnowFrame`, `onDustFrame`, `onRumble`, `onTorchFlare` at `src/app/GameView.ts:224–242`), wired in `Game.ts:113–121`.

**Fix:** a typed `EventBus<ViewEvents>`, the same pattern already used for the simulation.

### S7. Launch options parsed in many places — Low, effort S

- URL flags are read at module scope or repeatedly: `Game.ts:30–48`, `:154`, `:411`; `GameView.ts:46`; `main.ts:29`.

**Fix:** parse a `LaunchOptions` object once in `main.ts` and pass it down. This also makes `Game` constructible in tests.

### S8. World config claims per-world settings that the code ignores — Low, effort S

- `WorldDef` says each world can have its own grid and field (`worlds.ts:21–34`). Validation then forces them equal to the built-ins (`authoredWorlds.ts:70–78`), and several places still read the globals:
  - `BrickView.ts:124,126,342–343` (`GRID`)
  - `scarabs.ts:752` (`FIELD.halfWidth`, which is wrong for a Forest-backed world with scarabs)
  - `DebrisSystem.ts:95`, `EntityViews.ts:484,962`

**Fix:** either drop the per-world fields from `WorldDef`, or thread `world.field` and `world.grid` through properly.

### Type design

Good overall: hazard definitions are a discriminated union on `kind`, events are typed, records use `satisfies`, and there is no `any`. `WorldId = 'space' | 'forest'` conflates "background template" with "identity" for authored worlds; I'd split those.

---

## Findings: Performance

### P1. The custom ball-area path allocates every step and is ~10–15× slower — High, effort M

Measured with a scratch benchmark (`World.step`, 60 s of simulation):

| Level | Time per step |
|---|---|
| Space L1 (rect) | 2.4–5.4 µs |
| Forest L1 (outline) | 7.9 µs |
| Frozen Sanctuary L1 (custom ball area) | 84 µs |

In absolute terms that is still small (about 0.17 ms per 60 Hz frame with one ball), but it scales with ball count (multiball allows up to 24) and churns the garbage collector at 120 Hz.

Where the allocations happen:

- `playAreas.ts:205`: a new `temp` hit object per call.
- `playAreas.ts:222`: `for (const endpoint of [a, b])` builds an array per segment.
- `playAreas.ts:208`: segment length recomputed every call.
- `playAreas.ts:28,35`: `nearestOnSegment` returns a new object, and `pointInPolygon` calls it for every edge.
- `World.ts:870–881`: three depenetration passes over every segment.

The Frozen Sanctuary area alone is about 455 segments (35 points with rounded corners).

**Fix:** see S4. Precompute everything once at `loadLevel` and add a per-segment bounding-box reject.

### P2. Paddle-lane spans are recomputed and allocated every step — Medium, effort S

- `World.currentPaddleSpans()` (`World.ts:506–510`) is called from `updatePaddle` on every step (:496) in 6 of 7 file worlds.
- It runs `paddleIntervals` (`playAreas.ts:166–175`) with `flatMap`, `filter` and spread, then filters again.

**Fix:** cache the spans per lane, keyed by paddle width. Recompute only when the width changes; Expand animates it, so quantise the width or store spans for both widths.

### P3. Scarab routes rebuilt every step and every frame — Low, effort S

- `ScarabSystem.route()` (`scarabs.ts:375–379`) spreads and runs `roundedPath` on every call.
- It is called through `foot()` per nest per step (:222, :336) and through `along(route(...))` per emerging scarab per step (:457), plus `ScarabView.ts:468` and `GameView.ts:625` every frame.

**Fix:** cache the route on the nest at `load()`.

### P4. Small per-frame allocations and calls — Low, effort S

- `GameView.ts:712` calls `matchMedia(...)` every frame in dust worlds; cache the `MediaQueryList`.
- `GameView.ts:705` builds an `{x, y}` object every frame.
- `BrickView.ts:225` builds an array literal on every `colorOf` call in forge mode.
- `icicles.ts:189` uses `filter().length`.
- Every `events.emit` allocates a payload object (acknowledged in the comment at `World.ts:98–99`). Because dispatch is synchronous, reusable payload objects per event type would be safe.

### P5. Resolution scaling only ever goes down — Medium, effort S

`Renderer.adapt` (`src/engine/render/Renderer.ts:145–164`) never scales back up. One bad stretch (shader compiles on a world switch, a background tab, battery saver, a 30 Hz display) leaves the game at as low as 0.55 resolution for the rest of the session.

**Fix:** step back up after N consecutive windows above about 57 fps, and reset on `visibilitychange`.

### P6. Boot and memory: everything loaded up front — Medium, effort M

- `main.ts:37–60` waits for every world JSON (about 1.5 MB of base64 backgrounds), decodes every background, and `GameView.prewarm` (:215) uploads all of them to the GPU before the first frame.
- Background loading and `loadForestAssets` run one after the other even though they could run in parallel.
- Each world is validated three times at boot, each doing a `structuredClone` of about 300 kB: `fileWorlds.ts:23`, `:42`, and `authoredWorlds.ts:157` via `installWorlds`.
- All 14 audio samples (about 6 MB, several uncompressed WAVs: `refrakt-start` 811 kB, `refrakt-hum` 640 kB) are fetched and decoded on the first click (`AudioEngine.ts:176`), regardless of world. `winter-storm.mp3` alone decodes to tens of MB of PCM.

**Fix:** load backgrounds and samples per world when a level loads, convert the WAVs to Ogg/Opus or MP3, and validate once.

### P7. The floor reflection re-renders the whole scene — Low–Medium, effort M

The `Reflector` at `src/themes/scenery/Environment.ts:217` re-draws everything, including particles, weather and trails.

**Fix:** restrict the reflection camera to a reflection layer.

### P8. Brick collision is brute force over 156 bricks per bounce iteration — Low, effort S

`World.ts:678–689` and `:838–847`. With the cheap reject it is fine today (~5 µs per step). Because bricks sit on a uniform grid, you could compute the swept cell range instead if multiball ever shows up in profiles.

### P9. Lifecycle cleanup is missing — Low, effort S

- No WebGL context-loss handling anywhere; `Game`, `Renderer` and `GameView` have no `dispose()`.
- Listeners are never removed: `Game.ts:143–147` (including an anonymous `visibilitychange` handler), `Input.ts:60–66`, `UI.ts:255`.
- The debug arena overlay is removed without being disposed (`GameView.ts:251`).

This is acceptable for a single-instance page, but it blocks hot-reload and in-page editor preview.

---

## Findings: Quality — correctness

Confirmed from the code unless marked otherwise.

### Q1. `TrapGuard` is never reset between games or levels — Low, effort S. *Confirmed.*

- `trapGuard.reset()` is only called from `setBoundaryOverride` (`World.ts:388`).
- `newGame` sets `time = 0` (`World.ts:294`). Stale entries keyed by pooled `Ball` objects then have `since > time`, so `time - s.since > WINDOW` never fires (`boundary.ts:398`). Hit counts keep accumulating, which can trigger spurious "free the ball" redirects early in the next Forest run.

**Fix:** call `this.trapGuard.reset()` in `clearTransient()`.

### Q2. The How-to screen describes Prism bricks wrongly — Low, effort S. *Confirmed.*

`UI.ts:108` says "Gold star — refracts into extra balls". A prism actually starts Refrakt (`World.ts:1007–1010`), and a test asserts it happens "without splitting the ball" (`tests/world.test.ts:575`).

### Q3. Multiball does nothing when the only ball is held by Magnet — Low, effort S. *Confirmed.*

`World.ts:450` skips stuck balls, so the pickup is spent and scores 250 points but spawns nothing.

**Fix:** use stuck balls as sources too, launching the copies upward.

### Q4. The icicle shove is cancelled for mouse and touch players — Medium, effort S. *Likely; verify in play.*

- `paddle.slide` is applied at about 4% per step (`World.ts:478–482`), then the pointer chase moves up to 0.67 units per step back toward the cursor (:492–494).
- `Game.tick` only carries `shove` into `pointerOffset` (`Game.ts:244–246`), not `slide`. With pointer control the push is barely visible; with the keyboard it works.

**Fix:** route the slide through the same offset mechanism.

### Q5. A ball that escapes a custom ball area is never recovered — Medium, effort S. *Hardening.*

- Depenetration only runs when the centre is inside the polygon (`World.ts:870`). Loss is only checked below `lossY` (:609–615).
- A ball that tunnels out sideways or upward (e.g. through a joint between segments) could fly off forever. The phase stays `live`, so the run soft-locks.

**Fix:** release any ball outside the arena's bounding box plus a margin as lost, and log it.

### Q6. State-machine transitions fire from inside a simulation step — Low, effort S

- `levelCleared` and `gameOver` handlers call `fsm.transition` synchronously from inside `World.step`, which is inside `stepper.advance` (`Game.ts:506–514`). The rest of that frame's steps then run under the new state.
- Harmless today, but a re-entrancy trap.

**Fix:** queue the transition and apply it after `simulate()`.

### Q7. Pause and visibility gaps — Low, effort S

- Only `playing` auto-pauses (`Game.ts:465–467`). P/Esc does nothing during the 2.6–4 s transition.
- The `AudioContext` is never suspended when the tab is hidden. Ambience loops (rain, snow, tomb) keep playing in background tabs and while paused, while the music, scheduled from `requestAnimationFrame` (`Music.ts:646–666`, 140 ms lookahead), stops.
- Any main-thread stall over 140 ms causes music dropouts.
- The banner timer is not advanced while paused.

**Fix:** `document.hidden ? ctx.suspend() : ctx.resume()`, and a larger lookahead or a timer-based scheduler.

### Q8. Comment contradicts code — Low, effort S

`Game.ts:516–517` says "no hit-stop freezes" because they cause a paddle lurch. `refraktStarted` then applies a 1.5 s hit-stop (`Game.ts:545`). Pointer targets keep updating during the freeze, so the documented lurch can happen on resume.

**Fix:** decide which is intended; either remove the hit-stop or update the comment.

### Checked and found correct

- Explosions breaking steel ("Gunmetal — only explosions break it", `UI.ts:106`).
- Power-up warning and expiry (tested at `tests/world.test.ts:56`).
- The timestep guard.
- Pause/resume of the stepper and hit-stop.

---

## Findings: Quality — readability, tests, tooling

### Q9. Formatting drift, with no formatter or linter — Low, effort S

- Mis-indented blocks: `GameView.ts:223`, `GameView.ts:450`, `World.ts:1029`.
- Orphaned or doubled doc comments: `GameView.ts:286–291`, `UI.ts:479–480`.
- Unused parameters kept with an underscore: `UI.setLevel(_name)` (`UI.ts:450`), `BrickView.colorOf(_time)`.

**Fix:** add Prettier and `typescript-eslint` (recommended plus `no-floating-promises`).

### Q10. Untested areas — Medium, effort M

- The simulation is well covered: determinism, collisions, boundaries, hazards, loadout, levels.
- Zero coverage: the `Game` state machine (pause, resume, transition, loadout, game over), `UI`, `AudioDirector` mapping, `Renderer.adapt`, `Storage`.
- This follows from S5 and S7: `Game` reads `window` at module scope and builds the renderer itself.

**Fix:** after S5 and S7, add a fake-clock test of the frame loop with a stub renderer.

### Q11. Tooling — Low, effort S

- tsconfig is strict, plus `noUnused*` and `noImplicitOverride`.
- Consider `noUncheckedIndexedAccess`; there are many unchecked index reads like `LEVELS[i]` and `this.bricks[row*cols+col]`.
- There is no CI. Add a workflow that runs `typecheck`, `test` and `build`.
- The test suite takes about 49 s, 88% of it in tests. Consider tagging the long simulation sweeps (e.g. the "never leaves a ball embedded" test, which has a 30 s timeout) to run separately.

### Q12. Editor undo can use a lot of memory — Medium for the editor, effort S

Each undo snapshot clones the whole world, including the base64 background of up to 1.2 MB (`editor/src/main.ts:57–60`, `:379`), capped at 100 snapshots. That can reach 100+ MB.

**Fix:** keep `backgroundImage` out of the undoable state.

---

## Prioritized roadmap

| # | Change | Findings | Effort | Rationale |
|---|---|---|---|---|
| 1 | Fix the confirmed bugs: reset `TrapGuard` in `clearTransient`, How-to text, Multiball with Magnet, pick one hit-stop behaviour. Verify and fix the icicle shove under pointer control. | Q1, Q2, Q3, Q8, Q4 | S | Cheap and player-visible. |
| 2 | Merge the polygon collision paths into one allocation-free boundary behind `ArenaBoundary`, with anti-stuck logic and an escape guard. | S4, P1, Q5 | M | Main path for every shipped world file; currently the slowest and least robust. |
| 3 | Cache paddle-lane spans and scarab routes. | P2, P3 | S | Removes the remaining per-step garbage in authored worlds. |
| 4 | Add lint, format, CI and stricter index checks. | Q9, Q11 | S | Keeps the larger refactors safe. |
| 5 | Extract `PointerDriver` and `LaunchOptions`, queue state transitions, then add state-machine flow tests. | S5, S7, Q6, Q10 | M | Makes `Game` testable and removes duplicated loop logic in tests. |
| 6 | Visibility and audio handling: suspend audio when hidden, let resolution scaling recover, handle WebGL context loss. | Q7, P5, P9 | S–M | Fixes background-tab and long-session degradation. |
| 7 | Hazard interface and the `hazards` → `snakes` rename. | S3 | S | Cheap step toward easier extension. |
| 8 | Replace the global registries with an injected `Campaign`. | S1, S8 | M–L | Removes hidden global state and index-keyed side maps; unlocks hot-reload and editor preview without the session-storage workaround. |
| 9 | Split `World.ts` and make power-ups data-driven; split `GameView` into per-area effects modules, as `RefraktFx` already is. | S2 | L | Easiest once 7 and 8 are done. |
| 10 | Load assets per world: lazy-load backgrounds and samples, compress the WAVs, validate once, take the background out of editor undo, restrict what the reflection renders. | P6, Q12, P7 | M | Faster boot and lower memory. |

---

## Tooling and results

| Command | Result |
|---|---|
| `npx tsc --noEmit` | Passed, 0 errors, about 2.8 s (TypeScript ^7.0.2). |
| `npx vitest run` | Passed: 19 files, 186 tests, 0 failures, 49.3 s. |
| `npx vite build --outDir <scratchpad>` | Passed in 0.4 s. JS: shared chunk 876 kB (244 kB gzip), game 55 kB, editor 54 kB. Largest assets: audio up to 977 kB each. Built to a scratch folder so the existing `dist/` was not touched. |
| Scratch benchmark of `World.step` | Results in the P1 table. File (temporary, outside the repo): `C:\Users\conor\AppData\Local\Temp\claude\4024bdf407e702f6\adff200a-659a-45d0-8cc8-8f21d52d2f4d\scratchpad\bench\step.bench.test.ts` |

There is no lint or format configuration in the repo, so neither could be run. `git status` was clean after every command.
