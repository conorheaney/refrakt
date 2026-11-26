# Code Review #001: progress

How the findings of [`bobs-code-review-001.md`](bobs-code-review-001.md) have been handled since the review.
Keep this up to date as findings are worked on. The next review starts its "progress since the last review"
section from here.

**Last updated:** 2026-11-26 (strict indexing dropped)

File and line references in the review itself point at commit `b71285a` and are now partly out of date:
`World.ts` has been split into several systems and the boundary code has been rewritten. The current locations
are given below where they matter.

---

## Status of every finding

| # | Finding | Status | Where |
|---|---|---|---|
| S1 | Mutable global content registries | **Done** | `e926974`: an immutable `Campaign` (`src/content/campaign.ts`), built at boot and passed in |
| S2 | `World.ts` god object; power-ups scattered | **Done** | `e926974`: `BallPhysics`, `BrickField`, `PowerUpSystem`, `BossSystem` behind `WorldContext`; power-ups in one table (`src/gameplay/powerups/powerUps.ts`) |
| S3 | No common hazard interface | **Done** | `e926974`: `HazardSystem`; `World.hazards` renamed `World.snakes` |
| S4 | Two implementations of ball vs polygon arena | **Done** | `bca75b0`: one `PolygonBoundary` (`src/gameplay/arena/boundary.ts`); every world uses its drawn areas, no fallbacks |
| S5 | `Game` mixes composition root and game-feel logic | Open | Still true. The test in `tests/smoothness.test.ts` still copies `Game`'s pointer logic |
| S6 | Ad-hoc view-to-audio callbacks | Open | |
| S7 | Launch options parsed in many places | Open | Fewer flags now (`?boundary=` removed), but still parsed at module level in `Game.ts` and `GameView.ts` |
| S8 | Per-world arena settings ignored | **Done** | `bca75b0`: walls and paddle lane from the drawn areas. Then: flying scarabs, debris, floor bursts, confetti, popups and tomb dust use the drawn area and paddle lane. What still reads the template arena is listed under follow-ups |
| P1 | Drawn ball area slow and allocating | **Done** | `bca75b0`: see measurements below |
| P2 | Paddle-lane spans rebuilt every step | **Done** | Spans are cached per level and rebuilt only when the paddle's width changes (Expand) |
| P3 | Scarab routes rebuilt every step and frame | **Done** | Each nest's route is worked out at load, and its walk-in route once per floor height |
| P4 | Small per-frame allocations | Open | |
| P5 | Resolution scaling never recovers | Open | `Renderer.adapt` |
| P6 | All assets loaded and decoded at boot | Open | |
| P7 | Floor reflection re-renders everything | Open | |
| P8 | Brute-force brick checks | Open (low) | Only worth doing if multiball profiling shows it |
| P9 | No dispose or context-loss handling | Open | |
| Q1 | `TrapGuard` never reset | **Fixed** | `f61fa46` |
| Q2 | How-to text wrong about Prism bricks | **Fixed** | `f61fa46` |
| Q3 | Multiball does nothing with a Magnet-held ball | **Fixed** | `f61fa46` |
| Q4 | Icicle push cancelled for mouse and touch players | **Fixed** (confirmed: the push was cancelled completely) | `f61fa46` |
| Q5 | Escaped ball never recovered | **Fixed** | `f61fa46` (escape counts as a lost ball); `bca75b0` (balls slipping into a wall are pushed back) |
| Q6 | State transitions fire inside a simulation step | Open | |
| Q7 | Pause and visibility gaps | Open | |
| Q8 | Comment contradicts the Refrakt hit-stop | **Fixed** | `f61fa46`: the freeze is kept, the paddle no longer lurches afterwards, and the comment is corrected |
| Q9 | No formatter or linter | **Done** | `978acd7`: Prettier. Then oxlint with type-aware rules (`no-floating-promises`, `no-misused-promises`): `npm run lint`. `typescript-eslint` doesn't support TypeScript 7 yet; oxlint's type checker (`oxlint-tsgolint`) is built on it |
| Q10 | `Game`, `UI`, `AudioDirector` untested | Open | Depends on S5 and S7 |
| Q11 | Tooling: no CI, unchecked indexing, slow tests | **Closed** | **CI deferred by decision**: checks run locally instead (formatting, lint and type-check after each change; tests, world-store checks, build and the editor browser test before major commits). A plan is ready if wanted: one GitHub Actions workflow on Ubuntu/Node 24, with the browser test as a parallel job. **Slow tests: no longer needed**: the suite now takes ~17 s, down from 49 s, after the collision work. **Strict indexing** (`noUncheckedIndexedAccess`): **dropped by decision**. Enabling it raises 1,004 type errors, nearly all array reads in loops whose bounds already guarantee the index, so the fixes would mostly be `!` noise in hot code. The lookups that use outside numbers are already checked at runtime: `Campaign.level()` throws, `worldAt` clamps, `?level=` is range-checked and world files are validated on load |
| Q12 | Editor undo can use a lot of memory | Open | |

Regression tests for the fixed bugs are in `tests/bugfixes.test.ts`. The drawn-area boundary is tested in
`tests/boundary.test.ts`.

---

## Behaviour changes that need a playtest

`bca75b0` makes every world play slightly differently. The tests prove that no ball escapes, sticks or overlaps a
wall. They can't prove that the bounces still feel right, so play a few worlds, especially Pharoughs Tomb, Frozen
Sanctuary and Jungle Ruins, which have the most complex areas.

- **Anti-stuck redirects are new in every world.** If a ball touches the walls 6 times within 0.4 s without
  travelling 2.5 units, or wedges in a corner three times in one step, it is turned towards the middle of the
  area. Before, this only happened in the code-defined Forest world, which the shipped game never played. A ball
  rattling in a pocket may now visibly head off towards the centre.
- **Bounce maths differs very slightly.** The new boundary accepts contacts slightly differently, pushes back a
  ball that has slipped partly through a wall, and leaves balls below the drain alone. Over a few dozen bounces
  the exact paths differ from before. Levels feel the same, but a given run won't replay identically against the
  old code.
- **Balls held on the paddle** are kept inside the ball area's sides instead of sitting half inside a wall at
  the paddle's end.
- **Mouse feel (`f61fa46`).** Icicle pushes now reach mouse and touch players (Q4), and after a Refrakt freeze
  the paddle stays put rather than catching up with the cursor (Q8). The "paddle feels slower" report from before
  these fixes is still to be rechecked in play.

---

## Known follow-ups

**What still reads the template arena (by design).** Each world keeps a template arena from Space or Forest
(`world.field`). After S8, these are the only uses left, and none should follow the drawn areas:

| Where | What it does | Why it stays |
|---|---|---|
| `src/gameplay/CameraRig.ts`, `src/themes/scenery/*` | camera framing, scenery | Framing belongs to the scenery |
| `src/content/authoredWorlds.ts` | seeds a new world's starting areas | That is what the template is for |
| `src/gameplay/entities/EntityViews.ts` | the paddle's contact shadow offset; the barrier beam's initial length | Relative to the paddle; the beam length is overwritten every frame from the barrier's real span |
| `src/app/audio/AudioDirector.ts:21` | left/right sound panning scale | A fixed stereo scale; makes no audible difference |

**Other notes**
- Older browser drafts without areas get the editor's starting shapes when opened. That marks them as changed,
  so each needs saving once to keep the shapes.
- The 20 original Space and Forest levels now exist only as test data (`tests/support/classicLevels.ts`). The
  game plays world files only.

---

## Measurements

Cost of `World.step` in µs per step: the median of 3 runs of 6,000 steps on level 3 of each shipped world, with
an autopilot. "Multiball" collects a Multiball power-up every 400 steps.

| World | One ball, before → after `bca75b0` | Multiball, before → after |
|---|---|---|
| Outer Space | 15.9 → 9.2 | 56.1 → 19.1 |
| The Verdant Hollow | 25.8 → 9.4 | 364.6 → 35.4 |
| Pharoughs Tomb | 99.2 → 11.6 | 976.9 → 53.8 |
| Frozen Sanctuary | 128.1 → 11.8 | 830.1 → 35.8 |
| Atlantis | 19.0 → 6.6 | 130.7 → 19.2 |
| Volcanic Forge | 20.0 → 7.7 | 153.8 → 23.3 |
| Jungle Ruins | 137.4 → 10.8 | 1,426.2 → 56.4 |

---

Cost of `World.step` from the P2/P3 change, measured the same way (median of 5, with old and new interleaved in
one run). Absolute numbers vary between runs on this machine, so compare within a table only.

| World | One ball, before → after | Multiball, before → after |
|---|---|---|
| Outer Space | 12.9 → 5.4 | 38.4 → 30.9 |
| The Verdant Hollow | 11.5 → 6.1 | 104.1 → 72.7 |
| Pharoughs Tomb | 30.6 → 19.8 | 118.4 → 100.6 |
| Frozen Sanctuary | 17.2 → 11.0 | 60.0 → 54.7 |
| Atlantis | 10.6 → 4.6 | 32.6 → 24.3 |
| Volcanic Forge | 11.1 → 4.9 | 34.5 → 29.8 |
| Jungle Ruins | 15.9 → 10.7 | 91.1 → 84.8 |

---

## Suggested order for what's left

1. S5, S7, Q6 and Q10: make `Game` testable, then test the state machine (medium).
2. Q7, P5 and P9: tab visibility, audio, resolution recovery, context loss (small to medium).
3. S6: a typed view-to-audio event bus (small).
4. P6, Q12 and P7: per-world asset loading, editor undo memory, reflection (medium).
5. P4 and P8: only if profiling shows them.
