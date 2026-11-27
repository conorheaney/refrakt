# Refrakt world editor

The editor loads and saves JSON directly in `public/worlds/`. Every save creates
a timestamped backup in `world-backups/`, outside the game's served files.

A separate browser app in `editor/`, using the existing game for playtests.

From the repository root run `npm run dev` and visit `http://localhost:5173/editor/`.
Alternatively, run `npm run dev` from this folder. This starts the shared Vite host and opens the editor.
`npm run preview` also supports folder loading and saving after a build. Use a
localhost URL; folder writes are only available on the local computer. A static
host can play the exported worlds but cannot write to the project's disk.

1. **New world** creates ten blank levels. Every world shares the same arena, camera, bricks, ball and paddle; what makes it different is its background, its drawn areas, its levels and its settings. **Music** (**⋯** World settings, next to the world list) picks the world's soundtrack — Space (synth drive), Forest (organic synth-electronica), Jungle (adventure drums, marimba and brass), Crystal or Desert; **▶ Listen to music** auditions it in the editor. Worlds without a choice play the Space track.
2. Upload a PNG, JPEG or WebP scene background (up to 10 MB). It is resized and centre-cropped to 1600×900, embedded in the saved file, and drawn behind the live game objects; without one the scene is plain dark. Collision outlines are editor guides; the game only draws them when opened with `?debugArena`.
3. Select a level and a brick type. Click/drag to paint, right-click to erase. Keyboard users can focus cells, move with arrows and paint with Enter/Space. Fill row uses the last focused/painted row. Undo/redo includes layout and world changes.
The editor shows the level in the real game scene (scenery, camera, bricks, ball and paddle), with the brick grid laid over it. **Ball area** and **Paddle area** (top-left tools) let you draw or adjust the polygon the ball bounces inside (its amber dashed edge is the drain) and the lane the paddle moves in. Every world has both areas: a new world starts with the arena's walls and paddle line, and **Reset** returns an area to that starting shape. Older drafts without areas get these starting shapes when opened. The ball bounces only off the ball area. **Icicles** sets where a world's icicles form: each area is a line you fit to the underside of the scenery (double-click it to add points so it can follow an arch), with how many icicles hang from it and their shortest and longest length; **Reshuffle** picks new spacing and lengths. Drag an icicle's diamond handle (or focus it and use the arrow keys) to slide it along the line; from then on the area keeps each icicle where you put it (Reshuffle changes only lengths, and changing the count adds or removes icicles around them) until **Even spacing** spreads them out automatically again. The icicles it grows are previewed in the scene, and any whose tips reach the highest bricks in the world turn red. Older worlds with icicles placed one by one can turn them into an area. **Ambience** sets up the world's ambience (the air of the world, picked under **⋯** World settings: rain, snow, dust, fog or none): the lines it comes from (2–8 points each; snow and rain fall from them, dust pours from them when it pulses, fog lies along them and billows up; **Curve** rounds their bends, and they are drawn at the ambience's depth so they line up with it in the scene), how often it pulses (its moment of peak intensity: a pair of gusts, a lightning strike, the tomb shaking, a fog bank rolling in; seconds on the first level, sooner by the tenth, counted only while the ball is in play). Some ambiences have settings of their own there too: fog has its **Colour** and **Thickness** (how much it veils the bricks and paddle; capped so the game stays playable). Each world also has its own **Hazard** (World settings: wall snakes, icicles, scarabs or none), placed and tuned under its layer (only the world's hazard has one in the layer bar; changing it removes the old one's). Hazards never belong to the ambience: for scarabs, **Comes** sets whether the swarms keep their own timer or come with each ambience pulse, whatever the ambience is (a world with no ambience has no pulses, so they keep their own timer). Every one of these settings belongs to its world: two worlds with the same ambience or hazard each keep their own. Choosing an ambience keeps any lines already drawn or starts from its usual ones (**Use default** returns to those); a world with ambience needs at least one line to be played. **Guides** hides the grid lines; **Hide HUD** (or H) hides the editor panels.
4. Name each level. **Test level** runs the current layout in the actual game, including its normal loadout screen. Close the playtest to resume editing. Testing plays just this world and saves nothing.
5. The **world list** at the top of the editor lists the JSON files in the game folder, including drafts, most recently saved first. Select one to load it; **↻** next to it picks up external edits. **Save world** writes back to the same file, or creates a file for a new world. Complete worlds are registered in `public/worlds/index.json` automatically; drafts are excluded from that index. Refresh the game to see saves. Custom runs finish after ten levels.
6. Every save backs up the previous file with the current UTC date/time and a unique suffix in `world-backups/`. A first save backs up the newly created world. A matching index backup preserves its old game-list membership. Backups never appear in the editor's library or game's world picker and are not copied into production builds. If a backup fails, the save is aborted. Changes made by another editor or an external program cause a conflict instead of being overwritten: export your pending edits, refresh the list, and reload the world.
7. **Export JSON** downloads a portable copy, including the uploaded image. **Import** validates and opens a new copy with a new key; save it to add a new world to the game folder. Loading an existing game world preserves its identity.

`WorldDef`, `LevelDef` and the `.123SXPG` row alphabet are unchanged. The envelope
also carries the embedded background, the play areas, hazards and the ambience.
Settings older files may still contain (a Space/Forest scene, its arena sizes, a
campaign `replaces` slot, level hues, bosses) are dropped when a world is loaded.

World loading/saving no longer uses localStorage. Existing browser saves are not
deleted. Playtests still use temporary sessionStorage to pass the unsaved world
to the embedded game. To restore a backup, copy its world JSON over the matching
file in `public/worlds/`, then reload it in the editor and save to update the game
index. Retain the backup's world key.

`npm run build` typechecks both apps and builds `dist/index.html` and
`dist/editor/index.html`. Local preview reads the current source world folder;
rebuild before deploying a static copy. `npm test` covers format validation,
simulation, disk persistence, backup failures, conflicts and local API access.
`npm run test:world-files` runs only the disk/API checks with isolated fixtures.

On Windows with Chrome or Edge installed, `node editor/browser-smoke.mjs` tests the production build in an isolated browser profile: painting, undo, upload, saving/reloading, importing, playtesting and main-menu selection. It writes screenshots to `.tmp/editor-smoke-*` and closes the browser/server afterwards.
