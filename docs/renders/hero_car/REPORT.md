# Hero car: report

The hero car is finished and exported. Nothing was impossible, so there is no can't-do note. It is a white liftback coupe at **14,926 triangles** and passes the previewer: all five nodes plus six lamp empties, and the exact material names. The build is deterministic: two separate builds gave byte-identical glb files.

### Files
- `/home/claude/drive-fm-2/assets-src/blender/hero_car.py` — builds from an empty scene and exports the glb.
  - Run: `/home/claude/.venv-bpy/bin/python assets-src/blender/hero_car.py [--out PATH] [--blend PATH] [--cycles DIR] [--stats] [--dump-lines FILE.json]`
  - The body is a loft of authored profile curves running nose to tail, with crisp creases where those curves meet, bulges over the axles and Coons-patch end caps.
  - The arches and the front intake are cut with booleans. A weld pass afterwards removes the slivers the cuts leave.
  - Lamps, lines, wing, mirrors and the other details are small closed shells projected onto the body.
  - Hard edges are split at material boundaries and wherever faces meet at more than 40°.
- `/home/claude/drive-fm-2/public/assets/cars/hero.glb` (383 KB).
  - Nodes: `body`, `wheel_FL/FR/RL/RR`, `lamp_head_L/R`, `lamp_tail_L/R`, `lamp_fog_L/R`. All are root nodes with no rotation, and every transform is applied.
  - Each wheel's origin is the hub, with the axle on local X. The right-hand wheels are turned 180° in the mesh data itself.
  - Materials: paint, trim, glass, metal, headlamp, taillamp, indicator, clearlens, reverse, plate, grille, underbody, tyre, rim.
  - The body is closed: no non-manifold or open edges, no duplicate faces, and Blender's mesh check passes.
- `/home/claude/drive-fm-2/docs/renders/hero_car/shape/` — Cycles shape renders at 960×600:
  - eight turntable angles every 45° (camera 7 m out, 1.2 m up)
  - chase, an orthographic side silhouette and title
  - orthographic top, front and rear views
  - a contact sheet, `sheet_shape.png`
- `/home/claude/drive-fm-2/docs/renders/hero_car/game/` — final renders from `tools/shoot-asset.mjs`, day and night, at 1280×800:
  - turntable8, chase, side, title, front and close-up
  - contact sheets `sheet_day.png` and `sheet_night.png`

### Triangles
| Part | Triangles |
|---|---|
| Body shell | 5,768 |
| Headlamps | 1,156 |
| Tail lamps | 1,104 |
| Fog lamps, plates and reflectors | 432 |
| Door lines, handles and fuel door | 744 |
| Arch lips | 584 |
| Exhaust | 124 |
| Wing | 342 |
| Mirrors | 352 |
| Wipers | 40 |
| Bumper lips | 328 |
| **Body total** | **10,974** |
| Wheels | 4 × 988 |
| **Total** | **14,926** |

### Dimensions measured from the export
| Measure | Value |
|---|---|
| Length | 4.335 m |
| Width with mirrors | 1.982 m |
| Width without mirrors | 1.764 m |
| Height | 1.313 m |
| Wheelbase | 2.60 m |
| Track | 1.50 m |
| Wheel radius | 0.31 m |

Width without mirrors is about 2.4 cm over the 1.74 target, because the arch flares and lips add to it.

Lamp positions in game coordinates (x, y up, z forward):
- head: (±0.642, 0.573, 1.952)
- tail: (±0.539, 0.83, −2.022)
- fog: (±0.585, 0.29, 1.998)

### What each round of renders showed, and what changed
1. **First shape renders.** It read as a sedan: flat roof, too wide at 1.77 m. I moved the windscreen base to −0.95 and the screen top to −0.12, made the roof one continuous arc into the hatch, gave the side windows a teardrop shape and trimmed the width.
2. **Next two rounds.** The nose and tail looked blunt from above. I rounded the nose into a wedge by pulling its corners back, and rounded the rear corners.
3. **Lines plot.** The hood had a W-shaped wobble. It now has a convex crown with a crisp fender crease, and I lowered the arch centres.
4. **First pass through the game shader.** Creases vanished in the shade, because the ink draws only silhouettes. I raised the shoulder crease and set the waistline in so it catches light, enlarged the flares, then added the full detail pass.
5. **Over budget.** It reached 18,266 triangles, with slit-like headlamps and small tail lamps. I made the lamps bigger, added a dark rear diffuser band, and cut triangles:
   - simpler round lamp lenses and 24-segment wheels
   - fewer bumper-lip points and fewer body cross-sections
   - lighter arch cutters
   - no lug nuts
6. **Proportion fixes.** Mirrors and exhaust were too big and the tail-lamp housings were boxy. I shrank them and tapered the inner edge of the tail lamps.
7. **Headlamp lenses.**
   - The amber indicator had a zig-zag edge, which I fixed with more samples.
   - The door lines broke into dashes, also fixed with more samples.
   - By day the headlamp lens was white on white, so I added a dark lower band that runs on from the amber indicator.
   - The headlamps now read by day and still glow as almonds at night.
8. **Rear quarter, in the title view.** The fuel door read as a stray bracket; it is now a dark shut-line plate with a paint door on top. The red tip of each tail lamp sank under the domed clear lens and showed only as two thin lines; it now follows the dome and reads as a solid red point, day and night.
9. **Export warning.** The export warned that the mesh was invalid. The cause was a duplicate sub-millimetre face left by an arch boolean. A weld and clean-up pass now runs after every boolean.

### What I couldn't get right
- **No reference images.** The egress proxy blocked them, so proportions come from published specs (4,335 × 1,735 × 1,315 mm, 2,600 mm wheelbase, 205/50R16) rather than blueprints.
- **Close-up shading.** The two-band shader shows some soft blotches on the front fender and hood, from smooth normals on a low-poly surface. They aren't noticeable at chase or title distance.
- **Door lines.** They follow the body crease, so the rear one has a small jog at the shoulder. They and the fuel door are thin raised shells, not cut into the body.
- **Tail lamps.** They are clear-lens housings with twin red rounds and a red wraparound tip, closer to the clear-lens aftermarket style than the original all-red lamps.
- **No interior**, because the glass is opaque.
- **Floor cost.** The floor still uses a fair share of the shell budget, because the dissolve keeps every vertex along the rocker edge.
- **Harmless export errors.** Blender prints Draco/MeshOptimizer "library not found" errors on export; they don't affect the file.
- **Stray cache file.** My debug import briefly wrote `assets-src/blender/__pycache__/hero_car.cpython-313.pyc` outside my allowed paths. I deleted it. The other `.pyc` files there belong to other agents.

Nothing was committed, no hearthbot tools were used, and I wrote only to the three allowed paths, apart from that cache file.