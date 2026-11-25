# Code Review #001: progress

How the findings of [`bobs-code-review-001.md`](bobs-code-review-001.md) have been handled since the review.
Keep this up to date as findings are worked on. The next review starts its "progress since the last review"
section from here.

**Last updated:** 2026-11-25 (after commit `bca75b0`)

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
| S8 | Per-world arena settings ignored | **Partly done** | The walls and paddle lane now come from the drawn areas. Leftover uses of the template arena are listed under follow-ups |
| P1 | Drawn ball area slow and allocating | **Done** | `bca75b0`: see measurements below |
| P2 | Paddle-lane spans rebuilt every step | Open, **more important now** | `World.currentPaddleSpans()` runs every step in every world, since all of them have a paddle lane |
| P3 | Scarab routes rebuilt every step and frame | Open | `ScarabSystem.route()` |
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
| Q9 | No formatter or linter | Open | |
| Q10 | `Game`, `UI`, `AudioDirector` untested | Open | Depends on S5 and S7 |
| Q11 | Tooling: no CI, unchecked indexing | Open | |
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

**Leftover uses of the template arena (the rest of S8).** Each world still has a template arena from Space or
Forest (`world.field`, `FIELD`). These places use it where the drawn areas would be right:

| Where | What it does | Effect |
|---|---|---|
| `src/gameplay/hazards/scarabs/scarabs.ts:752` | keeps flying scarabs within ±13.5 | In a narrower drawn area, scarabs can fly over the scenery past the walls. This is the only one that affects gameplay. |
| `src/gameplay/bricks/DebrisSystem.ts:95` | brick shards bounce on the template floor (-9.7) | Shards can bounce in mid-air or sink, where the paddle lane sits higher or lower |
| `src/app/GameView.ts` (floor bursts, dust weather bounds), `src/app/Game.ts` (popup clamping) | effect placement | Cosmetic |
| `src/app/audio/AudioDirector.ts:21` | left/right sound panning uses the arena width | Negligible |
| `src/gameplay/CameraRig.ts`, `src/themes/scenery/*` | camera framing, scenery | Correct as is: framing belongs to the scenery |

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

## Suggested order for what's left

1. P2 and P3: cache paddle-lane spans and scarab routes (small; P2 is likely the biggest remaining per-step cost).
2. The rest of S8: the leftovers in the table above (small).
3. Q9 and Q11: linter, formatter and CI (small).
4. S5, S7, Q6 and Q10: make `Game` testable, then test the state machine (medium).
5. Q7, P5 and P9: tab visibility, audio, resolution recovery, context loss (small to medium).
6. S6: a typed view-to-audio event bus (small).
7. P6, Q12 and P7: per-world asset loading, editor undo memory, reflection (medium).
8. P4 and P8: only if profiling shows them.
