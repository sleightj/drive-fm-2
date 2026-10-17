# Logo generator

Builds the DRIVE FM title logo (the chrome DRIVE sticker and the sprayed FM tag) as SVG and splices it into `src/ui/frontend.ts` between `/*LOGO-BEGIN*/` and `/*LOGO-END*/`.

Needs Python 3 with `fontTools`. Run from this folder:

```sh
python3 glyphs.py              # extract glyph outlines from assets-src/fonts into glyphs.json
python3 build_final.py final.svg   # build the logo (optional overrides: fs=0.33 kern=-70 ...)
python3 splice.py              # write it into src/ui/frontend.ts
```

Fonts (OFL, in `assets-src/fonts/`): Dela Gothic One for DRIVE, Sedgwick Ave Display for FM.
