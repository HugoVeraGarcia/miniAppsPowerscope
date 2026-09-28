# PowerScope — portable power station comparison site (Amazon.com affiliate)

Part of SpecVersus: https://powerstations.specversus.com (sister of scooters.specversus.com and robotvacuums.specversus.com).
Static, data-driven site. Every page is generated from the data files.

```
data/products.json   ← power station database (generated first by tools/make_products.py; edit directly afterwards)
data/site.json       ← brand, categories, buying guides, calculator settings
data/matchups.json   ← head-to-head pages (/vs/)
data/raw_notes.md    ← raw notes captured from each Amazon listing (Sep 27 2026)
tools/build.py       ← generator: python3 tools/build.py → dist/ (appliance list for the calculator lives here: CALC_APPLIANCES)
src/assets/          ← CSS, JS (comparator, runtime calculator, compare tray), favicon, _headers
netlify.toml         ← Netlify build settings (Netlify runs the build on every push)
```

## Rules the data follows
- `affiliate_url` is the Amazon affiliate link exactly as given (tag `powerscope-20`, checked by the build).
- Missing specs are `null` and display as "—". Nothing is estimated; conflicting sources are noted in `specs_extra`.
- Scores: capacity, output, solar and portability are formula-based (see /how-we-rate/); charging, battery life and value are editorial.
- Runtime calculator (/calculator/) runs in the browser: energy = W × hours × qty × duty cycle; usable = rated Wh × 85%;
  surge check = biggest motor start on top of everything else; solar = 4.5 sun hours × 75% panel output.
