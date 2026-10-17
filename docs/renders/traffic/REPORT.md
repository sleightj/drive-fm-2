# Traffic cars: report

All eight models are built, exported, rendered in Cycles and shot day and night in tools/shoot-asset.mjs. Nothing from the brief was left undone or abandoned after two attempts. Rebuilding is deterministic: a rebuilt taxi GLB came out byte-identical (same sha1). I did not commit, push or call hearthbot, and only wrote inside the allowed paths.

### Limitations to know about (none are model defects)
1. **Accent colour doesn't show in the previewer.** `shoot-asset` only takes `--paint`, so `accent` stays at its dark default. The taxi's cream upper and the box truck's aluminium box therefore look dark navy in `docs/renders/traffic/game/`. They show correctly in the Cycles renders, and in the game once it sets `accent`.
2. **Number plates are blank.** The `plate` slot is used, but the vehicle detail texture isn't wired up, and texcoords aren't exported (same as hero.glb).
3. **No interiors.** The game's glass slot is opaque, so I didn't model any.
4. **Two lamp-slot choices.** The taxi's roof sign (andon) and the box truck's front box markers use the `headlamp` slot so they light up with the lamps. There is no dedicated marker or sign slot. `clearlens` never glows and `indicator` blinks.

### Per-model figures (measured from the exported GLBs)
Tris include wheels. L/W/H in metres, W is body width with the width including mirrors in brackets. wb = wheelbase, r = wheel radius. Track is front/rear.

| model | tris | L × W [mirrors] × H | wb | track | r |
|---|---|---|---|---|---|
| kei_wagon | 4608 | 3.370 × 1.474 [1.680] × 1.640 | 2.360 | 1.290/1.285 | 0.265 |
| kei_truck | 4322 | 3.398 × 1.475 [1.700] × 1.780 | 1.905 | 1.300/1.300 | 0.268 |
| hatch | 4750 | 3.714 × 1.660 [1.840] × 1.500 | 2.400 | 1.430/1.420 | 0.289 |
| sedan | 4852 | 4.584 × 1.720 [1.920] × 1.414 | 2.700 | 1.470/1.460 | 0.315 |
| taxi | 4726 | 4.612 × 1.695 [1.810] × 1.675 (roof 1.505) | 2.680 | 1.425/1.430 | 0.315 |
| minivan | 5208 | 4.731 × 1.800 [2.040] × 1.705 | 2.900 | 1.540/1.540 | 0.325 |
| van | 4734 | 4.720 × 1.690 [2.000] × 1.980 | 2.570 | 1.445/1.425 | 0.330 |
| box_truck | 5006 | 4.740 × 1.690 [2.110] × 2.500 | 2.500 | 1.390/1.220 (twin rear wheels) | 0.330 |

All are within the 2,000–6,000 tri budget and grounded at z = 0. Each has `body`, `wheel_FL/FR/RL/RR` and `lamp_head_L/R` and `lamp_tail_L/R`, and the game previewer reads the same wheel radius and wheelbase. Small departures from the brief's sizes:
- Kei wagon is 3 cm short.
- The kei cars are 0.5 cm narrow.
- The box truck's 4.74 length includes the under-mirror (the under-mirror is the front kerb-view mirror on a stay).

### What the renders showed wrong and what changed
- **All cars:**
  - Early builds were 6,000–7,300 tris. I cut them by using planar caps, lighter wheel covers, fewer bumper path points, adaptive thin strips for shut lines, and pyramid-shaped decal shells instead of slabs.
  - Paint showed through glass because the triangulation didn't match; triangulating the target shells fixed it.
  - Side glass was sometimes missing; offsetting the occlusion ray fixed it.
  - Headlamps landed on the bumpers; I anchored front and rear decals to the body face.
- **sedan:** the rear bumper wrapped past the wheel arch, the nose was low and wedgy with tiny lamps, and the indicator was misplaced. All fixed.
- **hatch:** paint showed through the glass. Fixed as above.
- **kei_wagon, minivan:** the roof spoilers looked like oversized lids, so I shrank them. The wagon's door shut line ran into the wheel arch, so I moved it and guarded the line-drawing against it.
- **kei_truck:**
  - The roof was 1.765, so I raised it to 1.78.
  - The tail lamps were too small in the night chase view, so I enlarged the housing and lenses (the red lens is now about 16 × 13 cm).
- **taxi:**
  - The roof sign and fender mirrors were too small, and the rubbing strip started inside the wheel arch. All fixed.
  - The roof sign stayed dark at night (it was `clearlens`). It now sits across the roof with `headlamp` front and back faces, and glows in the night shots.
- **van:** the door line ran diagonally and the floor slab looked like it was floating. I made the line horizontal and raised the floor.
- **box_truck:**
  - The under-mirror floated 0.5 m ahead of the cab, which pushed the length to 4.92. I moved it to the cab's top corner.
  - In the game shots that mirror's arm read as a stray bar. It now has a bent stay, a brace and a dished mirror head facing back and down.
  - The rear lamps were too small; they are now about 22 × 14 cm.
  - The front box markers blinked because they used `indicator`; they now use `headlamp`.

In the final review all eight silhouettes are clearly different in both lineups. Headlamps and tail lamps glow at night on every model.

### Files
- **Scripts:**
  - `/home/claude/drive-fm-2/assets-src/blender/traffic_cars.py`. Run it with `/home/claude/.venv-bpy/bin/python assets-src/blender/traffic_cars.py [names] [--render] [--lineup [--build]]`.
  - `/home/claude/drive-fm-2/assets-src/blender/traffic_lib.py` holds the shared helpers.
- **GLBs:** `/home/claude/drive-fm-2/public/assets/cars/traffic_{kei_wagon,kei_truck,hatch,sedan,taxi,minivan,van,box_truck}.glb`
- **Cycles renders:**
  - `/home/claude/drive-fm-2/docs/renders/traffic/<name>_{side,front34,rear34}.png`
  - `/home/claude/drive-fm-2/docs/renders/traffic/lineup_side.png`
  - `/home/claude/drive-fm-2/docs/renders/traffic/lineup_34.png`
- **Game previewer shots:** `/home/claude/drive-fm-2/docs/renders/traffic/game/<name>/` holds the day and night turntable, chase and side views, plus `sheet_day.png` and `sheet_night.png`.