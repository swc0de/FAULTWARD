# Prompt: rebuild Hollister Farm as one big family home (v2)

Copy everything below the line into a new coding session on this repository (branch `V3.10`).

---

Rebuild the map `farmhouse` (Hollister Farm, `data/maps/farmhouse.json`). The first version was judged poor.
It looked like a game level built from boxes, not like a home: too much empty outdoor space, too many
buildings, reused textures from the desert maps, and blocky furniture. This version is about **one house**.

## What went wrong in v1 (do not repeat)

- The playable area was 108 × 116 m of fields, road, barn, silos and a machine shed. The house was a small part of it.
- Every surface used a texture from the other maps (`wood_planks`, `plaster`, `container_red` and so on). They are grimy and
  Afghan or desert in feel, not a clean American home.
- Furniture was made of plain boxes: a sofa was a red box and beds were slabs.
- Crops were flat cards. Interiors were dim and dirty.

## The brief

1. **One building.** The farmhouse is the only building in the playable area. There is no barn, no silos, no shed and no
   windmill inside the play space. Fields, a distant barn and silos may appear **only as scenery beyond the boundary**,
   with no collision and nothing a player can reach.
2. **Smaller outside.** Keep only a yard around the house: about 15–20 m of lawn, driveway and garden on each side.
   Aim for a playable area of about **70 × 70 m** (`bounds` around `[[-35, -35, -1], [35, 35, 16]]`). Attackers spawn at
   the edge of the yard: at the end of the driveway by the road, with two or three parked cars, and at the garden gate.
   Use the existing vehicle library (`boxcar` visuals `family_suv`, `teal_estate`, `red_hatch`, and `lorry`).
3. **Double the house.** v1 was a 24 × 16 m two-storey main block plus a wing. Make the new house about twice the floor
   area: about **34 × 23 m**, two full storeys and a finished attic or a basement only if it plays well. It should read as
   a real family farmhouse: a front porch, a big kitchen at the heart of it, a mudroom, a family room, a formal living
   room, a dining room, a study, a laundry room, a pantry and a downstairs bathroom. Upstairs: a main bedroom with its
   own bathroom, three or four kids' and guest bedrooms, a family bathroom, a linen cupboard and a landing with a view
   down the stairwell.
4. **It must feel like a home.** It should look lived-in and tidy, not abandoned:
   - Family photos and framed pictures, rugs, curtains, lamps, plants, books, toys in the kids' rooms.
   - Coats and boots in the mudroom, a set dinner table, dishes, a fruit bowl, a TV and a couch with cushions and throws.
   - Warm light from lamps and ceiling fixtures; daylight through curtained windows.
5. **Gameplay stays the same.** Bomb sites A and B are both on the first (ground) floor, in different parts of the house
   (for example A = kitchen and pantry, B = family room and dining room). There are at least three staircases (a main
   stair, a back stair and an outside stair or porch-roof route). Most interior walls are soft; walls next to the sites
   can be reinforced. Defenders spawn inside. There should be several ways in: doors, windows, the porch and the cellar door.

## New textures: clean, made for this map

Do not use any existing material for the house, its yard or its contents. Create new materials. Name them with a
`farm_` prefix so nothing collides with the other maps.

- **Exterior:** painted lap siding (white or soft colour), white trim, asphalt shingle roof, porch decking, brick
  chimney, stone foundation.
- **Interior:** oak floor, painted plaster walls in two or three soft colours, wallpaper for one or two rooms,
  bathroom tile, kitchen tile, shaker cabinet paint, butcher block, granite or quartz worktop, carpet and rug fabrics.
- **Furniture:** upholstery fabrics, leather, linen, painted wood, metal finishes and glass.
- **Yard:** lawn, gravel, flagstone path, mulch.

How to make them:
- Generate them procedurally with a script you commit (Python and numpy are fine), or use CC0 sources (ambientCG,
  Poly Haven). Record every outside source and its licence in `THIRD_PARTY_NOTICES.txt`.
- Every material needs tileable **albedo**, **normal** and **ORM** (occlusion, roughness, metallic) maps.

How materials are loaded today (read the client before changing anything):
- Materials are entries in the client asset manifest under `materials`. Each entry has `surface`, `uv_scale`,
  `normal_strength`, `roughness_scale`, `metallic_scale` and `maps` keyed by size (`"512"`, `"1024"`). Each size has
  `albedo`, `normal`, `orm` JPEG paths under `/assets/g/textures/<name>/`, plus an optional `ctex` block.
- When `ctex` is absent, the client falls back to the JPEGs (see the `Ty` class in `client/dist/assets/game-*.js`).
  JPEG-only materials therefore work.
- Provide 512 and 1024 maps at least. Add 2048 only if you confirm the client can select that size.
- `surface` drives footstep and impact sounds (`wood`, `plaster`, `tile`, `fabric`, `metal`, `glass`, `brick`,
  `gravel`, `dirt`). Pick the right one for each material.
- The bake script (`scripts/bake-map.mjs`) writes a new hashed manifest. Extend it, or add a step, so the new materials
  are registered in that manifest with hashed file names, the same way the map files are.

## High-quality furniture and objects

All interior furniture and objects must be high quality and high resolution: real shapes with bevels, cushions,
legs, handles and folds, not boxes. Two ways that work with this engine:

- **Modelled meshes merged into the map geometry.** The map GLB can carry any mesh. The client draws every node with a
  material by name, and the baker already adds a custom `fixtures` node. Either build detailed furniture procedurally in
  the baker (`MeshBuilder` has `addRoundedBox`, `addChamferBox`, `addCylinder`, `addSphere` and raw `add(verts, idx)`
  for arbitrary meshes), or import CC0 glTF models and append their triangles. Use the same 18-float vertex layout:
  position, normal, tangent, binormal, uv and the 4-float detail.
- **Collision stays simple.** Collision comes only from the map JSON, which the server and client both build. Give each
  furniture piece one or two `box` colliders in `pieces`, hidden inside the visual mesh, and put the visual mesh in
  `visual_pieces` or a model list the baker reads.

Every room gets its own items, for example:
- **Kitchen:** an island with stools, a range with a hood, a fridge, a farmhouse sink, open shelves with crockery.
- **Family room:** a sectional sofa, a TV unit, a coffee table, a toy basket.
- **Dining room:** a table set for six, a sideboard, a chandelier.
- **Bedrooms:** beds with headboards, duvets and pillows, nightstands with lamps, dressers, mirrors.
- **Bathrooms:** a clawfoot tub, a vanity, a toilet, towels.
- **Study:** a desk, an office chair, bookshelves with individual books.
- **Mudroom:** a bench, hooks, coats, boots.
- **Laundry:** a washer and a dryer.
- **Throughout:** curtains on every window, ceiling lights and lamps that match the `light` pieces, framed pictures,
  rugs, houseplants.

Keep detail where players look: under 2 m and within rooms. Budget the whole map GLB at about **80 MB or less** (the
shipped maps are 61–79 MB) and keep frame rate close to the other maps.

## Engine notes (from building v1)

- The map is `data/maps/farmhouse.json`. `pieces` is what the game builds. `visual_pieces` is drawn into the geometry
  by `scripts/bake-map.mjs` only, and must never be something a player can collide with.
- After every edit, run `node scripts/bake-map.mjs farmhouse`. It rebuilds the GLB, lighting volume, radar and
  instances, and writes a new manifest.
- Useful prefabs: `building` (walls with `openings` keyed by `x` on s/n sides and `y` on e/w sides, `roof: false`,
  `floor_mat: null`), `wall` (`soft`, `reinforce`), `stairs` (step height must stay under 0.42 m), `floor`, `box`
  (with `hpr` for roof planes), `railing`, `light` (`fixture: "bulb"`), `spawn`, `zone`, `camera`, `callout`.
- The client loads `game-assets.json`, which points at the manifest. Map entries need `geometry`, `instances`, `data`,
  `volume`, `radar`, `environment` and `lights`.
- To test on Linux, run the server with Linux native modules (`@node-rs/argon2-linux-x64-gnu`, `better-sqlite3`
  prebuilt) in a scratch copy. Drive Chromium with Playwright using `--use-angle=swiftshader`.
  `window.__game.freeFly = true`, `camPos`, `yaw` and `pitch` give scripted camera shots. A watch match
  (`watch=1`) runs 5v5 bots.
- Bot-vs-bot matches with short timers favour attackers on every map (Qalat went 6–0 too). Do not read that as a
  map problem.

## Done when

1. The playable area holds only the house and its yard, about 70 × 70 m. No other building is reachable.
2. The house is about 34 × 23 m, two storeys, has every room listed above, and reads as a lived-in family home in
   screenshots of every room.
3. No material from the other maps is used on the house, the yard or the furniture. Every new material has albedo,
   normal and ORM maps at 512 and 1024 and is registered in the manifest.
4. Furniture is modelled with real shapes, with no box furniture. Close-up screenshots of the kitchen, family room, a
   bedroom and a bathroom look clean and detailed.
5. Bots finish a full match: they reach and plant on both sites and use all the staircases. There are no console or
   server errors. The map GLB is about 80 MB or less.
6. The preview image (`client/dist/assets/brand/farmhouse.webp`, 1000 × 625) and the README are updated.
   Before/after screenshots are included with the push.
