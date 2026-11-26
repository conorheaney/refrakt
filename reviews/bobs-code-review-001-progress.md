# Code Review #001: progress

How the findings of [`bobs-code-review-001.md`](bobs-code-review-001.md) have been handled since the review.
Keep this up to date as findings are worked on. The next review starts its "progress since the last review"
section from here.

**Last updated:** 2026-11-26 (editor undo memory)

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
| S5 | `Game` mixes composition root and game-feel logic | **Done** | Pointer control moved into `PointerDriver` (`src/gameplay/PointerDriver.ts`); `tests/smoothness.test.ts` now drives the real class instead of a copy. Then the states, timing, steering and gameplay-event handling moved into `GameFlow` (`src/app/GameFlow.ts`), which reaches the view, HUD, sound, input and storage only through small interfaces; `Game` is now just the composition root and frame loop. See the `PaddleDriver` follow-up below |
| S6 | Ad-hoc view-to-audio callbacks | **Done** | `8adaaac`: typed `ViewEvents` on `GameView.events` (`src/app/viewEvents.ts`); `AudioDirector` subscribes itself. Per-frame events reuse their payloads |
| S7 | Launch options parsed in many places | **Done** | `parseLaunchOptions` (`src/app/launchOptions.ts`) reads the URL once in `main.ts`; `Game` and `GameView` take the options |
| S8 | Per-world arena settings ignored | **Done** | `bca75b0`: walls and paddle lane from the drawn areas. Then: flying scarabs, debris, floor bursts, confetti and popups use the drawn area and paddle lane. Tomb dust: `44b0eec` wrongly moved its origin from the painted lintel to 1.15 below the ball area's top (1.4 units too low in Pharoughs Tomb); it now pours from an explicit dust line drawn in the editor, and Pharoughs Tomb's line restores the lintel height. What still reads the template arena is listed under follow-ups |
| P1 | Drawn ball area slow and allocating | **Done** | `bca75b0`: see measurements below |
| P2 | Paddle-lane spans rebuilt every step | **Done** | Spans are cached per level and rebuilt only when the paddle's width changes (Expand) |
| P3 | Scarab routes rebuilt every step and frame | **Done** | Each nest's route is worked out at load, and its walk-in route once per floor height |
| P4 | Small per-frame allocations | **Closed: measured, not needed** | Profiled 2026-11-26. Simulation: under 0.2 KB of garbage per step with 24 balls. Real game in the browser (Tomb, Jungle Ruins, Outer Space, up to 24 balls): about 1 KB per frame, almost all inside three.js, roughly 50 KB/s at 60 fps, which the browser collects in well under a millisecond every few seconds. Bob's spots (brick colour array, icicle `filter()`, event payloads) are too small to show; reusing event payloads would add a source of bugs for no measurable gain. Only remaining note: the reduced-motion `matchMedia` lookup runs every frame in the Tomb (tiny) |
| P5 | Resolution scaling never recovers | **Done** | `ResolutionGovernor` (`src/engine/render/ResolutionGovernor.ts`): steps back up after 4 windows at 57 fps or more, and stops stepping up if a raise is soon followed by a drop (no flip-flopping). Tested in `tests/resolutionGovernor.test.ts` |
| P6 | All assets loaded and decoded at boot | **Done** | `cc3a9b3`: recorded sounds load per world (the four Refrakt sounds when audio starts; weather and hazard sounds when one of a world's levels loads), not all 14 (5.5 MB) on the first click. `b1d17f1`: the Refrakt sounds and the stone gate are 192 kbps MP3s instead of WAVs (2.3 MB to 0.53 MB). Then: each world's uploaded background is decoded when the world is first shown, and only the world on screen keeps its texture on the GPU (`BackdropCache`, `src/app/backdrops.ts`; about 7.5 MB each, six worlds); plain dark shows for the moment it decodes. World files are validated once (`buildCampaign` no longer re-validates). The world files themselves (1.47 MB, mostly base64 images) still download at boot: splitting the images out is a world-format change, left for later |
| P7 | Floor reflection re-renders everything | **Closed: not applicable** | The reflective floor is part of the built-in Space scenery, which is hidden whenever a world has an uploaded background. Six of the seven shipped worlds have one and Verdant Hollow uses the Forest scenery, so the second render never runs in the shipped game (only in an image-less Space world, such as a new one in the editor). Worth revisiting only if a shipped world goes back to the built-in Space scenery |
| P8 | Brute-force brick checks | **Closed: measured, not needed** | Profiled 2026-11-26: the fullest shipped level (117 bricks, Verdant Hollow) with the 24-ball maximum takes 0.19 ms per simulation step, about 0.4 ms of a 16.7 ms frame (0.05 ms per step with one ball). A grid lookup would be faster but not noticeably |
| P9 | No dispose or context-loss handling | **Partly done** | WebGL context loss pauses the game and stops drawing; on restore the game resizes and redraws (checked in a real browser with `WEBGL_lose_context`). Listener cleanup / `dispose()` deliberately left out: one game per page, nothing needs it yet |
| Q1 | `TrapGuard` never reset | **Fixed** | `f61fa46` |
| Q2 | How-to text wrong about Prism bricks | **Fixed** | `f61fa46` |
| Q3 | Multiball does nothing with a Magnet-held ball | **Fixed** | `f61fa46` |
| Q4 | Icicle push cancelled for mouse and touch players | **Fixed** (confirmed: the push was cancelled completely) | `f61fa46` |
| Q5 | Escaped ball never recovered | **Fixed** | `f61fa46` (escape counts as a lost ball); `bca75b0` (balls slipping into a wall are pushed back) |
| Q6 | State transitions fire inside a simulation step | **Done** | `levelCleared` and `gameOver` request their state change; `Game.frame` applies it after the frame's steps (at most one frame later) |
| Q7 | Pause and visibility gaps | **Done** | A hidden tab suspends the whole audio context (ambience loops included) and resumes it when shown. The level transition can be paused, resuming its countdown where it stopped. Music is scheduled 350 ms ahead (was 140 ms) to ride out main-thread stalls. Paused, the ambience ducks to 30%. Kept: the level banner's timer waits while paused, so a banner isn't lost behind the pause screen |
| Q8 | Comment contradicts the Refrakt hit-stop | **Fixed** | `f61fa46`: the freeze is kept, the paddle no longer lurches afterwards, and the comment is corrected |
| Q9 | No formatter or linter | **Done** | `978acd7`: Prettier. Then oxlint with type-aware rules (`no-floating-promises`, `no-misused-promises`): `npm run lint`. `typescript-eslint` doesn't support TypeScript 7 yet; oxlint's type checker (`oxlint-tsgolint`) is built on it |
| Q10 | `Game`, `UI`, `AudioDirector` untested | **Done (except `UI`)** | `Game`'s flow through `GameFlow` (`tests/gameFlow.test.ts`) and `AudioDirector` (`tests/audioDirector.test.ts`, with a recording fake engine: each gameplay moment's sound, silence in the menu demo, the rate limit, the Refrakt hum, pause ducking, weather loops, thunder). Writing these found 12 sound handlers that played in the menu's attract mode, now fixed. `UI` is DOM-only and stays untested (it would need a simulated browser) |
| Q11 | Tooling: no CI, unchecked indexing, slow tests | **Closed** | **CI deferred by decision**: checks run locally instead (formatting, lint and type-check after each change; tests, world-store checks, build and the editor browser test before major commits). A plan is ready if wanted: one GitHub Actions workflow on Ubuntu/Node 24, with the browser test as a parallel job. **Slow tests: no longer needed**: the suite now takes ~17 s, down from 49 s, after the collision work. **Strict indexing** (`noUncheckedIndexedAccess`): **dropped by decision**. Enabling it raises 1,004 type errors, nearly all array reads in loops whose bounds already guarantee the index, so the fixes would mostly be `!` noise in hot code. The lookups that use outside numbers are already checked at runtime: `Campaign.level()` throws, `worldAt` clamps, `?level=` is range-checked and world files are validated on load |
| Q12 | Editor undo can use a lot of memory | **Done** | Undo snapshots share the background image instead of copying it (`editor/src/undoSnapshot.ts`): 100 steps of a world with a 1.2 MB image took ~121 MB (measured), now ~0.2 MB plus the one image. Undoing an upload or removal still works. The limit stays at 100 (`UNDO_LIMIT`); a stroke of painting is one step |

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

**PaddleDriver (decided to revisit after Q10).** `PointerDriver` covers only mouse and touch. The keyboard goes
straight into the step input, and the autopilot and menu demo (`Game.driveDemo`) aim the paddle themselves. A
wider `PaddleDriver` owning all three (pointer, keyboard, autopilot) would put "who controls the paddle" in one
place and let tests drive the paddle through one object. It was kept narrow for the S5 commit; reconsider once
the `Game` state-machine tests (Q10) exist to prove the merge changes nothing.

**Intermittent editor browser-test failure: solved (`d73a541`).** It failed about 1 run in 7 at the
library step after a reload. Caught on the next loop: `Page.reload` returns before the old page is torn down,
so the wait for the library could pass on the old page. The test now waits for the reload properly; 8 runs in a
row passed after.

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

Review items first (decided 2026-11-26), then the `PaddleDriver` idea.

1. After the review items: reconsider `PaddleDriver` (see follow-ups), then a fresh review (002).
