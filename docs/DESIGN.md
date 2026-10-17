# DRIVE FM — design

An endless drive through a stylized Japanese coastal city. No score, no timer, no goals:
the car's feel, the city going by, and the day turning. This document is the plan of
record; it is kept current as decisions change (see `docs/PROGRESS.md` for the log).

## 1. Architecture

```
src/
  main.ts            boot → title → drive loop (fixed-step simulation, variable render)
  core/              seeded RNG streams, math, spatial hash, typed ring buffers
  road/              PURE logic, runs in Node: plan (clothoid pieces), vertical profile,
                     cross-sections & lanes, wear features, generator (pacing, events, forks),
                     network (live paths, projection, surface queries), moods/districts
  world/             streaming: chunk builder (road ribbon, kerbs, sidewalks, markings),
                     roadside placement (pure: footprints & choices) + kit geometry,
                     terrain, far skyline, signs, colliders, scheduler (time-sliced build)
  world/kit/         buildings, street furniture, signs (geometry in code, painted textures)
  render/            materials (actor+ink, world, road, terrain, sky, glow), post (bloom,
                     grade, AA, speed lines), environment (time of day), texture loaders
  vehicle/           car physics (rigid body on the height field), visual body springs,
                     camera, lights
  traffic/           lane graph on the road network, IDM following, junction priority,
                     knocks + recovery, out-of-view spawning
  people/            sidewalk crowd: 1-D lanes with weaving, skinned animation
  input/             keyboard, gamepad (+ rumble), touch
  ui/                boot card, title, pause, graphics, controls card, boost meter, perf overlay
  debug/             test API (window.__DRIVE_FM__), autopilot, metrics, benchmark route
tools/               headless Chromium harnesses (long drive, shots, perf, load), previewers
assets-src/          Blender scripts (cars, people), texture painters, fonts
```

**Stack.** three.js r186 + TypeScript + Vite; WebGL2 required (texture arrays). No
physics library: the car and traffic are custom (the road is an analytic surface, so a
general engine would only add cost).

**Loop.** Simulation runs at a fixed 120 Hz (`dt = 1/120`), render interpolates. The world
streamer runs a time-sliced job queue with a per-frame budget (HIGH 4 ms, LOW 3 ms, VERY
LOW 2 ms) and never blocks a frame; jobs are small (one chunk part each). In test mode the
simulation can run N steps per rendered frame; the streamer's budget scales with simulated
time so world building, streaming, traffic and memory behave exactly as in play.

**Floating origin.** Simulation is in float64 world coordinates; everything rendered is
placed relative to a render origin that is re-based every 1 km so vertex data and shader
world positions stay small.

## 2. The road model

**Plan.** The centreline is a chain of clothoid pieces (curvature linear in arc length:
lines, arcs and spirals), integrated into samples every 1 m: position, heading, curvature.
Heading 0 = +Z ("north"); positive curvature turns left. Left-hand traffic: our direction
of travel (increasing s) drives at lateral offset t > 0 (left of the centreline).

**Progress constraint.** Outside hard-turn events the base heading stays within ±70° of
north, so the road makes net northward progress on every few-hundred-metre scale. Hairpins
come in pairs (switchbacks) and block turns alternate direction, so events also return the
heading to the band. Together with an occupancy check against all live road corridors
(spatial hash, corridor = carriageway + roadside depth + margin) this guarantees no
self-crossing and lets far-field skyline cells behind the planning frontier be filled safely.

**Pacing.** The generator alternates *flow* stretches (600–1,800 m: straights, long
sweepers R 250–900 m, S-bends) with *technical* sequences (200–700 m of hard turns), and
inserts a fork every 2.5–4.5 km during flow. Hard-turn types:
- hairpin (180° ± 20°, R 9–14 m) and switchback stacks (2–4 hairpins up a steep climb),
- block turn (80–100°, R 10–18 m),
- chicane (two opposite R 25–45 m kinks within 60 m),
- tightening corner (clothoid into R 20–30 m, 60–120°).
Each is signed: a curve/hairpin warning sign 80–120 m before, chevron boards on the
outside, guard rail on the outside. Their positions are recorded as `RoadEvent`s.

**Road classes.**

| class    | lanes            | lane w | cross-section (kerb to kerb)              | max grade | vertical curve L |
|----------|------------------|--------|-------------------------------------------|-----------|------------------|
| back     | 1 + 1            | 3.0 m  | 6.5 m                                     | 12 %      | 12–30 m (sharp, blind crests) |
| avenue   | 2 + 2            | 3.25 m | 14.0 m                                    | 8 %       | 30–70 m          |
| arterial | 3 + 3 + median   | 3.5 m  | 25.0 m incl. 2.0 m raised median          | 6 %       | 70–160 m         |

Class transitions taper over 80 m (lanes added/dropped on the kerb side, median
introduced behind a hatched taper). Hard turns: hairpins/switchbacks and block turns on
back streets and avenues, chicanes and tightening corners on any class except that
arterials only get tightening sweepers (R ≥ 60 m).

**Vertical profile.** Grades are planned as a sequence of vertical points of intersection
(VPIs) with parabolic vertical curves of class-dependent length, so elevation and grade are
continuous everywhere (no kinks, no steps). The profile is shaped for drama: climbs and
drops of 20–60 m inside 200–600 m, blind crests (short curves on back streets), sag
compressions, long descents; elevation stays inside about ±50 m. Grades are capped per
class (above), at ≤ 6 % inside hairpins and ≤ 4 % through fork junctions and crosswalks.
Air: the ballistic launch speed for leaving the ground on a crest of curvature k is
v = sqrt(g / k); back-street crests of k ≈ 0.012–0.02 m⁻¹ launch at 80–100 km/h.

**Cross slope.** 1.5 % crown; superelevation up to 5 % on avenue/arterial sweepers.

**Forks.** A fork is a Y junction: the trunk widens over 70 m to the combined width of
both branches; at the split the two branch centrelines start side by side, parallel to the
trunk, and diverge with opposite clothoids. The gore is hatched until the edges separate
by 1.5 m, then a raised island with a chevron board. Branch headings are steered into
disjoint sectors (left branch ≥ trunk heading + 15°, right ≤ −15°) for the first 2 km and
both obey the occupancy check. A blue overhead guide sign 180–250 m before the split names
the district each branch reaches next. Both branches are generated to 1.5 km beyond the
split; when the player passes a gore nose on one branch the other is *dead*: it is never
extended, its far chunks are trimmed only when out of view, and if the player drives
back into it, it revives. Left-branch inbound traffic crosses the trunk's outbound flow to
the right branch, so it has a stop line with 止まれ and yields (priority junction).

**Lanes.** Lane centres are functions t_i(s) per path (piecewise smooth through tapers and
junctions). Traffic follows them; lane changes and merges are lateral eases.

**Wear.** Wear is data: a list of features per 50 m chunk of each path, generated from the
chunk seed with intensity from mood × class (Old Town and docks rough, arterials rutted,
suburbs smooth, varied stretch to stretch by a slow noise): potholes (r 0.25–0.8 m, depth
4–10 cm, some holding water), crack networks, wheel-path ruts (1–3 cm), sags (shallow 4–8 cm
over 4–12 m), patched trenches (across lanes, ±1.5 cm, lighter asphalt), sunken manhole
lids (r 0.32 m, 2–4 cm). One function `wearHeight(s, t)` defines the surface offset; the
physics samples it (with a wheel-radius envelope) and the GPU rasterises the same features
into a per-chunk wear texture (height + masks) that the road shader paints and lights.
The CPU and GPU evaluate identical shape functions (shared GLSL/TS ports, cross-checked by
a test that reads back the GPU texture).

**Surface query.** `surfaceAt(x, z)` finds the path(s) whose carriageway contains the point
(projection with a cached last-s hint), returns height = profile(s) + cross slope(t) +
wear(s, t), normal, and the wear component separately (boost charging uses only wear).

## 3. The world along the road

**Moods and districts.** A 2-D field of districts (jittered Voronoi cells 1.5–3 km across),
each with one mood and a name (`src/world/places.ts`). The roadside mood at a point is a
blend of nearby districts within 250 m of a border, so moods last a few kilometres along the
road and blend into each other; the far skyline uses the same field, so Downtown towers rise
on the horizon before you arrive. Fog tint, wear intensity and road-class preferences come
from the mood.

**Roadside placement (pure, Node-testable).** Each side of each chunk is split into frontage
runs (15–80 m) that pick an edge (sidewalk, verge, guard rail, chain-link, hoarding, wood
fence, block wall) and a backdrop (buildings fronting the road, trees, empty lot, car park
with parked cars) by mood weights. Footprints are oriented rectangles; every footprint is
tested against the occupancy hash (all live road corridors including the far side of
hairpins and fork branches, plus other footprints) before it is accepted. Kerb-side street
lamps (per-mood style, 25–35 m spacing, staggered) and street trees. Hard-turn signage and
guard rails come from the road events.

**Solidity.** Collision is 2-D line segments in a spatial hash: kerbs (the kerb line is the
wall), medians, guard rails, fences, building fronts, gore islands, side-street barriers.
The car is a rounded box against segments; contacts resolve with restitution 0.15 and
friction, never interpenetrating.

**Terrain.** The ground beyond the roadside is a height field interpolated from road
elevations (inverse-distance with a road-corridor bench) plus gentle noise, built as tiles
around the camera (LOD by distance), so the city sits in rolling land and every hill the
road climbs is a hill in the land.

**City fill and skyline** (`src/world/skyline.ts`). The land behind the frontage is cut into
160 m blocks, each holding a few far buildings (≤ ~80 triangles, the same painted layers,
lit windows at night) chosen by the district mood: towers downtown, mid-rise midtown, low
roofs in the old town and suburbs, sheds and quay cranes at the docks, almost nothing at the
edge. Every building keeps clear of every known road corridor by more than the roadside's
own depth, so the fill never stands on a road or in the frontage, and steep ground stays
empty. Blocks merge into 480 m tiles (one draw call each) out to the level's skyline radius.
The road is generated kilometres ahead, so a new corridor is known long before it is near:
tiles it touches are rebuilt (old mesh kept until the new one is ready); removed roads
(trimmed behind, an untaken branch) leave their strip empty rather than fill in while in view.

**Closed road ends.** Where the drawn road stops for good (the start of the network, a road
whose trunk was trimmed away, the end of a fork's untaken branch) a barricade of A-frame
barriers, no-entry signs and a works board crosses the lanes, and the car meets a solid wall
there (`RoadGenerator.closedEnds`, `RoadSurface.endDepth`).

**Traffic.** Kinematic lane followers (IDM) on the live paths in both directions; lane
changes for merges and overtakes; branch choice at forks; yield logic at the fork crossing;
the player is an obstacle they slow for. When the player hits one it becomes a 2-D rigid
body (yaw + slide, low restitution), then steers back to its lane. Spawn/despawn only out of
view (outside the frustum, or beyond the fog's 90 % distance, or occluded by terrain/buildings
along the line of sight). Rendered instanced per model with per-instance paint and lamps.

**People.** A few dozen near the player on sidewalk bands; 1-D motion along s with lateral
weaving to pass; walk/skate animations; spawn out of view; never on the carriageway.

## 4. The car

Rigid body (mass 1,250 kg, inertia from a 4.34 × 1.74 × 1.3 m box) with four raycast
suspension points sampling `surfaceAt` with a wheel-radius envelope (so the tyre bridges
small holes and drops into big ones). Tyre forces from slip (longitudinal + lateral,
saturating curves), rear grip reduced by handbrake / power-over / large slip angles into a
plateau that holds long, controllable drifts; yaw and counter-steer assists keep it arcade.
A pothole cannot spin the car: wear-induced lateral force spikes are clipped and yaw-rate
change from a single wear impact is capped.

The visual body sits on a second, soft spring layer (roll/pitch/heave driven by the chassis'
accelerations) so it leans, squats and dives; wheels show the stiffer suspension travel.

**Targets (measured by `tools/handling.mjs`, logged in PROGRESS.md):**

| metric | target |
|---|---|
| top speed (flat, no boost) | 110 km/h ± 3 |
| 0–100 km/h | 7.0–8.5 s |
| 100–0 km/h braking distance | 30–36 m |
| reverse top speed | 20–26 km/h |
| drift: held body slip angle in a steady drift | 20–40°, held ≥ 2.5 s, 0 spins |
| pothole hit at 100 km/h | heading change ≤ 6°, 0 spin-outs over 100 km |
| air off a back-street blind crest at 90 km/h | ≥ 0.45 s |
| air on avenue crests at 100 km/h | ≤ 0.35 s; arterials none |
| boost gain | full meter in 25–45 s of rough-road driving at ≥ 70 km/h, or ~3 big jumps; 0 from cornering-only and from wear below 25 km/h |
| boost spend | full meter ≈ 3.5 s; shove +5 m/s² fading; boosted top speed 140 km/h |

## 5. The look

- **Actors** (car, traffic, people, lamp posts, sign gantries): `actorMaterial` — two light
  bands with a crisp terminator, shade colour = base × a strongly hued shadow tint (purple /
  teal by time of day), cel glint, sky rim, lamp emissives; **ink** = inverted hull along
  smoothed normals, 3.5 px at 1080p (scaled by resolution), thinning with distance.
- **World** (buildings, walls, props): `worldMaterial` — painted texture arrays, wide soft
  sun wrap, vertical gradient (darker + more saturated at the base), shadow-hue pooling,
  baked lamp pools at night (vertex light), emissive windows (randomly lit per window) and
  neon. No ink.
- **Road**: procedural flat graded asphalt + crisp anti-aliased lane paint (from lane data) +
  decal marks (Japanese text, arrows, crosswalks) + the wear texture (darkened, lit by its own
  height normal, puddles reflecting the sky) + lamp pools + headlights.
- **Sky**: graded dome (zenith/horizon/sun glow), sun and moon discs, stars, painted
  clouds; fog colour from the time of day tinted by the area's mood.
- **Day/night**: 12-minute day (30 s per game hour) through dawn, day, dusk, evening,
  twilight, night; key-light from sun or moon; street lamps, windows, neon, headlights and
  tail lights switch on through dusk.
- **Post (HIGH/LOW)**: HDR target → bloom (threshold + mip chain) → grade (saturation push
  over greys, contrast, lifted tinted shadows) → light dither → FXAA. VERY LOW grades inside
  the materials and draws glow sprites instead of bloom.
- **Camera**: very wide (base 78° vertical at rest, +14° with speed, +10° boosting),
  speed lines from ~85 km/h and while boosting.
- **Shadows**: few and soft. Actors get a soft blob contact shadow; on HIGH the car and
  nearby actors also cast a filtered shadow map onto the road only.

## 6. Graphics levels and budgets

Budgets are sized for an Intel Iris Xe (96 EU ≈ 2.0 TFLOPS, ~60 GB/s shared) or GTX 1650
(3.0 TFLOPS, 128 GB/s) at 1920×1080, 14 ms per frame, and are enforced by
`tools/perf-check.mjs` on the benchmark route (max over the route, busiest area with traffic).

| budget | HIGH | LOW | VERY LOW | reasoning |
|---|---|---|---|---|
| render scale | 1.0 | 0.85 | 0.6 (≤ 720p) | fill-rate and bandwidth |
| draw calls | ≤ 650 | ≤ 420 | ≤ 260 | ANGLE/D3D11 ≈ 6–10 µs CPU per draw → ≤ 5 ms at HIGH |
| triangles | ≤ 1.2 M | ≤ 700 k | ≤ 320 k | ~2 vertices/triangle non-indexed world mesh; ≤ 3 M vertex invocations at HIGH ≈ 1 ms |
| texture memory | ≤ 200 MB | ≤ 110 MB | ≤ 56 MB | shared memory on Iris Xe/phones; arrays halved on LOW/VERY LOW |
| fragment cost (est. ALU ops × shaded px) | ≤ 900 M | ≤ 450 M | ≤ 150 M | ≈ 0.9 ms at 1 TFLOP effective; overdraw ≤ 1.8 |
| post | bloom 5 mips + FXAA | bloom 3 mips half-res + FXAA | none | ≈ 1.2 ms / 0.5 ms / 0 |
| actor shadow map | 2048² | — | — | |
| traffic cars | ≤ 48 | ≤ 30 | ≤ 16 | instanced, 2 draws/model |
| people | ≤ 40 | ≤ 22 | ≤ 10 | 2 draws each (skinned) |
| near city radius | 1,100 m | 800 m | 500 m | chunks ahead |
| skyline radius | 3,000 m | 2,200 m | 1,400 m | city fill + skyline tiles; tall towers still read through the fog at 3 km |
| world-build slice | 4 ms | 3 ms | 2 ms | no frame over 20 ms from world building |
| JS frame time | ≤ 7 ms | ≤ 6 ms | ≤ 5 ms | leaves ≥ 7 ms for the GPU process |

The headless browser here renders with SwiftShader (software). GPU time cannot be measured
meaningfully there, so verification uses the budgets above (automated), direct CPU frame
and world-build timing, and an in-game benchmark route + overlay that reports GPU timer
queries (`EXT_disjoint_timer_query_webgl2`) where available, else uncapped frame intervals.

## 7. Front end

Boot/loading card → title (DRIVE FM logo with "FM" as a sprayed graffiti tag, blinking
PRESS START over the live road, camera drifting behind the parked car, scanlines and
vignette) → any input fades into driving. Pause: RESUME, GRAPHICS (HIGH/LOW/VERY LOW,
remembered in localStorage), and a controls card. No HUD except the boost meter: a thin
glowing line along the bottom edge that fills from the centre, no numbers.

Controls: keyboard (arrows/WASD, Space handbrake, Shift boost, R reset, Esc/P pause),
gamepad (triggers, stick, A handbrake, X/RB boost, Y reset, Start pause; rumble on bumps,
landings, collisions and boost), touch (left half steer pad, right-side pedals, boost and
handbrake buttons).

## 8. Test plan

| check | tool | runs in |
|---|---|---|
| road generator: 100 km × 5 seeds — gaps, self-crossings, building/road overlaps, building/building overlaps, grade per class, elevation range, every hard-turn type present and signed | `npm run test:road` (`tools/road-check.ts`) | Node |
| long drive 100 km × 3 seeds — autopilot, all systems; errors, NaN frames, frames off road, overlapping traffic, people on the road, building collisions, memory (heap, geometries, textures) km 5 vs km 100 within 10 %; renders every frame for the first ≥ 5 km, then 8 sim steps per frame | `npm run test:drive` (`tools/long-drive.mjs`) | headless Chromium |
| handling numbers | `npm run test:handling` | headless (sim only) |
| look: every mood at dawn/day/dusk/evening/twilight/night on HIGH; day/night on LOW/VERY LOW; contact sheets per mood | `npm run shoot:moods` | headless |
| assets: car turntables, traffic, crowd close-ups, people triangle counts | `tools/shoot-asset.mjs` | headless |
| performance budgets, world-build slice times, benchmark route | `npm run test:perf` | headless |
| load to driving by phase on the production build | `npm run test:load` | headless + CI |
| live link | `tools/verify-live.mjs` in the Pages workflow | GitHub Actions |
