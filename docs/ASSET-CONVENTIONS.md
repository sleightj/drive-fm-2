# Asset conventions

Every actor asset (hero car, traffic cars, people) is authored by a script, exported to
glTF binary (`.glb`) and shaded at runtime by the game's own cel shader
(`src/render/actorMaterial.ts`). The glTF materials are **only labels**: the game reads
each material's *name* and maps it to a palette slot. Colours, lighting, ink outlines,
lamp glow and night behaviour all come from the game shader, so assets must not rely on
Blender shading, baked lighting or PBR maps.

## Units and axes

- Metres. Blender is Z-up; export with the default glTF settings (`+Y up`), so a model
  whose nose points to Blender **-Y** ends up facing **+Z** in the game.
- In the game: forward `+Z`, up `+Y`, the car's left is `+X`, right is `-X`.
- Origin of vehicles: on the ground plane (`y = 0` where the tyres touch at rest), centred
  between the axles in Z and on the centre line in X.
- Apply all transforms before export (no unapplied scale/rotation on meshes).

## Geometry

- Closed, manifold-ish shells wherever possible: the ink outline is an inverted hull
  extruded along *smoothed* normals, so open edges and paper-thin single faces show gaps
  in the ink. Thin parts (wing blade, mirrors, spokes) should have real thickness.
- Flat shading is set per face by the author (`shade_flat`/`shade_smooth` + "auto smooth"
  by angle, or split edges). The game keeps exported normals for lighting and computes its
  own smoothed normals for the ink.
- Triangulate on export is fine (the game only needs triangles).
- No textures are required. One optional texture per asset is allowed for painted details
  (a `detail` atlas, see below).

## Material names → slots (vehicles)

| name        | use                                                    |
|-------------|--------------------------------------------------------|
| `paint`     | main body colour (white on the hero, varied on traffic)|
| `accent`    | second paint colour (two-tone taxis, stripes, bumpers) |
| `trim`      | black plastic, rubber seals, grille surrounds, wipers  |
| `glass`     | windows (dark, glossy; rendered opaque)                |
| `metal`     | chrome, exhaust tips, bright metal                     |
| `tyre`      | tyres                                                  |
| `rim`       | alloy wheels / steel wheels                            |
| `headlamp`  | headlamp lenses (glow at night)                        |
| `taillamp`  | red tail/brake lamp area (glows, brighter on braking)  |
| `indicator` | amber indicator lenses                                 |
| `clearlens` | clear-lens housings (silver/clear tail and side lamps) |
| `reverse`   | white reverse lamp                                     |
| `interior`  | dashboard, seats, cabin (seen through glass)           |
| `plate`     | number plate (uses the `detail` texture when present)  |
| `grille`    | dark mesh grilles / intakes                            |
| `underbody` | chassis underside, wheel arch liners                   |
| `detail`    | anything that samples the optional detail texture      |

## Vehicle nodes

- `body` — everything that moves with the sprung body (paint, glass, lamps, wing…), one
  mesh object (multiple materials allowed).
- `wheel_FL`, `wheel_FR`, `wheel_RL`, `wheel_RR` — one mesh object per wheel (tyre + rim),
  object origin exactly at the hub centre, axle along the object's local X axis.
  FL = front left = `+X` side in the game.
- Empties (exported as nodes) marking light emitters: `lamp_head_L`, `lamp_head_R`,
  `lamp_tail_L`, `lamp_tail_R`, placed at the visual centre of each lens. Optional
  `lamp_fog_L/R`.
- Custom properties are not needed; the game measures wheel radius and track from the
  wheel nodes.

## People

- One skinned mesh per variant, one armature, glTF skin + animations exported.
- Bones (names exactly): `root`, `hips`, `spine`, `chest`, `neck`, `head`,
  `shoulder.L/R`, `upper_arm.L/R`, `forearm.L/R`, `hand.L/R`, `thigh.L/R`, `shin.L/R`,
  `foot.L/R`, `toe.L/R`. Extra bones allowed for gear (e.g. `bag`), none required.
- Facing `+Z` in the game (Blender `-Y`), feet on `y = 0`.
- Animations (actions exported as glTF animations, names exactly): `walk`, `walk_fast`,
  `skate`, `idle`. Loops are seamless. Root motion is **not** baked into the root bone
  (the game moves the character); record the intended ground speed of each loop in the
  report.
- Material names → slots: `skin`, `hair`, `top`, `top2`, `bottom`, `shoes`, `accent`,
  `gear` (headphones, bags, skates), `detail` (samples the shared detail atlas: faces,
  logos, stripes). The game recolours `hair`, `top`, `top2`, `bottom`, `shoes`, `accent`,
  `gear` per person from curated palettes, so model the *shapes* for variety and leave
  colour variety to the palettes (export sensible default colours anyway).
- Triangle count 1,000–3,000 per variant, measured on the exported mesh.
