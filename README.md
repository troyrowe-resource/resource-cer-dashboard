# ReSource - Solar and Battery Installations Dashboard

An interactive dashboard visualising Clean Energy Regulator (CER) data on Australian
rooftop **solar** and home **battery** installations. A single SOLAR / BATTERY toggle
reshapes the whole view; filter by state/territory, time range and metric (installations,
capacity, average system size). It surfaces KPI cards, an Australia choropleth with a
postcode heat overlay, a monthly time series, average-system-size and cumulative-capacity
charts, and a signature **installation-vintage / waste-arisings** projection - older
installs approaching end-of-life become future recycling feedstock.

Built for ReSource (re-source.au). Stack: **Next.js (App Router) + React + TypeScript +
Tailwind CSS**, deployed to **Vercel**. Charts are hand-built SVG (no charting dependency);
the map is **MapLibre GL JS** (no API token).

---

## Prerequisites

- **Node.js 20 or newer** (the build uses Node's `tsx` runner and Next.js 15).
- npm (bundled with Node).

## Quick start (local)

```bash
npm install            # install dependencies
npm run fetch:geo      # one-time: download AU state polygons + postcode centroids
npm run build:data     # parse the CER xlsx in data/cer/ into public/data/*.json
npm run dev            # start the dev server at http://localhost:3000
```

`fetch:geo` only needs to be run once (and again only if you want to refresh the map
geometry). `build:data` runs automatically before every production build (see below), so
for local development you just need to run it once after a data change.

## Scripts

| Script | What it does |
|--------|--------------|
| `npm run dev` | Next.js dev server (http://localhost:3000) |
| `npm run build` | Production build. Runs `build:data` first (via the `prebuild` hook), then `next build` |
| `npm start` | Serve the production build |
| `npm run build:data` | Parse `data/cer/*.xlsx` -> `public/data/{data,postcodes,meta}.json` |
| `npm run verify:data` | Print parsed totals + "data as at" and run consistency checks. **Run this before pushing a refresh** |
| `npm run fetch:geo` | One-time download of `public/geo/aus-states.geojson` and `data/geo/postcode-centroids.json` |

## Project structure

```
resource-cer-dashboard/
├── data/
│   ├── cer/                      # source CER xlsx (the 4 mandatory files)
│   └── geo/postcode-centroids.json  # postcode -> [lng,lat] (from fetch:geo)
├── public/
│   ├── data/                     # generated JSON (data.json, postcodes.json, meta.json)
│   ├── geo/aus-states.geojson    # state polygons (from fetch:geo)
│   ├── brand/                    # ReSource logos  (drop-in slot - see below)
│   └── fonts/                    # Lato
├── scripts/
│   ├── build-data.ts             # the CER parser / aggregator  (the data pipeline)
│   ├── verify-data.ts            # refresh sanity-check
│   └── fetch-geo.mjs             # one-time geo asset fetcher
├── lib/                          # types, postcode->state mapping, aggregation + formatting
├── components/                   # Header, FilterBar, KPI cards, charts/, map/, Dashboard
└── app/                          # Next.js App Router (layout, page, globals.css)
```

---

## Data pipeline

`scripts/build-data.ts` parses the CER "Small-scale installation postcode data" workbooks
and emits clean, typed JSON. The browser never parses xlsx - everything is precomputed.

It uses **four mandatory files** in `data/cer/`:

| File | Provides |
|------|----------|
| `sres-postcode-data-installations-2011-to-present-and-totals.xlsx` | solar + battery installs, 2011-present monthly |
| `sres-postcode-data-capacity-2011-to-present-and-totals.xlsx` | solar + battery capacity, 2011-present monthly |
| `sres-postcode-data-installations-2001-to-2010.xlsx` | early-vintage solar installs, 2001-2010 monthly |
| `sres-postcode-data-capacity-2001-to-2010.xlsx` | early-vintage solar capacity, 2001-2010 monthly |

Only the `SGU-Solar` and `SGU-Battery` sheets are read. Header rows are detected by content
(the cell containing "postcode"), and month columns are parsed semantically by month/year -
**nothing hardcodes a column count**, so a monthly update that adds a column just works.

**Solar continuity.** One continuous solar series is stitched from April 2001 to the latest
month: 2001-2010 monthly detail from the standalone files + January-2011-onwards monthly
columns from the 2011-present files. The 2011-present "Historic Total (2001-2010)" column is
**not** added on top (that would double-count the first decade); instead it is used as an
**integrity check**: the build asserts the 2001-2010 monthly sum equals the Historic Total
column, per postcode, and fails loudly if a future file ever breaks that. A second check
asserts the stitched national total equals the file's "Total" column.

**Battery.** Batteries became STC-eligible on 1 July 2025, so the battery series starts
2025-07 and exists only in the 2011-present files. There is no battery history before then;
battery end-of-life is modelled as a pure forward projection.

**Units.** Solar capacity is **rated kW**; battery capacity is **usable kWh**. They are
stored and labelled distinctly and never combined.

**Outputs** (in `public/data/`):

- `data.json` - per dataset: per-state monthly series, national monthly + cumulative, and
  installs/capacity by install year (the vintage basis). Plus `meta` (dates, totals, months,
  lifespans).
- `postcodes.json` - cumulative installs/capacity per postcode with state + centroid, for the
  map heat layer.
- `meta.json` - the headline "data as at" date, the secondary 2001-2010 source date, months
  available, totals, and assumed lifespans. Handy for a quick check.

---

## Monthly data update

The CER publishes updated postcode data roughly monthly. To refresh:

1. Download the latest **Installations** and **Capacity** xlsx (the 2011-present pair) from
   the CER:
   <https://cer.gov.au/markets/reports-and-data/small-scale-installation-postcode-data>
2. Replace those two files in `data/cer/`, keeping the **same filenames**. The two 2001-2010
   files are static history - leave them in place (only re-download them if the CER reissues
   them).
3. (Optional but recommended) run `npm run build:data` then `npm run verify:data` locally and
   eyeball the totals and the "data as at" date.
4. Commit and push. Vercel rebuilds, re-parses, re-stitches the 2001-present solar series and
   redeploys automatically. The "data as at" date and all month columns update themselves -
   no code changes needed.

If a future file breaks the 2001-2010 reconciliation, the build **fails loudly** rather than
silently double-counting. If the CER ever changes the filenames, update the single `CONFIG`
block at the top of `scripts/build-data.ts` (filenames, sheet names, assumed lifespans and the
number of trailing incomplete months all live there).

---

## Data caveats (also surfaced in the UI)

- These are **approved-STC** installations. The CER allows a 12-month certificate-creation
  window, so the most recent ~1-3 months are under-counted and rise in later files. The
  dashboard flags the trailing 3 months as provisional (shown dashed on the time series).
- Government "installed" headlines (for example ~400,000 batteries) include pending
  applications and exceed this approved-STC dataset.
- Solar capacity is rated kW; battery capacity is usable kWh. Never converted between the two.
- Battery data starts July 2025; solar runs from 2001. Battery charts do not show an empty
  pre-2025 axis.

---

## Deploy to Vercel

1. Push this repository to GitHub (or GitLab/Bitbucket).
2. In Vercel, **New Project -> import the repo**. Vercel auto-detects Next.js; the defaults are
   correct:
   - Install command: `npm install`
   - Build command: `npm run build` (this runs `prebuild` -> `build:data` automatically, so the
     JSON regenerates on every deploy)
   - Output: `.next` (default)
   - No environment variables are required.
3. Deploy. Subsequent monthly refreshes are just a commit + push (see above).

Node version: Vercel reads the `engines.node` field in `package.json` (>=20). To pin a specific
version, add a `.nvmrc` or set the Node version in Vercel project settings.

---

## Brand assets

The header and footer logos ship as PNGs in `public/brand/`
(`resource-logo-horizontal-white.png` for the header, `resource-logo-mark-white.png` for the
footer). To swap them, either replace those PNGs in place (keeping the filenames) or drop in
SVG versions and update the two `<img src>` references in `components/Header.tsx` and
`components/Footer.tsx`. Colour, typography and spacing tokens are defined in
`app/globals.css` (`:root`).

---

## Notes

- The placeholder data from the original design prototype has been **replaced with real CER
  data**; figures shown are approved-STC installations as at the file date.
- The map uses MapLibre GL JS with a token-free, self-contained dark style (our own GeoJSON
  only - no external tile provider). MapLibre is lazy-loaded so it is not in the initial bundle.
- TypeScript is strict throughout; the data layer carries no `any`.
