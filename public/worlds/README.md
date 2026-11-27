# Project worlds

The game plays only the worlds in these files (plus any browser saves): it loads
the JSON files listed in `index.json` automatically, in list order. There are no
built-in worlds; if no world can be played the game shows an error. Vite serves
this folder during development and copies it into `dist/worlds/` for production.

Every playable world has a drawn **ball area** (the walls the ball bounces off,
with one drain edge) and a drawn **paddle area** (the lane the paddle runs in).
The ball's walls come only from the ball area.

Each world is its own ten-level run; the menu lists them in `index.json` order.
Every world shares one arena, camera, brick grid and paddle; its look comes from
its embedded background image. `Verdant-Hollow.json` is the original forest
formations under the name **The Verdant Hollow**, with the tree-arch painting as
its background.

`Frozen-Sanctuary.json` adds a new ten-level campaign using its exported artwork
and custom collision arena. Its formations progress from First Snow to The
Eternal Sanctum, increasing breakable durability on every level and introducing
prisms, explosives, phase bricks, steel obstacles and armour along the way.

To add or update a world:

1. Open the editor through `npm run dev` or `npm run preview` on localhost.
2. Choose a game world in World settings, create a new world, or import JSON.
3. Save world. The editor writes the JSON here and updates `index.json` automatically.
4. Refresh the game. Before deploying a static production copy, rebuild.

You can still add JSON manually and list its filename in `index.json`. Use letters,
numbers, hyphens or underscores in filenames.

Each file includes ten complete levels, its background and its ball and paddle
areas; a world with ambience also has its `ambience` settings (which ambience, the
lines it comes from, how often it pulses and, for fog, its `options`: `color` and
`thickness`; older files that saved it as `weather`, or
named the weather on the world, are read too), and a world's hazard is named in `hazard` (`snakes`,
`icicles` or `scarabs`, placed in `hazards`); one that comes with the pulses
rather than on its own timer says so in `hazardCues` (`{ "scarabs": "pulse" }`). Invalid or
unfinished worlds (a level with nothing to break, an area or an ambience line not
drawn) are skipped with a
browser-console warning.
Project files take precedence over browser saves with the same world key.
Other browser saves continue to work; they are neither deleted nor modified.

Every editor save creates a dated backup in the project's `world-backups/` folder,
outside `public/`. Backups are not listed in the game or editor and are not bundled
into `dist/`. First saves back up the new world; subsequent saves back up the previous
version. Incomplete drafts remain in this folder for editing but are removed from
the game index until complete. Import creates a new world; load from Game worlds
to edit an existing one without changing its identity.
