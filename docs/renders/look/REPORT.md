# Screen effects and look: report

Code: `src/render/post.ts`, `sky.ts`, `environment.ts`, `worldMaterial.ts`, `src/vehicle/camera.ts`,
`src/world/moodLook.ts`. Contact sheets: `npm run shoot:moods` (`tools/shoot-moods.mjs`) into
`docs/renders/moods/`. Before/after sheets for each change are in this folder.

## Post chain per level

| level | render scale | what runs | extra draws | calls measured (same view) |
|---|---|---|---|---|
| HIGH | 1.0 | half-float HDR scene target, bloom 5 levels (bright-pass, 4 down, 4 up), one final pass: FXAA, bloom, hue-keep, sRGB, grade, vignette, speed lines, dither | +10 | 251 → 261 |
| LOW | 0.85 | 8-bit scene target, bloom 3 levels from dusk to dawn only, FXAA | +6 night, +1 day | 163 day / 170 night |
| VERY LOW | 0.6 | straight to the canvas; grade and dither inside each material | +0 | 98 |

Render targets: HIGH scene + 5 down + 4 up; LOW scene + 3 down + 2 up; VERY LOW none.
Estimated post cost on an Iris Xe at 1080p (not measured: no GPU here): HIGH ≈ 1.0–1.2 ms,
LOW ≈ 0.3–0.5 ms, VERY LOW ≈ 0.05 ms.

## What changed
- Speed lines in the final pass (no extra draw): from 78 km/h, full at 125, stronger while boosting.
- Camera: vertical FOV 72° at rest, +11° by top speed (smoothed), +8° while boosting.
- Sky: painted two-tone clouds, sun and moon where they really are, stars, area haze above the horizon.
- Dawn repainted (pale gold, lilac mist) instead of a copy of dusk; darker night palette; each area's
  haze shows as a horizon glow and a faint shadow tint at night; bright lights keep their hue at night.
- Signs stay readable in shade and catch headlights; far chain-link stays a faint mesh; office
  windows thin out through the night (46 % lit) while homes and shops stay at 62 %.

## Gaps
- GPU time is estimated, not measured (no GPU in this sandbox); measured on real hardware with `?bench`.
- Docks and downtown sit close in colour at night (ΔE 3.1) and twilight (4.3); they still read apart
  by their buildings. Old town and edge are close at dawn, dusk and evening when the sky fills the frame.
- Blob shadows (car, people, traffic) look lighter at HIGH and LOW than at VERY LOW, because blending
  happens in linear light there and in display space at VERY LOW.
- three's built-in materials (the blob shadows) don't get the VERY LOW in-material grade (tiny effect).
