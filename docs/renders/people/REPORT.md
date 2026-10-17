# Pedestrians: report

All 14 variants are built, exported and checked. Nothing had to be dropped. These are the problems still open, all small:

### Open issues (all minor)
- **Single-frame foot pops.** In `walk`, three variants with big boots (puffer, twintails, punk) can move a foot up to about 11 mm in one frame. It happens at toe-off and touch-down, about 2 mm off the ground. The skate wearers (hoodie, roller, jersey) move about 6.8 mm in walk and 7.6 mm in walk_fast, because they land flat-footed. Everyone else stays under 1.6 mm in walk and under 1.1 mm in walk_fast. Average slide is 0.09–0.25 mm, and idle is about 0.01 mm. I measured this on the exported skinned mesh, at 132 points per cycle.
- **Feet dip slightly into the ground.** The lowest point of a sole goes 0.5–3.5 mm below ground during walking. Big boots no longer sink: punk was −21.9 mm before the fix.
- **Skate clip on every file.** Every GLB includes a `skate` clip so all the files share one clip set. Only use it on variants with `skates: true` in people.json (hoodie, roller, jersey).
- **Your preview tool doesn't show palettes.** `tools/shoot-asset.mjs` uses the PERSON_STYLE default colours. The real per-variant colours are in the GLB materials and in `people.json → palettes`.
- **three renames the bones.** On load it strips the dots (`foot.L` becomes `footL`), so look bones up by the renamed form or with a regex.

### Export choice: one GLB per variant
The files are `public/assets/people/person_<name>.glb`. I split them because:
- each variant has its own proportions and gear bones;
- the animations are solved per variant with IK so the feet stay planted, so the clips can't be shared;
- one combined file would have had to carry 14 skeletons with 14 sets of clips anyway.

All variants share one rest pose (an A-pose with the arms 65° below horizontal) and one 27-bone skeleton. Your `loadPeople(url, slots)` in `src/render/actorAssets.ts` works on each file as it is and returns one variant per file. All 14 files total 4.5 MB.

`people.json` lists:
- the atlas, fps and slot order;
- each clip's length and speed;
- for each variant: file, triangle count, height, whether it skates, and 4 palettes (the default plus 3 alternates, with matched slots such as suits and uniforms kept together).

### Triangles (measured on the exported mesh, all within 1,000–3,000)
| Variant | Triangles |
|---|---|
| bomber | 2754 |
| hoodie | 2988 |
| longcoat | 2692 |
| schoolgirl | 2354 |
| salaryman | 2436 |
| roller | 2896 |
| puffer | 2506 |
| tracksuit | 2802 |
| dress | 2484 |
| courier | 2642 |
| elder | 2576 |
| twintails | 2482 |
| punk | 2432 |
| jersey | 2706 |

### Bone check
I re-checked all 14 exported GLBs with a script.
- **Skeleton:** 27 joints each. The first joint is `root`, and every required name from ASSET-CONVENTIONS.md is present.
- **Extra bones:** every file has the same five, so the skeleton is identical across variants.
  - `bag` and `tie` hang off `chest`.
  - `hair`, `hair.L` and `hair.R` hang off `head`.
- **Who uses them:**
  - `bag`: briefcase, skateboard, tote, satchel, delivery box.
  - `hair` bones: ponytail, long hair, twin tails.
  - `tie`: salaryman's tie.
- **Skinning:** at most 3 bone influences per vertex, weights sum exactly to 1, and every vertex has UVs.

### Clips (30 fps, no root motion)
`root` is constant in every clip, and `hips` only moves up and down on average. The last frame of each loop matches the first exactly.

| Clip | Frames | Length | Ground speed | Notes |
|---|---|---|---|---|
| `walk` | 33 | 1.1 s | 1.30 m/s | stride 1.43 m |
| `walk_fast` | 24 | 0.8 s | 2.0 m/s | stride 1.6 m |
| `skate` | 48 | 1.6 s | 3.5 m/s | push, recover, glide; arms swing |
| `idle` | 120 | 4.0 s | 0 | weight shift, looks around, some variants check a phone |

### How the atlas is used
The atlas is `detail.jpg`, 512×512 RGBA, where alpha is coverage and see-through pixels have black RGB. It works with your shader rule `mix(slotColour, detail.rgb, detail.a)`.
- **Faces:** half-face tiles, mirrored across the face over the skin colour. There are 12 face styles.
- **Logos:** printed onto thin one-sided sheets laid over the clothing, which keeps the outline pass from drawing around them:
  - bomber: lightning bolt on the back
  - hoodie: kanji on the chest, tag on the back
  - roller: star on the bib
  - punk: tag on the tee
  - jersey: "07" front and back
  - courier: "DLV" on the delivery box
  - dress: cat print on the tote
- **Shoe stripes:** projected onto the shoes for bomber, courier and twintails.
- **The `detail` material** only covers the phone screen and the skateboard graphic.
- **Everything else** points at a blank, see-through tile at glTF UV (0.9375, 0.875), so it shows the plain slot colour.

### What the renders showed was wrong, and what I changed
- **Wrong colours in my test renders.** The test page was using the default style colours, so it now reads the GLB material colours.
- **Hair looked like pyramids or boxes.** Hair now follows the true curve of the head, the hairline only hugs the cheeks low down, and rows are evenly spaced so the crown stays round.
- **Logos cut off at tile edges.** Logos moved to the separate print sheets, sized up 1.7× so "07" fits.
- **Hoodie over 3,000 triangles (3012, then 3092).** Trimmed hem and collar detail, the headphone band and two hair clumps; it is now 2988.
- **Shorts poked through the hoodie hem.** Widened the hem and the bottom of the torso.
- **Hands in pockets sat on the belly.** Lowered the pocket targets and turned the hands properly. The same fix went into the strap, shoulder-carry and hands-behind-back poses.
- **Suit shoulders had humps.** Changed the sleeve shape and squared off the shoulders.
- **Skateboard graphic on the wrong side and not mapped.** It is now a print sheet on the wheel side.
- **Toes scraped the ground in early swing (−15 mm) and big boots sank (−21.9 mm).** Foot height is now worked out from the actual sole of each shoe mesh. The swing foot lifts to clear the ground, and the standing foot rises whenever the sole would go underground.
- **The "bright" face looked shocked.** It now has a wider upturned grin.
- **My first slide measurement found no foot vertices** because of the bone renaming in three; fixed.
- **Lineup render was cropped;** re-framed.

### Files
- **Build scripts:** `assets-src/blender/people.py` and `assets-src/blender/people_lib.py`. They build everything from scratch, give byte-identical output on every rebuild, and take about 10 s for all 14.
- **Assets:** in `public/assets/people/`:
  - `detail.jpg`
  - `people.json`
  - 14 GLBs: `person_{bomber,hoodie,longcoat,schoolgirl,salaryman,roller,puffer,tracksuit,dress,courier,elder,twintails,punk,jersey}.glb`
- **Renders:** in `docs/renders/people/`:
  - `lineup_front.jpg`: default colours
  - `lineup_34.jpg`: alternate palette, 3/4 view
  - `crowd_a.jpg`, `crowd_b.jpg`: 30 people on the sidewalk, mixing walk, walk_fast, idle and skate
  - `anim_walk_1.jpg`, `anim_walk_2.jpg`: all 14 walking
  - `anim_walk_fast.jpg`
  - `anim_skate.jpg` (side) and `anim_skate_34.jpg` (3/4)
  - `faces.jpg`: all 14 heads, front and 3/4

I wrote only inside the allowed paths, made no commits, and called no hearthbot tools. The other changes in the working tree come from the other agents.