# DRIVE FM

An endless drive through a stylised Japanese coastal city, in the browser.

**Play:** https://sleightj.github.io/drive-fm-2/

| | keyboard | gamepad | touch |
|---|---|---|---|
| steer | ← → / A D | left stick | drag on the left half |
| gas / brake, reverse | ↑ ↓ / W S | RT / LT | GAS / BRAKE pedals |
| boost | Shift | X / RB | BOOST |
| handbrake | Space | A | HANDBRAKE |
| reset onto the road | R | Y | reset button |
| pause | Esc / P | Start | pause button |

Graphics level (HIGH / LOW / VERY LOW) is in the pause menu and is remembered.

## Development

```
npm install
npm run dev            # http://localhost:5173
npm run build          # type-check and production build into dist/
```

URL options (for tests and the benchmark): `?seed=N`, `?gfx=high|low|verylow`, `?time=day|dusk|night|…|hour`,
`?mood=downtown|oldtown|midtown|docks|suburbs|edge` (start district), `?auto` (autopilot),
`?bench` (benchmark route and overlay, see below).

### Checks

| command | what |
|---|---|
| `npm run test:road` | road generator, 100 km × 5 seeds: gaps, self-crossings, grades, elevation, hard turns and their signs |
| `npm run test:drive` | autopilot drives in the real game, 100 km × 3 seeds: on-road, stalls, memory flat, errors |
| `npm run test:perf` | frame budgets on the benchmark route under SwiftShader: JS time, world-build spikes, calls, triangles |
| `npm run bench:world` | world building in Node: job costs, worst frames, footprint overlaps, memory per km |
| `npm run test:handling` | top speed, acceleration, braking, reverse, drift, pothole, air |
| `npm run test:load` | load time by phase on the production build |
| `npm run test:frontend` | title, pause menu, live graphics switch, level remembered |

### Benchmark

Open `https://sleightj.github.io/drive-fm-2/?bench` (add `&gfx=low` or `&gfx=verylow`). The autopilot drives a fixed
route downtown at dusk for 90 s; the overlay shows frame time, JS time, GPU time (where the browser exposes timer
queries), draw calls and triangles, then a PASS/FAIL summary against the level's budgets (HIGH: 14 ms per frame at
1080p). For a reading above the display's refresh rate, start Chrome with `--disable-gpu-vsync --disable-frame-rate-limit`.

Design: [docs/DESIGN.md](docs/DESIGN.md) · progress: [docs/PROGRESS.md](docs/PROGRESS.md)
