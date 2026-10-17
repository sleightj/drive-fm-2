# Buildings, facades and signage: render report

20 near building types, far skyline buildings for all six moods, and their painted textures (59 layers), rendered at dawn, day, dusk and night. The contact sheets here are `downtown.jpg`, `oldtown.jpg`, `midtown.jpg`, `docks.jpg`, `suburbs.jpg`, `edge.jpg` and `street_rows.jpg`. Regenerate with the kit previewer (`tools/kit-preview`).

Code: `src/world/kit/buildings.ts`, `src/world/kit/catalog_buildings.ts`. Painters: `assets-src/textures/painters/10_facades.mjs`, `12_signs.mjs`, `14_graffiti.mjs`.

## Failed after two approaches, and what is still weak

Nothing failed outright after two genuinely different approaches. The closest case was night windows:
- **First version:** the painted emissive came out near white under `uEmitGain` 1.6, so towers read as light boxes.
- **Approach 1:** a flat ×0.6 dim. The windows went dull grey-pink.
- **Approach 2 (current):** `dimEmit` in `10_facades.mjs` dims and boosts saturation (×0.74, sat 1.5; far layers ×0.8). House windows also get a warm tint. Windows now read amber and warm.
- **Still open:** with `uWindowsLit` 0.62, downtown towers look busy at night. About 0.45 downtown may read better; that is your call.

Known weak spots:
- **Preview lighting.** The previewer's sun always sits at z = −0.38, so every +Z street front is in shade (blue or lavender) in all renders. Sunlit faces only show on side walls at dawn and dusk. To compensate I painted albedo bright and saturated, but I have not seen a sunlit front in a preview.
- **Baked light pools are not previewed.** `lights[]` (shop spill, lanterns, porch lamps) is not shown by the kit previewer. Old Town, the temple and the suburbs therefore look darker at night here than they will once you bake the lights.
- **Some types are under 300 triangles.** Their detail is painted, and I did not add padding geometry:
  - machiya without a lantern string: ~120–190
  - kanban shop without lanterns: ~110–160
  - konbini: ~150–210
  - house: ~150–280
  - workshop: ~110–145
  - farm shed: 62–206
  - mixed block: from 136
- **Lanterns are the most expensive part:** about 60 triangles each, so a string of 6 costs about 360. Lower the ring count first if Old Town chunks run heavy.
- **Glass-tower crown band:** the coloured band with a glowing strip only reads from a distance or at an angle.
- **Kura and the temple** are fine by day but quiet at night.
- **Texture memory:** my 59 layers cost about 100 MB of VRAM at full resolution (512 px albedo + 256 px emit, with mips).

## Types and triangle counts

Counts come from 80 seeds per type at random sizes; heights are the values `buildBuilding` returns.

| type | moods (weight) | width × depth m | floors | tris min–median–max | height m |
|---|---|---|---|---|---|
| glass_tower | downtown 3 | 16–26 × 16–26 | 12–30 | 296–398–610 | 65–142 |
| office_setback | downtown 3, midtown 0.6 | 18–32 × 16–28 | 8–20 | 252–354–582 | 38–83 |
| zakkyo_tower (blade signs, rooftop billboard) | downtown 4, midtown 1.2 | 7–13 × 12–20 | 6–11 | 248–474–656 | 26–45 |
| pachinko_hall (neon) | downtown 1.5, midtown 0.4 | 16–28 × 18–30 | 3–5 | 222–254–278 | 20–30 |
| machiya | oldtown 5 | 5.4–9.1 × 10–16 | 2 | ~120–600–850 | 8–9 |
| kanban_shop | oldtown 2.5, midtown 0.5 | 5.5–9 × 9–14 | 2–3 | 110–154–680 | 8–12 |
| kura (accent) | oldtown 0.8 | 5–8 × 7–10 | 2 | 328–390–514 | 8–10 |
| temple_gate (accent) | oldtown 0.35 | 11–16 × 12–18 | 1 | 728 | 8–9 |
| mixed_block | midtown 4, downtown 1 | 10–20 × 12–20 | 4–8 | 136–278–540 | 17–37 |
| mansion | midtown 3, suburbs 0.6, downtown 0.5 | 14–30 × 10–16 | 4–11 | 308–600–1086 | 16–36 |
| konbini | midtown 1, suburbs 0.8, edge 0.5, docks 0.3 | 15–21 × 18–25 | 1 | 146–186–212 | 7 |
| small_office | midtown 2, downtown 0.8, docks 0.6 | 8–14 × 10–16 | 3–5 | 142–250–326 | 14–20 |
| warehouse | docks 4, edge 0.4 | 20–40 × 24–40 | 1 | 224–298–348 | 9–13 |
| port_office | docks 1.5 | 10–18 × 9–14 | 2–3 | 206–240–278 | 16–20 |
| cold_storage | docks 1.5 | 20–36 × 20–34 | 1 | 320–386–468 | 16–23 |
| house (gable / hip / box; carport) | suburbs 6, edge 1.5 | 7–12 × 10–16 | 2 | 152–198–276 | 7–9 |
| apaato | suburbs 2, midtown 0.8 | 11–18 × 8–11 | 2 | 200–242–296 | 8 |
| farm_shed | edge 3 | 6–12 × 6–10 | 1 | 62–64–206 | 4–6 |
| workshop | edge 2, docks 1, suburbs 0.4 | 8–14 × 10–16 | 1–2 | 108–132–144 | 6–8 |
| greenhouse (extra) | edge 1.5 | 6–9 × 15–30 | 1 | 150–198–246 | 3–4 |

Every type is under the 2,500-triangle cap.

Far buildings (`buildFarBuilding`), over 200 seeds:

| mood | tris |
|---|---|
| downtown | 18–44 |
| midtown | 18–32 |
| oldtown | 14–16 |
| docks | 16–58 |
| suburbs | 14 |
| edge | 6–16 |

All are within the 80-triangle budget.
- **Downtown and midtown:** a shell of glass, office or apartment wall. Some downtown buildings get a setback crown, a rooftop box, a red beacon mast or a lit billboard.
- **Old Town:** a koshi or mushiko shell under a kawara gable, sometimes with a lantern band.
- **Docks:** a corrugated or sandwich-panel shed with a lit clerestory, a container stack, or a crane silhouette when height > 30.
- **Suburbs:** a house with a gable roof.
- **Edge:** a shed or a greenhouse.

Windows sit on whole texture repeats, so at night they light per window.

**Removed on purpose:** the `container_yard` and `gantry_crane` types I first had. They duplicated the street kit's `container_stack`, `gantry_crane` and `quay_crane` props, and the crane's preview name clashed with theirs. The docks far skyline still draws crane silhouettes and container stacks, which is the only remaining use of my `dock_container` layer. My vending machines are attached to buildings; the street kit has free-standing ones.

## Layers (59)

The 9 cutout layers are marked "(cutout)". The builder writes cutout and opaque layers into the same `WorldGeom`, so the chunk builder must split them by `manifest.cutout`.

**`10_facades.mjs` (38 layers)**
- **Window walls**, lit per window: `fac_curtain_a` (blue glass), `fac_curtain_b` (teal), `fac_curtain_c` (gold mirror, new), `fac_office_band`, `fac_office_punch`, `fac_mansion_a`, `fac_mansion_b`, `fac_zakkyo`.
- **Balconies and walls:** `fac_balcony`, `fac_wall_plain`, `fac_wall_tile`.
- **Shopfronts:** `shop_a` to `shop_e`, ten fronts that are always lit at night.
  - konbini and ramen
  - izakaya and cafe
  - salon and pachinko
  - shutter and bakery
  - lobby and drugstore
- **Old Town:** `fac_koshi` (lit), `fac_mushiko` (lit), `fac_plaster`, `fac_namako`, `fac_wood`.
- **Docks and edge:** `fac_corrugated`, `fac_sandwich`, `fac_rolldoor`, `fac_whwin` (lit).
- **Suburbs:** `fac_siding`, `fac_mortar`, `deco_house` (cutout).
- **Roofs:** `roof_kawara`, `roof_metal`, `roof_flat`, `roof_bits` (its glow swatches are lit at night).
- **Details:** `deco_cut` (cutout), `dock_container`, `ground_lot`.
- **Far:** `far_office`, `far_apart`, `far_glass`.

**`12_signs.mjs` (16 layers)**
- `sign_blade_a` and `sign_blade_b`: 16 vertical Japanese blade signs.
- `sign_band_a`, `sign_band_b` and `sign_band_c`: 24 shop band signs.
- `sign_bill_a`, `sign_bill_b` and `sign_bill_c`: 6 fictional billboards.
- `sign_neon_a` and `sign_neon_b`.
- `sign_tenant`.
- `sign_awning` (cutout).
- `sign_lantern`.
- `sign_company` (cutout).
- `sign_flash`.
- `sign_vending`.

All signs light at night.

**`14_graffiti.mjs` (5 layers, all cutout):** `graf_tags`, `graf_throws`, `graf_piece_a`, `graf_piece_b`, `graf_stickers`.

## Render rounds

**Round 1**
- **Window speckle.** The window hash took interpolated varyings. You fixed it with pcg3d, and I confirmed the fix. I now write integer seeds 0–63 and restore `world.seed` after each building.
- **Night windows near white:** fixed with `dimEmit`.
- **Recessed shopfronts invisible.** Office slab, zakkyo, mixed block, mansion entrance and small-office garage were affected: the backdrop wall at z = 0 covered the recessed shopfront. I added facade sessions: inside `walls()`, tiled walls on the facade plane are deferred and drawn with every opening cut out. Shopfronts, lobby doors, roller doors and bike recesses register their openings.
- **Glass-tower podium.** The side read as a dark untextured slab and there was a gap above the side shops. Fixes:
  - a lighter granite palette
  - one backdrop with openings
  - shops wrapping round the front corner
- **Downtown all one blue.** Fixes:
  - the gold glass layer
  - accent-coloured fins and corner piers
  - a coloured crown band with a glowing strip
- **Old Town lanterns unreadable:** string lanterns are now 0.48 m tall instead of 0.36 m, with cords.
- **Kanban shop.** The roof's barge boards cut diagonal lines through the false front. The roof now starts behind the false front, has no end overhang, and its rise is capped under the parapet.
- **Suburbs monotone.** Fixes:
  - a more saturated siding palette
  - houses get a second ground-floor window, downpipes, a meter box, an AC unit, and a third upper window on wide fronts
  - the preview seeds now show gable, hip with carport, and box
- **Greenhouse** read as a dark blue block. It now has brighter film and no dark-foot gradient on the end walls.
- **Duplicates:** container yard and crane removed.

**Round 2**
- **Wrong neon:** the pachinko hall showed a 酒 OPEN panel. Its neon is now limited to game, manga and karaoke, with no repeats.
- **Inverted geometry.** I probed 60 seeds per type for inverted boxes and negative-size quads. The mansion stair house could come out inside-out, and a futon decal could get a negative width. Both are fixed. Corner piers were rewritten.
- **Machiya:** a big door lantern is now guaranteed when there is no lantern string, and lantern caps were trimmed.
- **Small office:** now has floor ledges, an entrance canopy and a rooftop stair house.
- **Height ranges:** declared ranges now match built heights for glass tower, port office, temple, mixed block and cold storage.

**Round 3 (final):** every mood at all four times and all views, plus the rows. No new issues beyond the weak spots above. Dusk reads best.

## Integration notes

**API**
- `buildBuilding(world, inked, L, { type, width, depth, floors?, seed })` returns `{ lights, height }`.
  - It is deterministic from `seed`.
  - It does not use `inked`.
  - Lights are in the building's local frame: `{ x, y, z, r, g, b, radius }`, with colours in linear 0–1.
- `pickBuildingType(mood, u)` picks a type by weight.

**Placement info on `BuildingTypeDef`**
- `corner`, `forecourt` (kept inside `depth`), `sideGap` (0 means a shared party wall), `maxRun`, `accent.minSpacing` and `notes`.

**Sidewalk projections**
- Awnings, sign boxes, blade signs and lanterns can hang up to about 1.1 m past z = 0, above 2 m.
- A machiya's big door lantern hangs to 1.6 m, 0.6 m out from the wall.
- Larger cases are in the type notes: the glass-tower entrance canopy reaches 2.6 m, and the temple gate roof 1.3 m.

**Preview catalog**
- Group `<mood>` holds each type under its first mood, plus a far-skyline row.
- Group `<mood>-row` holds a weighted street row, for the `wide` view.

Because the street kit's items share the mood groups, re-render my items with `--items`.