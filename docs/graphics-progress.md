# Graphics overhaul: progress

The working log of the realistic-graphics overhaul (brief: the "graphics overhaul" prompt; art targets:
`docs/art-direction.md`; client edits: `docs/client-patches.md`). Read this first when continuing in a new session.

## Status

| Phase | State | Notes |
| --- | --- | --- |
| 0 Baseline and test harness | **done, waiting for review** ⏸ | 31 of 32 shots in `shots/phase0-baseline/` (farmhouse wall missing), metrics below |
| 1 Compression and loading | not started | plan revised: see "What the code says" |
| 2 Real materials | blocked on asset access | Poly Haven / ambientCG are not reachable from the cloud session |
| 3 Model import and props | not started | |
| 4 Buildings | not started | Qalat / Bazaar / Oil Camp need a verified rebake first (risk 1) |
| 5 Vehicles | not started | needs a shopping list approved first |
| 6 Characters | not started | needs a shopping list approved first |
| 7 Lighting and post | not started | |
| 8 Final pass | not started | |

## Where this session runs, and what that blocks

Phase 0 was done in a **Claude Code cloud session**, not on your computer. That matters:

- **Blocked hosts** (the environment's network policy answers 403): `api.polyhaven.com`, `dl.polyhaven.org`,
  `polyhaven.com`, `ambientcg.com`, `blender.org`, `sketchfab.com`, `unpkg.com`, `cdn.jsdelivr.net`.
  Reachable: `registry.npmjs.org`, `pypi.org`, `github.com`, `raw.githubusercontent.com`.
  To download CC0 assets from here, add `api.polyhaven.com`, `dl.polyhaven.org`, `ambientcg.com` and
  `acg-download.struffelproductions.com` (ambientCG's download host) to the environment's allowed domains
  (session title bar → environment → Edit → Network access), or run Phase 2 on your own computer as the
  brief intended.
- **No Blender binary.** `bpy` 5.2 (Blender as a Python module) is on PyPI, so `scripts/assets/prep_model.py` can
  run either as `blender -b -P` locally or with `pip install bpy` here.
- **No GPU.** Chromium renders with SwiftShader (CPU). Draw calls, triangles and texture memory are real; **frame
  times are not** (0.1–0.5 fps at 1280×720). For the "no more than 15 % worse" rule, run the capture on a real GPU
  with `--gpu` (see "How to run").
- **Native modules:** the release ships Windows builds. To run the server on Linux without touching tracked files,
  copy `server/`, `node_modules/`, `package.json` and `scripts/` into a scratch folder, symlink `client/` and `data/`,
  and run `bash scripts/linux/setup.sh` there (it replaces the better-sqlite3 binary in that copy only).

## How to run

```bash
node scripts/shots/capture.mjs plan                       # only when a map's layout changes (writes scripts/shots/shots.json)
node server/dist/main.mjs                                 # or START_GAME.cmd; note the port
node scripts/shots/capture.mjs run --phase phase1 --base http://127.0.0.1:5000 --gpu --width 1920 --height 1080
python3 scripts/shots/contact_sheet.py phase1 --vs phase0-baseline
node scripts/textures/material_usage.mjs                  # material area ranking (Phase 2 order)
```

Under SwiftShader use `--width 1280 --height 720 --seconds 0 --settle 3` (each shot takes 1–3 minutes, about
1.5 hours for all 32; a few shots need several attempts). Each shot gets a fresh browser and a fresh match, and the
capture stops all of `shotbot`'s matches before each one, so a crash never leaves bot matches running. Shots that fail
every attempt are listed under `missing` in `metrics.json`. Never run two captures at once: each one runs its own
5 v 5 match and browser, and two together exceed the cloud session's memory.

The capture logs in as a local account `shotbot` (created on first use), starts a 5 v 5 bot watch match per map,
clicks in as spectator, and uses `window.__game.freeFly` / `camPos` / `yaw` / `pitch`. Shots are the game canvas
only (no HUD). The two character shots follow a live bot (attackers first), so they differ a little run to run.
The game's own default graphics preset (**medium**: 512 px textures, low SSAO, FXAA) is used, because that is what
a new player gets; pass a preset later if we want to compare at high.

## Pipeline as found (V03.10)

**Maps.** `data/maps/<map>.json` holds `pieces` (what the server and client both build: collision, soft walls,
spawns, zones, lights) and, for the farmhouse only, `visual_pieces` (drawn into the geometry by the baker only).
`scripts/bake-map.mjs <map>` runs the game's own level code (cut out of `server/dist/worker.mjs`) to build every
piece through `MeshBuilder` (18 floats per vertex: position, normal, tangent, binormal, uv, 4-float detail), then
writes the GLB (one node per batch layer: `level`, `level:thin`, `level:backdrop`, `level:hi:x_y` / `level:lo:x_y`
LOD cells, `fixtures`), the instances JSON, the lighting volume (sky / sun / bounce + local light, voxel ray-marched),
the radar PNG and a new content-hashed manifest. Per-vertex AO goes in `detail.x`; `detail.y = -1` switches off the
shader's ground-dust gradient.

**Materials.** `manifest.materials[name]` = `surface`, `uv_scale`, `normal_strength`, `roughness_scale`,
`metallic_scale`, optional `opacity`, `maps["512"|"1024"(|"2048")]` with `albedo`, `normal`, `orm` JPEGs and an
optional `ctex` block. The client class `Ty` builds one `MeshStandardMaterial` per name; ORM drives AO, roughness and
metalness. The farm materials are generated by `scripts/textures/farm_textures.py` and also have to be registered in
the server worker and the client settings chunk (`scripts/textures/register_materials.py`) for surface sounds,
penetration and soft-wall panels.

**Client.** Only the minified bundle ships. The relevant pieces:

| Thing | Where (minified) | What it does |
| --- | --- | --- |
| GLB reader | `function Ho` in `game-*.js` | Own ~1 KB parser: float / uint8 / int8 / uint16 / uint32 accessors, **no int16, no byteStride, no extensions, no textures, no node scale**. Used for maps, weapons, soldier and library. |
| Scene builder | `function Gh` | Nodes → meshes, material by name from `Ty`. |
| Materials | `class Ty` | Picks `maps[String(size)]` (falls back to the first size), `ctex` when S3TC + RGTC are supported, else JPEG. |
| ctex | `function Ey` | The project's own GPU texture container: magic `CTX1`, JSON header, raw BC1 / BC3 / BC5 mip chain. Not supercompressed. Desktop GPUs only. |
| Texture size | `settings-*.js`, function `C` | `textures: Math.min(e.texture_size ?? 1024, 1024)`, validated against `[512, 1024]`; the menu offers 512 / 1024. The high and ultra presets already ask for 2048 / 4096 and get clamped. |
| HDR sky | `loadHdrSky` | Already supported: when the manifest map entry has `sky` (an `.hdr` file) it becomes the background and the PMREM environment, with `environment.hdri_rotation`, `sun_clamp`, `sky_target`. All maps ship `sky: null`. |
| Decals and clutter | `class t5`, manifest `dressing` | Already exists for Qalat, Bazaar, Oil Camp (`*.dressing-*.json`: decals with kind, position, normal, size, tint; clutter). The farmhouse has none. |
| Vehicles / trees | `Wl.load`, `vehicles_trees.glb`, `*.instances.json` | Instanced library models keyed by `model` (`boxcar:worn:{"visual":"family_suv"}`), with paint, wear, dust; tree impostors for distance. |
| Soldier | `manifest.soldier` | Procedurally posed (no `AnimationMixer` anywhere); ragdoll-style bone pairs. |
| Post | `setupPost` | ACES / AgX, SSAO, bloom, colour grading, vignette, film grain, sharpen, auto exposure already exist as settings. |
| Asset server | `serveAsset` in `server/dist/main.mjs` | **Serves `<file>.br` / `<file>.gz` sidecars automatically** when the browser accepts them. |

## What the code says that differs from the brief

1. **Only the farmhouse is baked by `scripts/bake-map.mjs`** (`manifest.baked_maps = ["farmhouse"]`). The Qalat,
   Bazaar and Oil Camp GLBs and their `dressing` files came from an earlier pipeline that is not in this repo (the
   client's material table cites `scripts/assets/texgen.ts` and `build/cache/textures`). Checked: running the game's
   level code on those three map files gives **the same material set and the same LOD layers** as the shipped GLBs,
   with more triangles on Bazaar (899k vs 747k) and Qalat (847k vs 686k) and about the same on Oil Camp (174k vs
   176k). So they *can* be rebaked with `bake-map.mjs`, but (a) the baker writes `dressing: null` and must be changed
   to keep the existing dressing file, and (b) the first rebake needs a shot-by-shot comparison with the baseline
   before anything else changes, because the older pipeline evidently simplified or differed somewhere.
2. **The client has no GLTFLoader.** "Register KTX2Loader and MeshoptDecoder on the GLTF loader" becomes "teach
   `Ho` about `EXT_meshopt_compression` (and int16 + node scale for `KHR_mesh_quantization`)" and "teach `Ty` to load
   `.ktx2` next to `ctex`". Both are small, contained patches.
3. **A compression win needs no client change at all:** the server already serves `.br` sidecars. Brotli (quality 9)
   takes the Oil Camp GLB from 11.8 MB to 3.0 MB and a lighting volume from 1.5 MB to 0.1 MB. Phase 1 starts there.
4. **GPU texture compression already exists** (`ctex`, BC1/BC5), so KTX2 is about download size and non-desktop GPUs,
   not about VRAM. The textures folder holds 312 MB of JPEG and 237 MB of ctex; KTX2 (ETC1S / UASTC + zstd) would
   replace both.
5. **The soldier is 76k tris at LOD0** (19k LOD1, 6k LOD2); the 118k figure is all LODs plus the first-person hands,
   which live in the same GLB (`vm:a:*`, `vm:d:*` meshes). Within the LOD0 budget of 25–40k, the current LOD0 is
   heavy, the LOD1/LOD2 are about right.
6. **The original pipeline already planned real assets:** each map's `environment.hdri` names a Poly Haven HDRI
   (`kloofendal_48d_partly_cloudy_puresky`, `syferfontein_1d_clear_puresky`), and the client's material table
   lists Poly Haven / ambientCG IDs for 24 materials (extracted to `assets-src/material-library-v03.10.json`).
   They were never shipped (procedural fallbacks were used). That list is the Phase 2 starting point.
7. **2048 textures:** need a three-place patch in the settings chunk (clamp, validation, menu). `Ty` already falls
   back to the first size a material has, so materials without 2048 keep working.

8. **Possible client memory issue (check on a real GPU).** Under SwiftShader the renderer's native memory grows
   by about 30 MB/s on Bazaar while the JS heap stays flat at ~215 MB, and drops back as soon as a garbage collection
   runs. Something allocates native buffers every frame (typed arrays, render-target readbacks such as auto exposure,
   or per-frame texture uploads are the usual suspects) and only GC frees them. At 60 fps there is enough JS garbage
   for V8 to collect often, so players may never notice, but it is worth a look in Chrome's task manager on a real
   GPU before Phase 1 adds more streaming. The capture forces a GC every 5 s under SwiftShader to stay stable.

## Baseline (Phase 0)

Shots: `shots/phase0-baseline/<map>/<kind>.jpg`, contact sheets `shots/phase0-baseline/sheet-<map>.jpg`,
numbers in `shots/phase0-baseline/metrics.json`. SwiftShader, 1280×720, medium preset. Each shot ran in a fresh
browser and a fresh bot match. Frame times are software rendering (Qalat's static shots over a 10 s window, the rest
over one frame) and **must not be read as GPU performance**; the draw calls, triangles and texture memory are real.

Renderer: swiftshader, viewport [1280, 720], timing window 0 s.

| Map | Shot | Draw calls | Triangles | Frame ms | Texture MB (est.) |
| --- | --- | ---: | ---: | ---: | ---: |
| qalat | wide | 561 | 0.80M | 1923 | 27.7 |
| qalat | street | 463 | 0.86M | 2091 | 27.7 |
| qalat | interior | 224 | 0.64M | 3370 | 27.7 |
| qalat | wall | 369 | 0.89M | 5435 | 27.7 |
| qalat | vehicle | 269 | 0.83M | 2552 | 27.7 |
| qalat | char3 | 823 | 0.96M | 9056 | 36.5 |
| qalat | char10 | 422 | 0.72M | 11653 | 37.1 |
| qalat | site | 260 | 0.75M | 2248 | 27.7 |
| bazaar | wide | 1006 | 1.07M | 8590 | 41.4 |
| bazaar | street | 849 | 1.06M | 9025 | 42.9 |
| bazaar | interior | 527 | 0.91M | 11843 | 42.9 |
| bazaar | wall | 823 | 1.22M | 7310 | 42.6 |
| bazaar | vehicle | 526 | 1.00M | 11150 | 42.9 |
| bazaar | char3 | 463 | 1.13M | 10142 | 42.9 |
| bazaar | char10 | 604 | 0.91M | 8029 | 42 |
| bazaar | site | 624 | 0.92M | 12369 | 42.9 |
| oilcamp | wide | 766 | 0.46M | 9226 | 32.6 |
| oilcamp | street | 682 | 0.56M | 8594 | 33.2 |
| oilcamp | interior | 628 | 0.60M | 7874 | 32.9 |
| oilcamp | wall | 572 | 0.57M | 8151 | 31.8 |
| oilcamp | vehicle | 325 | 0.48M | 7057 | 32.6 |
| oilcamp | char3 | 347 | 0.51M | 7151 | 31.8 |
| oilcamp | char10 | 401 | 0.47M | 6829 | 31.8 |
| oilcamp | site | 423 | 0.44M | 7110 | 32.3 |
| farmhouse | wide | 596 | 2.95M | 2481 | 321.8 |
| farmhouse | street | 585 | 3.15M | 5420 | 322.4 |
| farmhouse | interior | 449 | 3.15M | 3889 | 323 |
| farmhouse | wall | missing | | | |
| farmhouse | vehicle | 382 | 2.28M | 3011 | 323 |
| farmhouse | char3 | 326 | 1.75M | 2307 | 323 |
| farmhouse | char10 | 345 | 1.90M | 5850 | 322.4 |
| farmhouse | site | 439 | 3.27M | 1825 | 323 |

| Map | Load (ms) | Console errors |
| --- | ---: | --- |
| qalat | 19688 | 0 |
| bazaar | 24085 | 0 |
| oilcamp | 16313 | 0 |
| farmhouse | 10751 | 0 |

What the numbers already say, before any change:

- **Hollister Farm is the heaviest map by far:** 2.3–3.3 M triangles in every shot (the others 0.45–1.2 M) and
  ~323 MB of textures, against 28–43 MB on the other maps. Its materials are JPEG only (no `ctex`), so they sit in
  VRAM uncompressed, and its furniture is dense geometry drawn whether a room is visible or not (no LOD or culling
  cells for the interior). That is the first thing to fix for frame rate, and it costs nothing visually.
- **Draw calls** run 220–1,000 per shot, highest on Bazaar's wide view. Fine for WebGL2 at this scale, but Phase 3's
  props must be instanced or merged per material, not added as separate meshes.
- **No console errors** on any map.

**Disk:** map GLBs: farmhouse 91.4 MB, bazaar 79.4 MB, qalat 72.8 MB, oil camp 11.8 MB. Textures folder 529 MB
(311.7 MB JPEG + 237.4 MB ctex; the farm's own materials 50.7 MB, JPEG only). Library `vehicles_trees` 14.4 MB.

**Material ranking** (`node scripts/textures/material_usage.mjs`, area inside the map bounds): rock, sand, dust,
mud_wall, mud_wall_light, dirt, farm_lawn, mud_plinth, mud_roof, gravel, reed_ceiling, wood_old, farm_ceiling,
asphalt, farm_oak_floor, plaster_white, plaster, farm_foliage, farm_stubble, farm_shingle. These 20 are the
Phase 2 order.

### Critique of the baseline (honest)

Looked at every shot, at the medium preset a new player gets. What looks fake, and why:

**All maps**
- **Textures are noise, and they are blurry up close.** The 1 m wall shots (Qalat corrugated container, Bazaar mud
  wall, Oil Camp corrugated wall) are smears: a 512 px texture spread over 2–4 m (medium preset) is 128–256 px per
  metre, a quarter of the 512 px/m target, and the noise-generated albedo has no real structure to resolve anyway.
  Rust is evenly scattered splotches; stains are large soft blobs repeated across walls.
- **Ground** is uniform high-frequency noise (gravel, dirt, asphalt). At eye level it reads like sandpaper. There are
  no transitions (gravel into dirt, asphalt edges), no ruts, puddles, litter or debris.
- **Rocks and terrain** are faceted low-poly shapes with a flat texture: the biggest single giveaway on Qalat and Bazaar.
- **Vehicles** are boxy with no panel gaps, trims or interiors; the paint is flat, and wear is the same splotch noise.
- **Characters** are flat-coloured with no textures: uniform greens and tans, no fabric, no skin detail, stiff poses.
  The 3 m shots on Qalat, Oil Camp and the farm show it clearly.
- **What already works:** sun direction and colour, sky and haze, soft shadows, and the overall composition of the
  places. The lighting model is a good base; the assets on top of it are the problem.

**Qalat Village.** Mud walls are flat boxes with sharp corners. No rounded hand-built edges, no layered plaster, almost
no rain streaks or base erosion, even though the art direction calls for heavy wear. Timber beam ends sticking out of
walls are present and help. The wide shot reads as a diorama: every roof is the same flat slab.

**Sarai Bazaar.** The alleys are bare walls with nothing on them: no cables, signs, AC units or goods, although the
brief's realism depends on clutter. The fuel-station canopy and the hotel courtyard are the best shots; the carpet
lane awnings are flat colour with a noisy weave.

**Oil Camp.** Sparse and toy-like from above. Berms are smooth blobs; the separator tanks are good shapes with no
detail (no welds, valves, labels); the corrugated cabin walls are streaky.

**Hollister Farm.** The exterior reads best of the four from a distance (white siding, porch, shutters), but the trees
are cotton-ball canopies, the lawn is one flat green, and the hedges are green boxes. Indoors, the oak floor is
over-saturated and visibly repeats; corners have no contact shadow or AO; the walls are blank and evenly lit; the
family room feels empty and large. The lamps help.

**Harness limitations in these shots** (fixed or noted for the next run):
- The 10 m character shots stand 10 m in front of a bot along its heading, which often lands behind a wall (Bazaar,
  Oil Camp) or makes the bot tiny. Bazaar's 3 m shot also missed. For judging characters, Phase 6 needs a controlled
  turntable scene; these follow shots only show characters in context.
- The farmhouse wall shot is missing: every view of the farmhouse exterior at 1 m made SwiftShader's renderer exceed
  the session's memory limit (16 attempts, two different walls). It should work with `--gpu`.
- Qalat's static shots were taken with a 10 s timing window, the other shots with one frame. Under SwiftShader this
  only changes the meaningless frame time.

## Plan (adapted to what the code says)

**Phase 1: compression and loading**
1. Bake step: write `.br` sidecars for every GLB, volume `.bin`, JSON and ctex (no client change). Make
   `bake-map.mjs` do it for what it writes; a one-off script for the shipped files.
2. Patch `Ho` for `EXT_meshopt_compression` + `KHR_mesh_quantization` (int16, normalized, node scale), with the
   meshopt decoder from npm (`meshoptimizer`) served from `client/dist/assets/`. Then run
   `@gltf-transform/cli meshopt` in the bake. Keep the `_DETAIL` attribute (custom attributes survive gltf-transform).
3. KTX2: `toktx` (KTX-Software, from GitHub releases) or the Basis encoder from npm; ETC1S for albedo and ORM, UASTC
   for normals; `Ty` loads `ktx2` before `ctex` before JPEG; the Basis transcoder from the npm `three` package.
4. Allow 2048 in the settings chunk (clamp, validation, menu).
5. Verify: shots identical to baseline (pixel diff), download size and load time down.

**Phase 2: real materials** (needs Poly Haven / ambientCG reachable, see above)
`scripts/textures/import_pbr.py` driven by `assets-src/materials.json` (material name → source asset, uv_scale,
tweaks), writing the same manifest format, keeping every name. Top 20 first. HDRIs: download the ones the map files
already name, write them as `.hdr` into the manifest's `sky` field (the client already supports it), then match
`sun_dir` / `sun_color` to the HDRI's sun.

**Phases 3–8** as in the brief, with these changes: the decal system exists (extend `dressing`, give the farmhouse
one); characters are posed procedurally, so new animation clips mean a bigger client change than the brief assumes
(decide at Phase 6); vehicles and props for the three non-baked maps go through the instances and dressing files,
which do not need a rebake.

## Risks

1. **Three maps were baked by an older pipeline** (see above). The current baker reproduces them closely but not
   exactly; the first rebake of each must be compared with the baseline shots, and the baker must keep `dressing`.
2. **Minified client.** Every patch is a string replacement on minified code; a future release breaks them. Each
   patch is recorded in `docs/client-patches.md` with the exact anchor it replaces.
3. **Asset access** from the cloud session (network policy) and for paid assets (your accounts).
4. **Frame time** cannot be measured here; it needs a GPU run on your computer.
5. **Repo size:** `.git` is already 661 MB. Raw downloads stay in `assets-src/` (ignored); shots are committed as
   JPEG.
6. **Soft walls:** the client builds destructible panels from the map data (`qy` class) with materials by name;
   replacing their look has to keep the panel materials compatible with breakage.

## Checklist

- [x] Read the brief, the farmhouse v2 prompt, the bake scripts, texture scripts, rehash script, manifest, map files
- [x] Ran the server on Linux (scratch copy with Linux native modules)
- [x] `scripts/shots/capture.mjs` (plan + run), `scripts/shots/shots.json` (8 shots per map)
- [x] `scripts/shots/contact_sheet.py`
- [x] `scripts/textures/material_usage.mjs` and the material ranking
- [x] Baseline shots and metrics for all four maps (31 of 32: farmhouse wall missing under SwiftShader)
- [x] `docs/art-direction.md` (reference photos still to come)
- [x] Original material sources extracted to `assets-src/material-library-v03.10.json`
- [ ] ⏸ Review of the baseline
- [ ] Reference photos in `docs/reference/<map>/`
- [ ] Decide: allow Poly Haven / ambientCG in this environment, or run Phase 2 locally
- [ ] Phase 1
