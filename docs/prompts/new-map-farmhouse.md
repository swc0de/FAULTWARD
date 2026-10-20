# Prompt: add the "Hollister Farm" map (big two-storey farmhouse in Midwest corn/wheat country)

Copy everything below the line into a new coding session on this repository.

---

Add a fourth playable map to FAULTWARD: **Hollister Farm**, a big two-storey American farmhouse
in the middle of corn and wheat fields, with grain silos, a barn and farm vehicles. Map id: `farmhouse`.
The map should play as well as the existing three maps, so build it in the same way they are built.

## How maps work in this repo (read these first)

- Maps are data files in `data/maps/*.json` (`qalat.json`, `bazaar.json`, `oilcamp.json`). Use
  `bazaar.json` as the closest reference: it has a real two-storey building (Sarai Hotel, B site), made of
  a ground-floor `building` piece plus a second `building` piece with `"z": 3.6` and `"floor_mat": null`,
  connected by `stairs` pieces, with `catwalk`/`railing` pieces for the upper walkway.
- Top-level keys every map must have: `name`, `description`, `environment`, `bounds`, `skyvis_spacing`,
  `briefing` (`region`, `attack`, `defend`, `A`, `B`), `pieces`, `camera_shots`, `test_routes`,
  `practice_positions`, `modes` (with a `duel` mode using site A only plus a player-clip wall), and
  `environment_rework`. `oilcamp.json` also has `bot_waypoints`; add them here too.
- Gameplay pieces: `spawn` (5 for `attack`, 5 for `defend`), `zone` with `kind: "buyzone"` for each team
  and `kind: "bombsite"` named `"A"` and `"B"`, `camera` pieces for defender cameras, `callout` boxes that
  name every area, and `wall` pieces with `soft`/`reinforce`/`breach` for destructible and reinforceable walls.
- The map list is in the compiled server: `MAP_ORDER` in `server/dist/main.mjs` (line ~34). Add
  `"farmhouse"`. Search `server/dist/` and `client/dist/assets/*.js` for every other place that lists
  map ids (for example the `{qalat:"/assets/brand/qalat.webp", ...}` preview-image map in
  `client/dist/assets/site-*.js`) and add the new map to each.
- Add a preview image `client/dist/assets/brand/farmhouse.webp`, the same size as the others, captured
  from the map's `overview` camera shot, and add the map to the Maps table in `README.md`.
- Only built files (`dist/`) are in this repo. Before inventing anything, list every `type` the renderer
  and the server collision code accept, and every material name (`wood_planks`, `wood_planks_grey`,
  `wood_old`, `wood_dark`, ...), by searching the bundles. Prefer existing piece types and materials.

## Setting and layout

- **Region:** rural Midwest USA (fictional county, e.g. Nebraska/Kansas), late summer, golden-hour light.
  Choose a warm, clear HDRI from the existing `hdri_candidates`; low fog with a warm dust colour; green-gold
  ground. Flat land with a gentle rolling `terrain` ring at the edge, no mountains.
- **Size:** about the same as the other maps (`bounds` around `[[-63, -67, -1], [63, 67, 16]]`).
- **Fields:** tall corn rows on one side and golden wheat on the other, filling the open ground around the
  farm. The corn should be tall enough to hide a standing player and give soft cover (it blocks sight, not
  bullets); wheat should be waist high. Leave mown dirt tracks through the fields as attack lanes. If no
  crop piece type exists, add one (`crop` with `kind: "corn" | "wheat"`, a rectangle, row spacing and
  height) to the renderer and make it render efficiently (instanced). Do not fake it with hundreds of
  boxes.
- **Silos:** 2–3 tall corrugated-steel grain silos with domed tops, plus one older concrete stave silo
  beside the barn, a grain bin cluster and an auger. `storage_tank` with a steel material is a fallback.
- **Other farm dressing:** a red wooden barn with hay bales (`prop` `kind: "hay"`), a machine shed, a
  windmill water pump, a water trough, split-rail and barbed-wire fences, a gravel driveway with a mailbox,
  power poles (`power_line`), a few tall cottonwood/oak trees around the yard, tractor and plough, pallets,
  feed sacks, fuel tank on a stand.

## The house

- **Big, not a cottage:** about 24 m × 16 m footprint, plus a covered wrap-around front porch, a back
  porch/mudroom, and an attached single-storey kitchen wing. Two full storeys with a pitched roof.
- **Exterior:** wood-plank siding (horizontal lap boards, `wood_planks` / `wood_planks_grey`), painted and
  neat (not ruined), with white trim around windows and doors, corner boards, a stone or brick foundation
  plinth, shutters, porch posts and railings, a brick chimney, a shingled roof with gables. Glass windows
  with real frames at a consistent sill height.
- **Interior (realistic farmhouse):** plank floors, painted plaster or beadboard walls, wainscoting in the
  dining room, a big farm kitchen with a range, sink, counters and table, a living room with a fireplace,
  a dining room, a laundry/mudroom, a pantry, a study, a hallway, and upstairs 3–4 bedrooms, a bathroom
  and a landing. Use existing `furniture` kinds and add farmhouse ones only if missing.
- **Floors:** "first floor" means the ground floor (US usage). Ceiling height about 3.0 m; the second
  floor sits on a floor piece at about z = 3.4.
- **Staircases (at least three):** a main front staircase from the entry hall, a narrow back servant
  stair from the kitchen, and an outside stair (or a porch-roof route via a ladder/trellis) up to the
  second floor. Each must be walkable with the existing `stairs` piece (check `rise`/`run`/`steps` against
  the player step height) and give attackers more than one way to take the upper floor.
- **Destruction:** make most interior partition walls `soft` (breachable plank-and-plaster), keep the
  load-bearing core walls hard, make walls next to both sites `reinforce`-able, and add a couple of soft
  floor areas only if the engine supports vertical destruction.

## Sites, spawns and flow

- **Both bomb sites are on the ground floor**, inside the house:
  - **A:** the kitchen and pantry (back of the house).
  - **B:** the living room and dining room (front of the house).
  Each `bombsite` zone covers only the ground floor (`z` range about -0.5 to 3.2) so a charge cannot be
  planted upstairs. The sites must be separated by at least one wall and a hallway so they are real
  choices.
- **Defenders** spawn inside the house (or on the back yard right next to it) with their buy zone there.
- **Attackers** spawn outside at the edge of the fields along the county road, with their buy zone there.
  Park cars from the existing maps around their spawn and on the driveway: pickup trucks (`hilux`),
  `sedan`, `jeep`, `lorry` and a farm `truck`. Only use kinds that look right in rural America (no
  `jingle`, `technical`, `btr`, `t55` or `taxi`). Vehicles are cover; check their collision.
- **Routes:** give attackers at least three ways to the house: through the corn, through the wheat past
  the silos, and down the driveway past the barn. Entry points: front door, back door, mudroom, windows,
  cellar doors and the upper floor via the outside stair. Defenders need rotations between A and B
  through the hallway, through the upper floor, and around the porch.
- Add `callout` names for every area (Corn, Wheat, Silos, Barn, Driveway, Porch, Kitchen, Pantry,
  Living, Dining, Hall, Main Stairs, Back Stairs, Upstairs Hall, each bedroom, Mudroom, Cellar...),
  4–6 defender `camera` pieces, interior `light` pieces with warm bulbs (`kelvin` around 2700–3000),
  `camera_shots` (overview, attack spawn, each site, each stair), `test_routes` from attack spawn to
  each site for every route, `practice_positions`, `bot_waypoints`, and a `duel` mode for site A.

## Done when

1. `farmhouse` appears in the map list and lobby rotation, with its preview image, and loads with no
   console or server errors.
2. Bots can play a full match on it: they reach both sites by every route in `test_routes` and can plant
   and defuse.
3. Every staircase is walkable both ways; no player can fall through a floor or get stuck on a step,
   door frame or vehicle; nobody can get outside the bounds or onto the roof unintentionally.
4. Frame rate on the "overview" and in the corn is about as good as on the existing maps.
5. The game starts normally with `START_GAME.cmd` / `node server/dist/main.mjs`, and screenshots from
   every `camera_shot` are attached to the PR.
