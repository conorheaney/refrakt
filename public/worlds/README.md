# Project worlds

The game loads the JSON files listed in `index.json` automatically, in list order.
No browser storage is required. Vite serves this folder during development and
copies it into `dist/worlds/` for production.

`Verdant-Hollow.json` preserves the original Forest scenery, collision outline,
ten formations and two bosses under the name **The Verdant Hollow**. Its
`"replaces": "forest"` field replaces the existing campaign slot rather than
adding a duplicate. The built-in Forest remains a fallback if the file cannot
load. This replacement field is only honored for project files. Its background
uses the game's bundled Forest artwork, so no embedded image is needed.

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

Each file includes ten complete levels, its background and any custom arena.
Invalid or unfinished worlds are skipped with a browser-console warning.
Project files take precedence over browser saves with the same world key.
Other browser saves continue to work; they are neither deleted nor modified.

Every editor save creates a dated backup in the project's `world-backups/` folder,
outside `public/`. Backups are not listed in the game or editor and are not bundled
into `dist/`. First saves back up the new world; subsequent saves back up the previous
version. Incomplete drafts remain in this folder for editing but are removed from
the game index until complete. Import creates a new world; load from Game worlds
to edit an existing one without changing its identity.
