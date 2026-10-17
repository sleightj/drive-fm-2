# DRIVE FM front end: render report

Renders of every front-end state at 1920×1080 (`desktop/`), 390×844 (`portrait/`) and 844×390 (`landscape/`), plus one contact sheet per size (`sheet_*.jpg`). Regenerate with `node tools/shoot-ui.mjs` (add `--png` for lossless, `--dpr 3` for phone-density shots). The interactive preview is `tools/ui-preview/index.html` under Vite. It has a panel that steps through every state. URL parameters such as `?state=pause&scene=night&mode=pad` jump straight to one state.

## Not achieved, and caveats

No item failed after two approaches. These are the limits of what was checked:

- **Real road and real devices were not tested.** The renders show a canvas stand-in scene (sky, skyline, road and a parked car) behind the UI, not the three.js road. The see-through centre of the title and the dimming in the pause menu were judged only against that stand-in, in day, dusk and night versions. Touch input was driven by synthetic multi-pointer events, which included sliding between the pedals and holding steer and gas together. It has not been tried on a physical phone.
- **Entrance animations are not in the stills.** The shots use `animations: 'disabled'`, so each one shows the settled end state. Under SwiftShader the browser is too slow to capture motion in real time, so the logo entrance (DRIVE slaps on, then FM sprays on as a soft slanted pass from left to right) was checked by scrubbing the Web Animations timeline frame by frame. The scrubbing tool is a scratchpad script, not part of the repo.
- **Load time was measured as bytes, not timed on a throttled network.** The preview runs on the Vite dev server with unbundled modules, so timing it would not reflect production. The shipped UI is about 27.6 KB over the wire, which is under 0.2 s on a 1.6 Mbps link. The fonts load through `FontFace` with `display: 'block'` and are tiny.
- **Gamepad glyphs follow the Xbox layout only** (A/B/X/Y, LT/RT/RB), which matches the standard mapping in `src/input/input.ts`. PlayStation players see Xbox letters.
- **The logo is baked in.** The logo is inline SVG in `frontend.ts` between `/*LOGO-BEGIN*/` and `/*LOGO-END*/`. It was generated from the OFL outlines of Dela Gothic One ("DRIVE") and Sedgwick Ave Display ("FM") in `assets-src/fonts/` by the scripts in `tools/logo/`.

## Bytes added

| file | raw | gzip | brotli |
|---|---:|---:|---:|
| `frontend.js` (minified build of `src/ui/frontend.ts`) | 47,344 | 15,848 | 13,710 |
| `frontend.css` (minified) | 23,164 | 6,170 | 5,525 |
| `public/ui/bungee.woff2` (A–Z 0–9 punctuation ← ↑ → ↓) | 3,824 | n/a | n/a |
| `public/ui/dotgothic.woff2` (A–Z 0–9 punctuation) | 1,800 | n/a | n/a |
| **total** | **76,132** | **27,642** | |

The JS includes about 17.7 KB raw of logo SVG (DRIVE 3.1 KB, FM tag 14.5 KB) and the controls diagrams, which are generated in code. The UI uses no images, no external requests and no CDNs.

## States

- **boot-05 / boot-45 / boot-90**: a dark synthwave card with a neon perspective road (magenta edges, cyan dashes, horizon glow). The logo sits at the top. Below it is a tuner-style progress box: an FM dial from 76 to 95 with a pink needle and a cyan trail that sweep across as loading progresses, the current step label (▸ ROAD / CITY / CARS, always uppercased) and a percentage. `bootDone()` fades the card out over 0.7 s.
- **title-day / title-dusk / title-night**: the logo in the upper third, the road visible through the middle, and PRESS START near the bottom (white Bungee with an ink outline and a pink drop shadow, blinking at 1.2 s). A faint scanline and vignette layer leaves the centre clear.
  - The logo: "DRIVE" is a die-cut chrome sticker (a blue-to-white chrome gradient with a magenta extrusion, an ink outline and a cream border). "FM" is a lime spray tag in Sedgwick hand-style, crossing the bottom of the sticker. It has a smoky ink halo, mist, speckle overspray, tapered drips, shine marks and an underline flick.
  - Any key, click or tap starts the game. Ctrl/Alt/Meta combinations are ignored.
- **title-reduced-motion**: with `prefers-reduced-motion`, PRESS START is shown steadily without blinking, and the logo float, slap, spray and twinkle are off.
- **pause-day / pause-graphics-night / pause-gamepad-dusk**: the road is dimmed behind a left-aligned stack. A pink PAUSE sticker sits on top of slanted dark bars: RESUME, GRAPHICS and CONTROLS. The selected bar turns lime with a ▸ marker. GRAPHICS shows HIGH / LOW / VERY LOW chips, with the active chip in pink. Left and right arrows on GRAPHICS cycle the level and wrap round. A hint row shows keycaps for the current device: keyboard (↑↓ SELECT, ←→ CHANGE, ENTER OK, ESC RESUME) or gamepad (D-pad, Ⓐ OK, Ⓑ BACK).
- **pause-touch-day / pause-graphics-touch-night** (phones): the same menu, centred and larger. Each chip is a 44 px tap target, and the hint row and arrows are hidden on coarse pointers.
- **controls** (desktop) and **controls-keyboard / -gamepad / -touch** (phones): a cream card with a slanted lime CONTROLS sticker.
  - On desktop the card has three columns. The keyboard column shows a WASD/arrow cluster labelled GAS, STEER and BRAKE / REVERSE, with SPACE HANDBRAKE, SHIFT BOOST, R RESET and ESC / P PAUSE. The gamepad column shows a controller drawing with leader lines to its labels. The touch column shows a landscape phone with the real touch layout.
  - Phones use tabs (top tabs on portrait, side tabs on landscape). Portrait phones get tall versions of each diagram: the gamepad gets a glyph legend and the touch diagram gets a portrait phone.
  - BACK, Esc or a tap outside the card closes it and leaves the game paused.
- **drive-boost-day / drive-boosting-night / drive-full-dusk**: the only UI while driving is the boost meter. It is a 4 px line 3 px above the bottom edge (respecting the safe area) on a faint dark backing. It fills outward from the centre, with an ink outline and a cyan glow, and small bright tips mark the ends.
  - While boosting it turns hot orange and pulses. When full it brightens.
  - It shows no numbers. Updates only touch `transform` and `translate`, and classes toggle only when the state changes. `setBoost` costs about 1.4 µs per call (100k calls in 136 ms).
- **touch-day / touch-active-night** (phones): the left half of the screen is the steer pad. A ring and knob re-centre under the thumb, with a small dead zone. Tall ribbed BRAKE and GAS pedals sit at the right edge, with round HANDBRAKE (lever) and BOOST (lightning) buttons above them. Small RESET and PAUSE buttons sit top right. In the active shot the ring glows cyan, GAS is filled lime and BOOST is lit orange.
  - A finger can slide between the pedals and buttons, but not onto RESET or PAUSE.
  - The controls appear on the first touch and hide on any keyboard input.

## What changed after each look

1. **First full shoot.**
   - The DRIVE sticker border and the FM ink outline were thin and uneven, because the strokes were in scaled glyph space. I baked the scale into the path coordinates.
   - The logo was missing on the boot card, so the constructor now syncs it.
   - Menu and chip text was tiny because `.dfm button { font: inherit }` outranked the item styles. I moved the reset into `:where()`.
2. **Controls card, desktop and landscape.**
   - The gamepad leaders and labels collided with the controller at 1.1×. I set the controller to 1.0× and moved the label columns.
   - The X→BOOST leader crossed the grip, so it now runs straight down to a bottom label.
   - The touch diagram's PAUSE label read as BOOST's. I rerouted that leader and gave every label a halo.
   - The layout checker flagged the boost tips as offscreen, which was a false positive, so it now skips them.
3. **Portrait phones.**
   - The wide diagrams were illegible at 390 px, so I added tall versions (400×520).
   - Two preview bugs were fixed: the controls tab parameter was applied relative to the device's default tab, and the touch states were navigated by keyboard, which showed keyboard hints.
4. **Tidy pass.** All tall diagrams now share one height. I removed leftover labels in the tall touch diagram, tightened the gamepad legend and fixed the preview's favicon 404.
5. **Full sheets at all three sizes.**
   - The handbrake icon read as a bone or wrench, so I redrew it as a lever with a pull arrow.
   - Landscape PRESS START was oversized, so its size is now capped by viewport height.
   - The boost line showed through the pause dim, so it is now hidden in boot, title and pause.
   - DotGothic has no ▸, so the boot label marker is now drawn in CSS.
   - On a bright road the boost line was nearly invisible and its tips were half offscreen. I lifted it 3 px and gave it a dark backing and an ink outline.
   - Renders switched to JPEG q90.
6. **Entrance motion (scrubbed frames).**
   - The FM clip-path wipe looked like a hard slide. I replaced it with a soft, slanted airbrush mask that sweeps after DRIVE lands.
   - The first scrub seemed to show the mask not applying. That was a scrubbing artefact: finished animations without forward fill drop out of `getAnimations()`. After restarting the animations before scrubbing, the sweep showed up correctly.
   - The sweep's end position moved from 22% to 3%, so the M no longer snaps from half-sprayed to solid at the end.
   - I re-subset Bungee with ←↑→↓ for the pause hint keycaps (+196 B).

The final shoot covers 42 state shots with no layout issues and passes all 14 behaviour checks:
- title start, including with Shift
- Esc pauses
- arrow keys cycle, persist and wrap the graphics level
- the controls card opens and closes
- Esc resumes
- a mouse click on RESUME resumes
- focus never lands on our buttons
- gamepad confirm and back work
- setBoost timing

## Integration notes

- **Keyboard.** While the title or pause menu is up, `FrontEnd` handles the keyboard in the capture phase on `window` and stops propagation of the keys it uses, so the game's `Input` never sees them. Keyups are never consumed, so keys held across a pause release cleanly.
- **Gamepad.** Forward navigation with `menu()`. Start (button 9) should go in as `'confirm'` on the title and `'back'` while paused. B (button 1) maps to `'back'`.
- **Start and resume.** `start()` and `resume()` hide their own layer before calling the handler, so calling `hideTitle()` or `hidePause()` again is harmless.
- **Touch state.** `touch.reset` is held while the finger is down, and `input.ts` already turns that into a single press. `onTouchPause` fires when the touch PAUSE button is pressed.
- **Graphics setting.** It persists in `localStorage['drivefm.graphics']` (default `'high'`), with every access wrapped in try/catch. `fe.graphics` is valid from construction, so the game can apply it before the first frame.