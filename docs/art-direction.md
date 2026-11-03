# Art direction: Desert Vanguard graphics overhaul

What "real" means for each map: the target every phase is judged against in the shots
(`shots/<phase>/`). Values marked *from the map file* are what the game uses today (`data/maps/<map>.json`,
`environment`). Change them here first, then in the map file.

**Reference photos are still missing.** Put 5–10 photos per map in `docs/reference/<map>/` (real places that look the
way you want: your own photos, or links to photos you are allowed to use). Each section below lists what the photos
should show. Until they arrive, the critique in `docs/graphics-progress.md` is against the written brief only.

## Rules for every map

- **Texel density:** 512 px per metre for anything within arm's reach (walls, floors, props under 2 m); 256 px/m is
  acceptable for roofs, ground beyond 10 m and backdrop. A 1024 texture with `uv_scale` 2 is exactly 512 px/m.
- **Scale checks:** doors about 2.05 m, people about 1.8 m, cars about 4.5 m, steps 0.17–0.2 m (gameplay steps stay
  under 0.42 m), ceilings 2.4–2.8 m (farmhouse) and 2.6–3.2 m (mud houses).
- **Materials:** scanned or photo-sourced PBR only (Poly Haven, ambientCG, or bought). No noise-generated albedo.
  Roughness carries most of the realism: dust is rough, worn paint is rough with smooth chips, glass and wet
  patches are smooth.
- **Wear is local, not global:** dirt collects at the bottom of walls, under sills and windows, in corners and on
  horizontal ledges; paint wears on edges and around handles; floors wear on paths, not uniformly.
- **No pure black or white:** albedo between about sRGB 30 and 240 (fresh snow and coal are the only exceptions).
- **Lighting:** a single strong sun, a sky HDRI that matches it (direction, colour, haze), soft bounce indoors. No
  coloured fill lights that the place would not have.

## Qalat Village: mountain village, central Afghan highlands

- **Time and weather** *(from the map file)*: low afternoon sun (`sun_dir` [-0.72, -0.4, 0.5], warm `sun_color`
  [1, 0.7, 0.42]), dusty haze (fog colour [0.78, 0.62, 0.47]), HDRI `kloofendal_48d_partly_cloudy_puresky`.
- **Palette:** ochre and grey-brown rammed earth and mud plaster, straw flecks, pale dust; deep blue and green
  painted wooden doors and window frames, faded; poplar and apricot greens; distant grey-brown mountains with snow
  above the snow line.
- **Wear:** heavy. Eroded wall bases (the `mud_plinth`), rain streaks running down from roof edges and drain spouts,
  patched plaster, cracks around openings, timber lintels and roof beams sticking out of walls.
- **"Real" means:** walls that are visibly hand-built (uneven, rounded corners, layered plaster), flat roofs with
  parapets, reed and timber ceilings indoors, dust on every horizontal surface.
- **Photos wanted:** qala walls and round towers; a village lane with mud walls and wooden doors; a flat roof with
  parapet and drain spouts; a mud-house interior with reed ceiling; a caravanserai courtyard; the valley backdrop.

## Sarai Bazaar: highway market town, Afghanistan

- **Time and weather** *(from the map file)*: high, bright sun (`sun_dir` [0.48, -0.38, 0.79], near-white
  [1, 0.95, 0.86]), dense dust haze (fog [0.8, 0.72, 0.6]), HDRI `kloofendal_48d_partly_cloudy_puresky`.
- **Palette:** dusty concrete, cement render and mud brick, painted shop shutters (blue, green, red, rusted),
  colourful goods (carpets, fruit, plastic tubs) against a dusty base; jingle-truck colour as accents only.
- **Wear:** medium to heavy. Oil stains and tyre marks on asphalt and dirt, rust on shutters and corrugated roofs,
  posters and painted signs half torn, tangles of electric cables between buildings.
- **"Real" means:** clutter. Crates, sacks, jerrycans, plastic chairs, tarps, AC units, satellite dishes, cables,
  trash at wall bases. The covered bazaar street should feel crowded even without people.
- **Photos wanted:** a covered market street; a carpet market; a roadside fuel station with canopy; a two-storey
  hotel courtyard; HESCO walls; shop fronts with roll-up shutters; a jingle truck.

## Oil Camp: desert oil field, high summer

- **Time and weather** *(from the map file)*: harsh mid-morning sun (`sun_dir` [0.62, -0.5, 0.6], [1, 0.89, 0.72]),
  heat haze (fog [0.86, 0.76, 0.6], the densest of the four), HDRI `syferfontein_1d_clear_puresky`.
- **Palette:** pale sand and gravel; safety yellow, red and green equipment paint, sun-faded; galvanised and
  painted steel; white portable cabins; black oil stains.
- **Wear:** medium. Sand drifts against everything on the windward side, oil and rust around valves and pump jacks,
  faded paint and stencils, sun-bleached plastic.
- **"Real" means:** industrial detail at the right scale (bolts, flanges, handrails, cable trays, labels) and
  wide, flat, hot open ground with heat shimmer and very little shadow.
- **Photos wanted:** a workover rig over a wellhead; pump jacks; a separator plant with pipe racks; storage tanks;
  portable cabins; a flare stack; desert gravel ground.

## Hollister Farm: family farmhouse, Nebraska, late summer

- **Time and weather** *(from the map file)*: afternoon sun (`sun_dir` [-0.55, -0.6, 0.58], [1, 0.86, 0.68]), light
  haze (fog [0.82, 0.78, 0.7]), HDRI `kloofendal_48d_partly_cloudy_puresky`.
- **Palette:** white lap siding with green shutters, dark grey asphalt shingles, red brick chimney, green lawn
  going yellow at the edges, gold wheat and green-gold corn. Indoors: warm oak, soft painted walls (cream, sage,
  blue, rose), white trim.
- **Wear:** light. Lived-in and tidy: scuffed porch steps, worn paths in the lawn and on rugs, slightly faded
  paint on the sunny side, dust on window sills, no grime or decay.
- **"Real" means:** proper depth (window and door reveals, trim that sticks out, porch railings, gutters and
  downpipes), real furniture shapes, fabrics that look soft, warm lamp light against cooler daylight.
- **Photos wanted:** a white two-storey farmhouse with a wraparound porch; a farmhouse kitchen; a family room;
  a bedroom; a mudroom; a gravel driveway with parked cars; corn and wheat fields at the edge of a lawn.
