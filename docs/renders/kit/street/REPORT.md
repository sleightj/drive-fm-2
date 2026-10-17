# Street kit: render report

The street kit is finished: 43 painted layers, 7 edge types, 60 prop types, the guide-sign gantry, the car park, the empty lot, 20 road marks and 110 preview items. `npx tsc --noEmit` is clean. Every prop is within 400 triangles and every tree within 500. The one exception is the empty lot at 716 triangles (see 1.5).



## 1. Not fully achieved

**1.1 Chain-link at a distance**
- **Problem:** with alpha cutout and GPU mips, the mesh either vanishes beyond about 20 m or turns solid.
- **Tried:**
  1. Clear holes: the mesh vanished at distance and at grazing angles.
  2. A darker haze in the holes: far runs looked like a solid grey wall.
- **Shipped:** holes are painted light mesh-grey at alpha 0.4, just under the cutoff.
  - Up close the mesh is see-through.
  - From about 20 m it reads as a pale chain-link sheen (`chainlink_distance.jpg`, 6–60 m).
- **Real fix (your shader):** alpha-to-coverage, or a cutoff that drops with mip level or distance in `worldMaterial`.

**1.2 Inked lamp glass does not glow in the preview**
- The `lampglass` slot only lights when the actor material's `uState.x` is set, and the preview never sets it.
- Each lamp head therefore also has a world-geometry lens quad facing down, set to emit always. That quad is what glows in the night renders.
- In the game, setting `uState.x = 1` on the prop material at night also lights the inked glass.

**1.3 Shade-side signs pick up the shadow hue**
- `uShadowTint` turns white sign faces faintly lavender and pushes guide-sign blue toward purple when a sign faces away from the sun.
- I offset this with brightness boosts: 1.15× on sign faces, and 1.22× on guide plates, arrow and frame. They still read in shade.
- A proper fix is a retro-reflective term in the shader.

**1.4 Tree canopies are slightly faceted**
- Canopies are painted low-poly blobs with cut-out leaf cards; half the cards are radial, which breaks up the silhouette.
- At 430–455 triangles the outline is still a little faceted from some angles, and the foliage pinches slightly at the crown.
- Texture mapping tried:
  1. Box projection: hard seams.
  2. Cylindrical wrap following the ring twist: shear streaks.
  3. Mapping by angle with whole-number repeats (shipped): the seams and streaks are gone; the crown pinch remains.

**1.5 Empty lot is 716 triangles (18×14 m)**
- I budgeted it as a plot filler under the near-building range (300–2,500). The car park is 374.
- If you want it under 400, cut the weed tufts.

## 2. API notes for the lead

**Signatures you call are unchanged:** `buildProp`, `buildEdge`, `buildWires`, `buildGuideSign`, `buildCarPark`, `buildEmptyLot`, `ROAD_MARKS`, `STRIPS`/`stripU`, `SURFACES`, `SIDEWALK_LAYERS`, `GROUND_LAYERS`/`GROUND_TILES`.

**`stripU(s)` now returns a range inset 2 px on each side:** `[(x+2)/512, (x+w-2)/512]`.
- This stops the yellow tactile column bleeding into the white line at mip distance, which put a yellow fringe on stop lines.
- Callers of `stripU` get it automatically. Code that computes u from `STRIPS` directly should apply the same inset.

**`ROAD_MARKS[name]`** is `{layer, width, length, uv: [u0, v0, u1, v1]}`.
- v0 is the near end and v1 the far end; u0 is the driver's left.
- `buildRoadMark(world, L, name, y = 0.01)` centres the mark on the current origin, with the far end toward +Z and the driver's left toward +X (left-hand traffic).
- Japanese text reads far to near, as painted on real roads.

**Coordinate frames**
- Props have their origin on the ground, with the street side toward +Z.
- Signs face +Z.
- The `lights` and `wireAnchors` returned by `buildProp` are in the prop's own frame (not through `world.m`). Transform them by the prop's placement.
- `buildWires(world, a, b, sag, thick?)` takes anchors in the current WorldGeom frame.

**`buildEdge`**
- Posts sit at each multiple of the post spacing, measured from the start of each polyline, plus one at each end.
- It drops near-collinear, flat polyline vertices to save triangles.
- It returns `lights` (the hoarding work lamps).

**Night lighting**
- Glow appears only through `uLampsOn`.
- These are emissive with emit kind `'always'`: vending machines, the phone box, ads, sign lamps, guide plates, and all lens quads.

**Light colours**

| Name | RGB | Used on |
|---|---|---|
| SODIUM | 1, .62, .28 | arterial, docks |
| WARM | 1, .82, .58 | old town, lanterns |
| LED | .86, .92, 1 | suburb, docks |
| NEUTRAL | 1, .93, .8 | avenue, gantry floods |
| RED | 1, .18, .12 | |
| AMBER | 1, .55, .12 | |
| VEND | .8, .92, 1 | vending machines |

**Prop types added beyond the brief**
- Signs:
  - `sign_slow`, `sign_speed_30`/`40`/`50`/`60`
  - `sign_hairpin_l`/`_r`
  - `chevron_l_y`/`_r_y` (yellow)
  - `sign_noparking`, `sign_nostopping`, `sign_noentry`, `sign_oneway`
  - `sign_roadworks`, `sign_children`, `sign_signal`
  - `works_board`
- Street: `mirror` (curve mirror), `hydrant`, `delineator`, `garbage_station`, `stone_lantern`, `bench`, `cabinet`.
- Docks: `quay_crane`, `quay_bollard`, `drums`, `pallets`.
- `sign_speed` picks a random limit.

**`propStyle.ts`:** I appended three slots (`brown`, `brass`, `teal`), so 17 of 18 are now used.

## 3. Triangle counts

All counts are the maximum over seeds 1–8, painted plus inked geometry.

**Lamps and poles**

| Item | Triangles |
|---|---|
| lamp_arterial | 340 |
| lamp_avenue | 262 |
| lamp_oldtown | 258 |
| lamp_suburb | 94 |
| lamp_docks | 348 |
| utility_pole | 354 |

**Trees and planting**

| Item | Triangles |
|---|---|
| tree_street | 429 |
| tree_cherry | 454 |
| tree_pine | 426 |
| shrub | 132 |
| hedge (per 2 m) | 38 |

**Street furniture**

| Item | Triangles |
|---|---|
| vending_machine | 66 |
| bus_stop | 196 |
| post_box | 96 |
| bicycles | 324 |
| cone | 110 |
| barrier | 72 |
| planter | 112 |
| bollard | 48 |
| phone_box | 78 |
| signal_pole | 188 |
| mirror | 196 |
| hydrant | 46 |
| delineator | 26 |
| garbage_station | 198 |
| stone_lantern | 92 |
| bench | 50 |
| cabinet | 30 |

**Docks**

| Item | Triangles |
|---|---|
| container_stack | 130 |
| gantry_crane | 292 |
| quay_crane | 324 |
| quay_bollard | 50 |
| drums | 120 |
| pallets | 58 |
| shed | 86 |

**Signs**

| Item | Triangles |
|---|---|
| stop, slow | 85 |
| speed, noparking, nostopping, noentry | 150 |
| curve, hairpin | 116 |
| chevrons | 90 |
| crossing | 80 |
| oneway, roadworks, children, signal | 90 |
| works_board | 30 |
| guide sign, span 7 / 14 / 25 m | 270 / 294 / 342 |

**Plots**

| Item | Triangles |
|---|---|
| car park 20×16 (7 slots) | 374 |
| empty lot 18×14 | 716 |

**Edges, per 10 m** (measured on a 40 m curved, sloping run)

| Edge | Triangles |
|---|---|
| guardrail | 189 |
| chainlink | 278 |
| hoarding | 75 |
| woodfence | 230 |
| blockwall | 232 |
| verge | 89 |
| railing | 215 |

## 4. Layers

43 layers, indices 59–101 of 102. Each is a 512² colour map plus a 256² night-glow map.

**Ground and paving**
- #59 st_pave_grey (2.4 m)
- #60 st_pave_brick (1.6 m, basket weave)
- #61 st_pave_stone (3.2 m, granite)
- #62 st_concrete (3 m)
- #63 st_strips: tactile line, tactile dots, kerb, gutter, guard-rail beam, white line
- #64 st_grass (4 m)
- #65 st_scrub (6 m)
- #66 st_earth (5 m)
- #67 st_gravel (3 m)
- #68 st_dock (8 m)
- #69 st_asphalt (6 m)

**Edges and walls**
- #70 st_chainlink (1.2 m, cut-out)
- #71 st_hoarding_a: sea mural, slogan
- #72 st_hoarding_b: kids' town art, graffiti
- #73 st_walls: block wall, plain and with graffiti
- #74 st_fences: yakisugi, louvre, breeze block, railing panel, bamboo
- #75 st_metal: corrugated, girder, hazard stripes, plate, shutter

**Docks**
- #76 st_containers: four fictional liveries
- #77 st_docks: doors, crane cab, tyre, drum, pallet, bollard, keep-out sign, terminal board

**Trees**
- #78 st_leaves, #79 st_blossom, #80 st_pine, #81 st_bark
- #82 st_cards: leaf, blossom, pine and grass cut-out cards

**Prop sheets** (both have night glow)
- #83 st_props_a
- #84 st_props_b

**Road marks**
- #85 rm_text_a, #86 rm_text_b, #87 rm_speed, #88 rm_arrows, #89 rm_symbols

**Road signs**
- #90–92 rs_a/b/c: 27 sign faces plus backs

**Guide signs**
- #93–100 gs_plates_0…7: one plate per place, kanji over romaji, 3 per layer, glowing at night
- #101 gs_board: Y-fork arrow, shield, left and right arrows, frame, back

## 5. Road-mark sizes

Width × length in metres. Text is about 2.5 m per character, with 0.3 m gaps.

| Mark | Size (m) |
|---|---|
| tomare 止まれ | 1.5×8.1 |
| jokou 徐行 | 1.5×5.3 |
| bus バス | 1.5×5.3 |
| school_zone スクールゾーン | 1.5×19.3 |
| slow_down 速度落とせ | 1.5×13.7 |
| bus_only バス専用 | 1.5×10.9 |
| speed_30/40/50/60 | 1.4×3.0 |
| arrow_straight | 0.9×5 |
| arrow_left / arrow_right | 1.3×5 |
| arrow_straight_left / _right | 1.6×5 |
| arrow_left_right | 2.2×5 |
| diamond ◇ | 1.5×4.0 |
| bicycle | 0.9×1.8 |
| zone30 | 2.0×6.0 |
| crosswalk_bar | 0.45×4.0 |

## 6. Review rounds

**Round 0: layer sheets**
- Road marks: arrow heads were too stubby, the bicycle was mis-proportioned and Zone 30 was cramped. All three were redrawn.
- 止まれ overflowed its triangle; refitted.
- Chevrons pointed the wrong way for left-hand traffic; flipped.
- First geometry pass:
  - The utility pole, pine and bicycles were over budget; trimmed.
  - Edge posts appeared at every polyline vertex. They are now spaced along the run, and dense polylines are thinned.

**Round 1: standard renders plus my own close-up cameras**
- Faces drawn back to front:
  - Stop and slow sign faces were invisible.
  - Lamp lenses faced up, so they did not glow from below.
  - Edge posts and pilasters rendered inside out.
  - All fixed. A check of every item's face direction now passes.
- Faces sampling the wrong part of a texture:
  - Posts and pipes showed hazard stripes.
  - The stone lantern and post box bled into neighbouring cells.
  - The guardrail and hoarding backs sampled the whole sheet.
  - All fixed. A texture-region check now passes for every item.
- The hoarding's bottom text strip was buried below the ground; remapped.
- Asphalt showed tile seams and the white line looked cream. Now there are wandering sealed cracks and a pure white line (#f5f5f1).
- Ads glowed as flat colour at night; their glow now uses the dimmed ad art.
- Guide sign: re-laid out and brightened. Other signs got the 1.15× boost.
- Trees: fixed seams, then shear; added radial cards; the autumn ginkgo went from olive to yellow.
- Docks: containers were pastel and are now saturated. Floodlights were added to both cranes, and the shed tarp was softened.
- The arterial lamp's lens was white and is now sodium amber. The phone-box glow was toned down.

**Round 2**
- The road-mark approach lane was mirrored; it now sits on the driver's left.
- Chain-link vanishing at distance: the two hole treatments in 1.1.
- Yellow fringe on stop lines: fixed with the 2 px strip inset.

**Round 3: final renders, close-ups, budget audit**
- The guide-sign gantry was 706–1,146 triangles. It was rebuilt as a lighter truss with 6-sided columns and the lamps tucked under the board, and is now 270–342.
- Everything left is listed in section 1.

## 7. Renders and files

**Committed contact sheets:** 12 JPGs in `docs/renders/kit/street/` (quality 85, 1.6 MB total):
- `edges.jpg`, `props.jpg`, `lamps_poles_lots.jpg`, `wires_lots.jpg`, `trees.jpg`
- `signs.jpg`, `guide_signs.jpg`, `guide_plates.jpg`
- `marks.jpg`, `marks_driver.jpg`
- `docks.jpg`, `chainlink_distance.jpg`

**Files changed:**
- `assets-src/textures/painters/20_street.mjs`
- `assets-src/textures/painters/22_roadmarks.mjs`
- `assets-src/textures/painters/24_roadsigns.mjs`
- `src/world/kit/street.ts`
- `src/world/kit/catalog_street.ts`: edges 13, props 31, trees 10, signs 27, docks 8, marks 21
- `src/world/kit/propStyle.ts`: 3 slots appended