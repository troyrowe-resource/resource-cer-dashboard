# Build status

**Status: COMPLETE - all tests passing, production build clean, deployable.**

Last verified end to end on the uploaded CER files (data as at 30 Apr 2026).

## Test results

| Suite | Tool | Count | Result |
|-------|------|-------|--------|
| Data pipeline | `node --test` | 10 | PASS |
| Aggregation / maths | `node --test` | 8 | PASS |
| Build / deploy / resilience | `node --test` | 7 | PASS |
| **Unit + integration total** | | **25** | **PASS (x2 runs, no flakiness)** |
| End-to-end UI | Playwright (`tests/e2e`) | 7 specs | Authored + CI-ready; verified in-session via the harness browser (see NOTES) |
| Accessibility (axe, WCAG 2A/2AA) | axe-core | main view | 0 violations (24 passes) |

Type-check (`tsc --noEmit`): PASS. Lint (ESLint, no `any`): 0 errors, 0 warnings.
Production `next build`: clean. First Load JS for `/`: 114 kB (MapLibre lazy-loaded, not in the initial bundle).

## Reproduce (on a normal machine or CI)

```bash
npm install
npm run fetch:geo      # one-time: AU state polygons + postcode centroids
npm run build:data     # parse CER xlsx -> public/data/*.json
npm run verify:data    # prints totals + runs consistency checks
npm run lint           # ESLint
npx tsc --noEmit       # type-check
npm test               # 25 unit/integration tests (Node >= 22.18 for native TS)
npm run build          # production build (prebuild regenerates the data)
npm run test:e2e       # Playwright e2e + axe (after: npx playwright install chromium)
```

> Note on this build environment: the session ran inside a packaged-app sandbox that
> cannot spawn `.exe` binaries from `node_modules` (esbuild, browsers) or `cmd.exe`, so
> `npm run <script>`, `tsx`, Vitest and the Playwright browser could not execute here. The
> scripts were run directly via `node` (Node 24 has native TypeScript), the unit suite via
> Node's built-in `node:test`, and the UI/a11y verified via the harness browser preview.
> All of this runs normally on your machine and on Vercel. Details in NOTES.md.

## What exists (audit vs the Step 2 spec)

Everything in the spec is implemented with **real CER data** - nothing stubbed or placeholder.

**Data pipeline** (`scripts/build-data.ts`, run via `prebuild` -> `build:data`)
- Parses the 4 mandatory CER workbooks; reads only `SGU-Solar` + `SGU-Battery`.
- Header rows detected by content (not fixed index); month columns parsed semantically.
- Stitches ONE continuous solar series Apr 2001 -> latest (2001-2010 detail + 2011-present monthly).
- Reconciliation asserts: per-postcode 2001-2010 sum == Historic Total column; national stitched
  total == file Total column, for BOTH installs and capacity. Fails loudly on drift.
- Battery series Jul 2025 -> latest (no invented history). Units kept distinct (kW solar / kWh battery).
- Emits `public/data/{data,postcodes,meta}.json`; `verify:data` cross-checks.

**App** (Next.js App Router + React + TypeScript + Tailwind, dark ReSource theme)
- SOLAR/BATTERY toggle; state multi-select; time range (from/to + presets ALL/10Y/5Y/1Y/YTD);
  metric (Installs/Capacity/Avg size).
- 4 KPI cards (incl. latest **complete** month - provisional months excluded from the headline).
- MapLibre choropleth + postcode heat overlay (token-free, lazy-loaded, degrades gracefully).
- Charts: monthly time series (trailing provisional months flagged), by-state bar, average-size
  trend, cumulative capacity, and the vintage / waste-arisings projection with an editable
  lifespan slider.
- Caveats surfaced in-UI (STC 12-month window, units, pending-vs-approved).
- Accessible: keyboard-operable filters/bars, ARIA, headings, AA contrast, axe-clean.

**Known totals (integrity anchors, asserted in tests)**
- Solar 2001-2010: 283,311 installs / 506,527 kW. Solar national: 4,402,670 installs / 29.3 GW.
- Battery (Jul 2025 - Apr 2026): 343,874 installs / 9.42 GWh / ~27.4 kWh average.

## Open items

None blocking. A few low-priority notes (e.g. postcode 0200 -> OTHER kept exactly per the
supplied mapping function) are recorded in NOTES.md.
