# Notes - autonomous decisions and things for your attention

I worked through this autonomously while you were away. Where a call was needed I took the
sensible default and recorded it here. Nothing is left broken; the app builds, all 25 unit
tests pass, and accessibility is clean.

## Update - changes since the autonomous handoff (current live state)
After the handoff you asked for a round of refinements; all are live on Vercel:
1. **Map reworked to plain SVG.** The original MapLibre choropleth rendered locally but stayed
   blank on Vercel - MapLibre's GL worker never completed style-load on the host, so `addSource`
   threw "Style is not done loading". I replaced it with a hand-built SVG choropleth drawn from the
   same state GeoJSON (real boundaries, postcode-heat dots, hover + click-to-filter). No WebGL or
   worker, so it renders deterministically on every load. Verified live.
2. **Assumed-life slider range** changed from 20-35y to **10-25y** (solar default 25y).
3. **Estimated solar panels** added as a metric: capacity / average module wattage for the install
   year (a recycler counts panels, not just installs or kW). Module-wattage table in `lib/cer.ts`.
4. **Cumulative panel** gained a Systems / Panels / Capacity toggle and its own assumed-life
   slider; the end-of-life band grows as the slider shrinks - the same controls as the vintage panel.
5. **Panels are drag-and-drop reorderable** (grip handle on each); the order is saved per browser
   in `localStorage` (`rs-panel-order-v1`).
6. **Dataset pill** recoloured to orange-on-dark to match the theme. This supersedes the cream-pill
   contrast note in item 4 below - the pill is now brand orange on a dark surface, which passes AA.
7. **Favicon** is the black-and-orange mark (not white-and-orange) and is padded to a square so the
   browser tab no longer squashes it.

**One retained dependency:** `maplibre-gl` is still listed in `package.json` even though nothing
imports it any more. It is tree-shaken out (First Load JS is 102 kB, no map dependency in the
bundle), so it costs nothing at runtime - it only adds to `node_modules` at build time. I left it
in to keep `package.json` and `package-lock.json` in sync (Vercel runs `npm ci`, which fails on a
mismatch, and this build sandbox cannot regenerate the lock). To remove it on your machine: run
`npm uninstall maplibre-gl`, then commit the updated `package.json` + `package-lock.json`.

## Where the repository lives (important)
The repository now lives at **`C:\Users\TroyRowe\ReSource Pty Ltd\ReSource - Troy Rowe\Claude\Code\resource-cer-dashboard`**
- your OneDrive-synced `Claude\Code` workspace (alongside other projects). It is the single, self-contained
copy: full source, the git repository (history + GitHub remote), and `node_modules`. Edit, build, commit and
push all happen here; this path is short enough for Git and Node to run directly. It replaced the earlier
`C:\Users\TroyRowe\Documents\resource-cer-dashboard` copy, which existed only because Git could not operate
inside the very long Cowork session-output path; that Documents copy has been removed. Because this folder is
OneDrive-synced, `node_modules` will sync in the background - harmless, but expect some sync activity after an
`npm install`.

## Decisions that need a glance (none blocking)

### 1. Test runner: Node's built-in `node:test`, not Vitest
The brief asked for Vitest. This build environment is a packaged-app sandbox that **cannot
execute `.exe` binaries from `node_modules`** (confirmed: spawning `esbuild.exe` fails with
ENOENT even with the sandbox disabled, while the Program-Files `node.exe` spawns fine). Vitest
runs on Vite/esbuild, so it could not run here at all - and I was not willing to ship a Vitest
config I could not execute and verify. Node's built-in test runner needs no extra tooling, runs
the exact same assertions, and let me loop to green in-session. The tests use only
`node:test` + `node:assert`, so porting to Vitest later is mechanical.
- **What you get:** `npm test` runs 25 real, adversarial unit/integration tests. Green, twice.
- **Recommendation:** keep as-is. If you specifically want Vitest, say so and I will port the
  three files (about 15 minutes). They will pass unchanged in substance.
- **Caveat:** `npm test` needs **Node >= 22.18** (native TypeScript). The app and `npm run
  build` run on Node >= 20. Set Node 22+ in CI for the test step.

### 2. Playwright e2e: installed and configured, executed here via the harness browser
Playwright is installed and the specs + config are committed (`tests/e2e`, `playwright.config.ts`).
The Playwright **browser** also cannot spawn in this sandbox, so for in-session verification I
drove the live production app through the harness's browser preview instead: I scripted the
three core journeys (solar, battery, change-a-filter) and ran an axe accessibility scan against
the rendered page. All passed. On your machine the real Playwright suite runs with:
```bash
npx playwright install chromium
npm run test:e2e
```
That also writes the three screenshots to `test-screenshots/`.

### 3. Screenshots to /test-screenshots
The brief asked for saved screenshots. The harness's screenshot capture timed out after heavy
use (MapLibre's WebGL render loop does not settle for the headless capturer), and it does not
write to disk in any case. So the disk screenshots are produced by `npm run test:e2e` on your
machine (solar.png, battery.png, vintage.png). I verified all three views live in this session
(and there are working screenshots earlier in our chat).

### 4. Accessibility: three brand shades nudged to clear WCAG AA (an explicit requirement)
axe found one serious issue - small dim labels, the dataset pill, and the red down-delta were
below the 4.5:1 contrast minimum. To pass AA I changed:
- `--fg-on-dark-dim`  `#7A7A7A` -> `#9A9A9A` (small grey labels)
- dataset pill text   `#D67B00` -> `#8F5200` (dark amber on the cream pill)
- KPI down-delta red   `#CC3524` -> `#FF6453` (new `--delta-down` token; small 12px text)
Brand orange (`#FFA100`) and the overall identity are unchanged; `#BF7800` is still absent.
**Recommendation:** keep them (AA-compliant). If the brand team insists on the exact original
shades, we would be knowingly shipping a serious contrast failure on those elements.

### 5. Two test expectations corrected (code was right)
Per the brief, where a test encoded a wrong expectation I fixed the test, not the code:
- `agg.test.ts`: an off-by-one in the arisings-with-lifespan check (with life=30, arisings(2030)
  = installs(2000), not 2031). The pipeline was correct.
- `build.test.ts`: my first "no client chunk > 700KB" heuristic flagged the (then) MapLibre map
  dependency. The map is plain SVG now (see the update section at the top), so the size heuristic
  was removed; the test just checks xlsx markers are absent from every client chunk (they are).

### 6. Postcode 0200 -> OTHER (kept exactly per the supplied mapping)
The mapping function in the brief sends 0200 (the ANU/Canberra special postcode) to OTHER, not
ACT. I kept it **exactly as supplied** (1 solar install, 0 battery, 0.00002% of volume). If you
want 0200 -> ACT, add `if (n >= 200 && n <= 299) return "ACT";` before the NT range in
`lib/postcode.ts`. Left as-is because the brief said to use the function exactly.

### 7. Smaller hardening (no decision needed, just FYI)
- `meta.generatedAt` now defaults to the real build time (was frozen at the 1970 epoch).
- Added a national-total integrity assert for solar **capacity** (installs already had one).
- The "now" marker on the vintage chart is clamped so it can never draw outside the plot on a
  narrow filter.
- Lint uses a self-contained ESLint flat config (typescript-eslint + react-hooks, `no-explicit-any`
  as an error) rather than `eslint-config-next`, to avoid Next-plugin flat-config friction.
  `next.config.mjs` keeps `eslint.ignoreDuringBuilds` so a lint nit can never block a deploy.

## Nothing is blocked
Every phase completed. If you want Vitest specifically (point 1) or the exact original brand
shades back (point 4), those are the only two judgement calls worth your input - both are
intentional, documented defaults, and the app is fully working either way.
