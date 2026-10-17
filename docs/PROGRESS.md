# Progress log

Newest first. Each checkpoint is merged to `main`, which deploys https://sleightj.github.io/drive-fm-2/
and proves the live link loads headless (`tools/verify-live.mjs` in the Pages workflow).

## Checkpoint 2 — playable city drive (2026-10-17)

### Done
- **Road**: endless seeded clothoid road with hard-turn events (hairpins, switchbacks, block
  turns, chicanes, tightening corners) and their signs; vertical profile with ±50 m range,
  grades capped per class (back 12 %, avenue 8 %, arterial 6 %), blind crests; three classes
  with lanes, paint, raised medians on arterials, left-hand traffic; Y forks with junction
  noses and blue overhead guide signs; streaming ahead (3.4 km) and trimming behind.
- **Wear**: one wear field drives both the road texture (rasterised tiles near the car) and
  the car's ride (potholes, ruts, cracks); boost is charged by wear and air at speed.
- **Car**: arcade-with-weight model at 120 Hz, chase camera, reset, solid kerbs, medians,
  gore islands and closed road ends; keyboard, gamepad with rumble, touch.
- **City**: six moods by district with roadside frontage (near and far detail), sidewalks,
  lamps, trees, poles and wires, props, road text and marks, baked lamp light; rolling
  terrain from a road-driven land field (5-level clipmap); the city behind the frontage and a
  skyline out to 3 km; barricades where the road ends for good.
- **Front end**: boot card, title with the DRIVE FM logo and sprayed FM tag, PRESS START,
  pause menu (resume, graphics, controls card), graphics level remembered and applied live,
  boost meter, touch controls.
- **Tools**: road checks, world-build bench, perf check, long drive, load check, front-end
  check, handling numbers, benchmark route with overlay (`?bench`).

### Verified
- Road checks, 100 km × 5 seeds (`npm run test:road`): 0 gaps, 0 self-crossings, 0 kinks,
  0 grade violations, elevation −50…+51 m, 21–24 forks per 100 km, every hard-turn type
  present and every one signed.
- Handling (`npm run test:handling`): top speed 111 km/h, 0–100 in 7.8 s, 100–0 in 33.8 m,
  reverse 22.7 km/h, drift held 7.7 s at up to 42° slip without spinning, pothole heading
  change 0.01°, 0.76 s of air off a back-street crest at 90 km/h.
- World building in Node (`npm run bench:world`, 4 km): no frame over 20 ms of world work,
  p95 2–3 ms, 0 footprint overlaps.
- Front end (`npm run test:frontend`): title → driving → pause → HIGH→LOW→VERY LOW applied
  live → resume; the level survives a reload.

### Not working / gaps
- Traffic, pedestrians and the screen effects (grading, dither, AA, bloom, speed lines,
  FOV with speed) are being built and are not in this checkpoint.
- GPU frame time cannot be measured here (software rendering); the `?bench` overlay reports
  it on real hardware.

### Next
- Integrate traffic, people and screen effects; long drives 100 km × 3 seeds in the real
  game; mood × time contact sheets; checkpoint 3.
