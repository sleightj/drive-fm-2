# Pedestrians in the game: report

Code: `src/people/` (people.ts draws, crowd.ts decides, walknet.ts reads the sidewalks, anim.ts bakes
clips, catalog.ts holds limits). Check: `npm run test:people` (Node, `tools/people-check.ts`).

## What is built
- A pool of 40 skinned people made at load and never added to; each is 2 draws (colour + ink hull)
  culled by a bounding sphere, plus one instanced draw for all contact shadows (at most 81 draws).
- 14 variants of 2.35k–2.99k triangles, palettes from `people.json` with a small brightness change
  per person. Clips baked to bone matrices at 30 fps with cross-fades; poses update every frame
  under 35 m, every 2nd under 75 m, every 3rd beyond, never out of view.
- Walkers both ways at clip speed, brisk walkers, skaters (skate variants only), loiterers, groups
  and bus-stop waiters. People steer between lanes, wait and turn round at block and sidewalk ends,
  follow slopes, turn their heads at a fast car close by and keep off the kerb when it passes.
- Density per mood (people per m² of walk): downtown 0.07, old town 0.05, midtown 0.045,
  suburbs 0.016, docks 0.008, edge 0.005.
- Limits per level (cap / live radius / far ring, m): HIGH 40/185/150, LOW 22/175/145,
  VERY LOW 10/165/140. The level is read live from the pause menu.
- People appear or leave only out of view, or beyond the far ring with a 0.7 s dither fade.
  Every move is checked: inside the walk band, clear of obstacles and other people, at least the
  kerb band plus their radius from any road.

## Verified (`tools/people-check.ts`, checked every frame)
- 0 failures in every run: on road, on kerb, in an obstacle, overlapping, off the band, over
  budget, spawning or leaving in view, popping.
- HIGH, seeds 1/2/3, 10 km each (49,196 frames each): 519–1,004 fade-ins, 0 pops; heap after a
  full GC 23–28 MB with 0 % growth from km 5 to km 9.
- Seed 7, 30 km, level switched every 5 km: heap 24 → 28 MB (+3.7 % from km 5 to km 29).
- LOW seed 5: at most 22 people. VERY LOW seed 6: at most 10.
- Crowd cost in Node with 40 people (minimum of 3 runs, seed 1, 10 km): mean 0.058 ms,
  p95 0.13 ms, p99 0.21 ms, p99.9 0.61 ms. Allocation 3.5–8 KB per frame.
- People per mood (mean / max): downtown 23–39 / 40, midtown 10–25, suburbs about 10,
  docks 1–11, edge 0.1–5.

## Gaps
- Sidewalks don't connect across forks yet: the last chunk before a fork is not built
  (`chunks.ts`, `c1 = floor(end/50) − 1`), so people turn round there.
- Obstacles are circles guessed from radius; lamps and bins can't be told apart, and benches and
  shelters have no length.
- No shop doors, building fronts or crossings: nobody crosses a road, and idlers stand along the
  walk rather than at doors.
- Lowering the graphics level drops surplus people at once (out-of-view ones first); 7–12 per run
  can pop in view.
- Old town density depends on the route: many old-town roads have no walk of 1.2 m or more.
- Frame time in the browser was not measured as a verdict (the sandbox has no GPU and was
  overloaded); the `?bench` overlay measures it on real hardware.
