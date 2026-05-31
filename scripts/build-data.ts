/* ============================================================
   ReSource CER dashboard - build-time data pipeline.
   Run:  npm run build:data   (also runs automatically as `prebuild`)

   Parses the CER "Small-scale installation postcode data" workbooks into
   clean, typed JSON under public/data/. The browser never parses xlsx.

   It stitches ONE continuous solar series (Apr 2001 -> latest) from the
   2001-2010 monthly detail + the 2011-present monthly columns, and asserts
   the verified reconciliation fact (2001-2010 monthly sum == "Historic Total"
   column, per postcode) so a future malformed file fails loudly rather than
   silently double-counting.

   IMPORTANT: nothing here hardcodes a column count. Header rows are detected
   by content and month columns parsed semantically, so monthly updates that
   add columns just work. If filenames change, edit CONFIG.files only.
   ============================================================ */
import XLSX from "xlsx";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { postcodeToState, normalisePostcode } from "../lib/postcode.ts";
import type {
  DataFile, PostcodeFile, MetaFile, DatasetMeta, SeriesBundle,
  MonthPoint, CumPoint, YearPoint, PostcodeState, DatasetKey,
} from "../lib/types.ts";
import { STATE_CODES } from "../lib/types.ts";

// Resolve repo root from this file's location so the script works regardless of cwd.
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// ----------------------------- CONFIG (the only thing to touch on a refresh) ----
export const CONFIG = {
  cerDir: "data/cer",
  files: {
    solarInstalls0110: "sres-postcode-data-installations-2001-to-2010.xlsx",
    solarCapacity0110: "sres-postcode-data-capacity-2001-to-2010.xlsx",
    installs11present: "sres-postcode-data-installations-2011-to-present-and-totals.xlsx",
    capacity11present: "sres-postcode-data-capacity-2011-to-present-and-totals.xlsx",
  },
  sheets: { solar: "SGU-Solar", battery: "SGU-Battery" },
  centroidsPath: "data/geo/postcode-centroids.json",
  outDir: "public/data",
  incompleteMonths: 3, // trailing months under-counted by the 12-month STC window
  life: {
    solar: { default: 25, band: 5, min: 10, max: 25 },
    battery: { default: 15, band: 3, min: 10, max: 25 },
  },
  recon: { capacityAbsTolerance: 0.5 }, // kW per-postcode; installs must match exactly
} as const;

const ALL_BUCKETS: PostcodeState[] = [...STATE_CODES, "OTHER"];
const MONTHS3 = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

// ----------------------------- low-level helpers --------------------------------
export type Row = (string | number | null)[];

function readSheet(file: string, sheet: string): Row[] | null {
  const path = resolve(ROOT, CONFIG.cerDir, file);
  if (!existsSync(path)) throw new Error(`Missing CER file: ${path}`);
  const wb = XLSX.readFile(path, { cellDates: false });
  if (!wb.Sheets[sheet]) return null;
  return XLSX.utils.sheet_to_json<Row>(wb.Sheets[sheet], { header: 1, blankrows: false, defval: null });
}

function findHeaderRow(aoa: Row[]): number {
  for (let i = 0; i < Math.min(aoa.length, 15); i++) {
    const c0 = aoa[i]?.[0];
    if (c0 != null && String(c0).toLowerCase().includes("postcode")) return i;
  }
  throw new Error("Could not locate header row (no cell containing 'postcode' in first 15 rows)");
}

function findDataAsAt(aoa: Row[]): string | null {
  for (let i = 0; i < Math.min(aoa.length, 15); i++) {
    for (const cell of aoa[i] ?? []) {
      if (cell != null && String(cell).toLowerCase().includes("as at")) {
        const m = String(cell).match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
        if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`; // ISO
      }
    }
  }
  return null;
}

/** Parse a month-data column header like "Apr 2001 - Installations Quantity". Returns null for non-month columns (Historic Total / Total). */
export function parseMonthHeader(label: string | number | null): { ym: string; y: number; m: number } | null {
  if (label == null) return null;
  const m = String(label).trim().match(/^([A-Za-z]{3,9})\s+(\d{4})\s*-/);
  if (!m) return null;
  const mn = MONTHS3.indexOf(m[1].slice(0, 3).toLowerCase()) + 1;
  if (mn < 1) return null;
  const y = parseInt(m[2], 10);
  return { ym: `${y}-${String(mn).padStart(2, "0")}`, y, m: mn };
}

function num(v: string | number | null): number {
  if (v == null) return 0;
  const n = Number(String(v).replace(/,/g, "").trim());
  return isFinite(n) ? n : 0;
}

// ----------------------------- one (file, sheet) -> per-postcode monthly map -----
interface ParsedSheet {
  perPc: Map<string, Map<string, number>>; // pc -> ym -> value
  historic: Map<string, number>; // pc -> "Historic Total (2001-2010)" value (0 if no such column)
  total: Map<string, number>; // pc -> "Total" column value
  months: string[]; // ascending ym present as monthly columns
  dataAsAt: string | null; // ISO
  hasHistoric: boolean;
}

export function parseSheet(file: string, sheet: string): ParsedSheet | null {
  const aoa = readSheet(file, sheet);
  if (!aoa) return null;
  return parseAoa(aoa);
}

/** Parse an already-read array-of-arrays sheet. Pure (no file I/O) so it is unit-testable,
    e.g. by injecting a header with an extra trailing month column. */
export function parseAoa(aoa: Row[]): ParsedSheet {
  const hr = findHeaderRow(aoa);
  const header = aoa[hr];
  const dataAsAt = findDataAsAt(aoa);

  const monthCols: { c: number; ym: string }[] = [];
  let historicCol = -1, totalCol = -1;
  for (let c = 1; c < header.length; c++) {
    const label = header[c];
    const ls = label == null ? "" : String(label).toLowerCase();
    const parsed = parseMonthHeader(label);
    if (parsed) monthCols.push({ c, ym: parsed.ym });
    else if (ls.includes("historic")) historicCol = c;
    else if (ls.startsWith("total")) totalCol = c;
  }
  const months = monthCols.map((x) => x.ym).sort();

  const perPc = new Map<string, Map<string, number>>();
  const historic = new Map<string, number>();
  const total = new Map<string, number>();

  for (let r = hr + 1; r < aoa.length; r++) {
    const row = aoa[r];
    if (!row) continue;
    const pc = normalisePostcode(row[0]);
    if (pc == null) continue;
    let mp = perPc.get(pc);
    if (!mp) { mp = new Map(); perPc.set(pc, mp); }
    for (const { c, ym } of monthCols) {
      const v = num(row[c]);
      if (v) mp.set(ym, (mp.get(ym) ?? 0) + v);
    }
    if (historicCol >= 0) historic.set(pc, (historic.get(pc) ?? 0) + num(row[historicCol]));
    if (totalCol >= 0) total.set(pc, (total.get(pc) ?? 0) + num(row[totalCol]));
  }
  return { perPc, historic, total, months, dataAsAt, hasHistoric: historicCol >= 0 };
}

// ----------------------------- stitching + reconciliation -----------------------
/** Merge 2001-2010 monthly detail with 2011-present monthly columns into one pc->ym->value map, asserting reconciliation. */
export function stitchSolar(early: ParsedSheet, recent: ParsedSheet, kind: "installs" | "capacity"): Map<string, Map<string, number>> {
  // reconciliation: per-pc sum of early monthly == recent "Historic Total (2001-2010)" column
  const pcs = new Set<string>([...early.perPc.keys(), ...recent.historic.keys()]);
  const mismatches: string[] = [];
  for (const pc of pcs) {
    let earlySum = 0;
    const em = early.perPc.get(pc);
    if (em) for (const v of em.values()) earlySum += v;
    const hist = recent.historic.get(pc) ?? 0;
    const diff = Math.abs(earlySum - hist);
    const ok = kind === "installs" ? diff < 1e-6 : diff <= CONFIG.recon.capacityAbsTolerance;
    if (!ok) mismatches.push(`  pc ${pc}: 2001-2010 sum=${earlySum} vs Historic Total=${hist} (diff ${diff.toFixed(3)})`);
  }
  if (mismatches.length) {
    throw new Error(
      `RECONCILIATION FAILED for solar ${kind}: ${mismatches.length} postcode(s) where the 2001-2010 ` +
      `monthly detail does not match the "Historic Total (2001-2010)" column. The files are inconsistent; ` +
      `stitching would double-count or drop history. First few:\n${mismatches.slice(0, 8).join("\n")}`
    );
  }

  const merged = new Map<string, Map<string, number>>();
  const allPcs = new Set<string>([...early.perPc.keys(), ...recent.perPc.keys()]);
  for (const pc of allPcs) {
    const out = new Map<string, number>();
    const em = early.perPc.get(pc);
    if (em) for (const [ym, v] of em) out.set(ym, (out.get(ym) ?? 0) + v); // Apr 2001 - Dec 2010
    const rm = recent.perPc.get(pc);
    if (rm) for (const [ym, v] of rm) out.set(ym, (out.get(ym) ?? 0) + v); // Jan 2011 - latest (no overlap with early)
    merged.set(pc, out);
  }
  return merged;
}

// ----------------------------- aggregation --------------------------------------
function sumMap(m: Map<string, number> | undefined): number {
  let s = 0;
  if (m) for (const v of m.values()) s += v;
  return s;
}
const round1 = (n: number) => Math.round(n * 10) / 10;

interface PerPcDataset {
  installs: Map<string, Map<string, number>>; // pc -> ym -> n
  capacity: Map<string, Map<string, number>>; // pc -> ym -> kW/kWh
  months: string[]; // master ascending ym list
}

function buildSeriesBundle(ds: PerPcDataset, incompleteMonths: number): SeriesBundle {
  const months = ds.months;
  const incompleteSet = new Set(months.slice(Math.max(0, months.length - incompleteMonths)));

  // bucket postcodes by state
  const pcState = new Map<string, PostcodeState>();
  const allPcs = new Set<string>([...ds.installs.keys(), ...ds.capacity.keys()]);
  for (const pc of allPcs) pcState.set(pc, postcodeToState(pc));

  // byState monthly
  const byState = {} as Record<PostcodeState, MonthPoint[]>;
  for (const bucket of ALL_BUCKETS) {
    const idx = new Map<string, { installs: number; capacity: number }>();
    for (const ym of months) idx.set(ym, { installs: 0, capacity: 0 });
    for (const pc of allPcs) {
      if (pcState.get(pc) !== bucket) continue;
      const im = ds.installs.get(pc);
      if (im) for (const [ym, v] of im) { const e = idx.get(ym); if (e) e.installs += v; }
      const cm = ds.capacity.get(pc);
      if (cm) for (const [ym, v] of cm) { const e = idx.get(ym); if (e) e.capacity += v; }
    }
    byState[bucket] = months.map((ym) => {
      const [y, m] = ym.split("-").map(Number);
      const e = idx.get(ym)!;
      return { ym, y, m, installs: Math.round(e.installs), capacity: round1(e.capacity), incomplete: incompleteSet.has(ym) || undefined };
    });
  }

  // national monthly (sum all buckets) + cumulative
  const nationalMonthly: MonthPoint[] = months.map((ym, i) => {
    const [y, m] = ym.split("-").map(Number);
    let installs = 0, capacity = 0;
    for (const bucket of ALL_BUCKETS) { installs += byState[bucket][i].installs; capacity += byState[bucket][i].capacity; }
    return { ym, y, m, installs, capacity: round1(capacity), incomplete: incompleteSet.has(ym) || undefined };
  });
  let ci = 0, cc = 0;
  const nationalCumulative: CumPoint[] = nationalMonthly.map((p) => {
    ci += p.installs; cc += p.capacity;
    return { ym: p.ym, y: p.y, m: p.m, installs: ci, capacity: round1(cc) };
  });

  // vintage (installs/capacity by install year) national + per state
  const vintByState = {} as Record<PostcodeState, YearPoint[]>;
  for (const bucket of ALL_BUCKETS) vintByState[bucket] = monthlyToYearly(byState[bucket]);
  const vintNational = monthlyToYearly(nationalMonthly);

  return {
    byState,
    national: { monthly: nationalMonthly, cumulative: nationalCumulative },
    vintage: { national: vintNational, byState: vintByState },
  };
}

function monthlyToYearly(monthly: MonthPoint[]): YearPoint[] {
  const map = new Map<number, YearPoint>();
  const order: number[] = [];
  for (const p of monthly) {
    let yp = map.get(p.y);
    if (!yp) { yp = { year: p.y, installs: 0, capacity: 0 }; map.set(p.y, yp); order.push(p.y); }
    yp.installs += p.installs; yp.capacity += p.capacity;
  }
  return order.map((y) => { const yp = map.get(y)!; return { year: y, installs: Math.round(yp.installs), capacity: round1(yp.capacity) }; });
}

function buildPostcodePoints(ds: PerPcDataset, centroids: Record<string, [number, number]>): import("../lib/types").PostcodePoint[] {
  const allPcs = new Set<string>([...ds.installs.keys(), ...ds.capacity.keys()]);
  const out: import("../lib/types").PostcodePoint[] = [];
  for (const pc of allPcs) {
    const installs = Math.round(sumMap(ds.installs.get(pc)));
    const capacity = round1(sumMap(ds.capacity.get(pc)));
    if (installs === 0 && capacity === 0) continue;
    const c = centroids[pc];
    out.push({ pc, state: postcodeToState(pc), installs, capacity, lng: c ? c[0] : null, lat: c ? c[1] : null });
  }
  out.sort((a, b) => b.installs - a.installs);
  return out;
}

// ----------------------------- meta ---------------------------------------------
function fmtDate(iso: string | null): string {
  if (!iso) return "unknown";
  const [y, m, d] = iso.split("-").map(Number);
  const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${d} ${MON[m - 1]} ${y}`;
}

function datasetMeta(key: DatasetKey, ds: PerPcDataset, bundle: SeriesBundle): DatasetMeta {
  const months = ds.months;
  const totalInstalls = bundle.national.cumulative.length ? bundle.national.cumulative[bundle.national.cumulative.length - 1].installs : 0;
  const totalCapacity = bundle.national.cumulative.length ? bundle.national.cumulative[bundle.national.cumulative.length - 1].capacity : 0;
  const life = CONFIG.life[key];
  return {
    key,
    label: key === "solar" ? "Solar" : "Battery",
    title: key === "solar" ? "Rooftop solar" : "Home battery",
    unitName: key === "solar" ? "systems" : "batteries",
    sizeUnit: key === "solar" ? "kW" : "kWh",
    startYM: months[0] ?? "",
    endYM: months[months.length - 1] ?? "",
    months,
    totalInstalls,
    totalCapacity,
    incompleteMonths: CONFIG.incompleteMonths,
    assumedLifeYears: life.default,
    bandYears: life.band,
    lifeMin: life.min,
    lifeMax: life.max,
  };
}

// ----------------------------- main ---------------------------------------------
function main() {
  const t0 = Date.now();
  console.log("Building CER dashboard data...");

  // --- parse all sheets ---
  const solarInstEarly = parseSheet(CONFIG.files.solarInstalls0110, CONFIG.sheets.solar);
  const solarCapEarly = parseSheet(CONFIG.files.solarCapacity0110, CONFIG.sheets.solar);
  const instRecentSolar = parseSheet(CONFIG.files.installs11present, CONFIG.sheets.solar);
  const capRecentSolar = parseSheet(CONFIG.files.capacity11present, CONFIG.sheets.solar);
  const instBattery = parseSheet(CONFIG.files.installs11present, CONFIG.sheets.battery);
  const capBattery = parseSheet(CONFIG.files.capacity11present, CONFIG.sheets.battery);

  if (!solarInstEarly || !solarCapEarly || !instRecentSolar || !capRecentSolar)
    throw new Error("Missing a required SGU-Solar sheet in one of the four mandatory files.");
  if (!instBattery || !capBattery)
    throw new Error("Missing SGU-Battery sheet in the 2011-present files.");

  // --- stitch solar (with reconciliation asserts) ---
  const solarInstalls = stitchSolar(solarInstEarly, instRecentSolar, "installs");
  const solarCapacity = stitchSolar(solarCapEarly, capRecentSolar, "capacity");
  const solarMonths = Array.from(new Set([...solarInstEarly.months, ...instRecentSolar.months])).sort();

  // --- second integrity check: stitched national == "Total" column national ---
  let stitchedNatInstalls = 0;
  for (const mp of solarInstalls.values()) for (const v of mp.values()) stitchedNatInstalls += v;
  let totalColNatInstalls = 0;
  for (const v of instRecentSolar.total.values()) totalColNatInstalls += v;
  if (Math.abs(stitchedNatInstalls - totalColNatInstalls) > 1e-6) {
    throw new Error(
      `INTEGRITY CHECK FAILED: stitched solar installs national total (${stitchedNatInstalls}) != ` +
      `"Total" column national total (${totalColNatInstalls}). Difference ${stitchedNatInstalls - totalColNatInstalls}.`
    );
  }
  // mirror the integrity check for capacity (kW) against its own "Total" column
  let stitchedNatCap = 0;
  for (const mp of solarCapacity.values()) for (const v of mp.values()) stitchedNatCap += v;
  let totalColNatCap = 0;
  for (const v of capRecentSolar.total.values()) totalColNatCap += v;
  if (Math.abs(stitchedNatCap - totalColNatCap) > Math.max(1, totalColNatCap * 1e-6)) {
    throw new Error(
      `INTEGRITY CHECK FAILED: stitched solar capacity national total (${stitchedNatCap.toFixed(1)} kW) != ` +
      `"Total" column national total (${totalColNatCap.toFixed(1)} kW). Difference ${(stitchedNatCap - totalColNatCap).toFixed(3)}.`
    );
  }
  console.log(`  solar reconciliation OK; national installs = ${stitchedNatInstalls.toLocaleString("en-AU")}, capacity = ${Math.round(stitchedNatCap).toLocaleString("en-AU")} kW`);

  // --- battery (no history) ---
  const batteryInstalls = new Map(instBattery.perPc);
  const batteryCapacity = new Map(capBattery.perPc);
  const batteryMonths = Array.from(new Set([...instBattery.months, ...capBattery.months])).sort();

  // --- centroids (optional; map heat degrades gracefully without them) ---
  let centroids: Record<string, [number, number]> = {};
  const cpath = resolve(ROOT, CONFIG.centroidsPath);
  if (existsSync(cpath)) {
    centroids = JSON.parse(readFileSync(cpath, "utf8"));
    console.log(`  loaded ${Object.keys(centroids).length} postcode centroids`);
  } else {
    console.warn(`  WARNING: ${CONFIG.centroidsPath} not found - map heat layer will have no points. Run \`npm run fetch:geo\`.`);
  }

  // --- assemble ---
  const solarDs: PerPcDataset = { installs: solarInstalls, capacity: solarCapacity, months: solarMonths };
  const batteryDs: PerPcDataset = { installs: batteryInstalls, capacity: batteryCapacity, months: batteryMonths };

  const solarBundle = buildSeriesBundle(solarDs, CONFIG.incompleteMonths);
  const batteryBundle = buildSeriesBundle(batteryDs, CONFIG.incompleteMonths);

  const meta: MetaFile = {
    dataAsAt: fmtDate(instRecentSolar.dataAsAt),
    dataAsAtISO: instRecentSolar.dataAsAt ?? "",
    historicSourceDate: fmtDate(solarInstEarly.dataAsAt),
    generatedAt: process.env.BUILD_TIME ?? new Date().toISOString(),
    datasets: {
      solar: datasetMeta("solar", solarDs, solarBundle),
      battery: datasetMeta("battery", batteryDs, batteryBundle),
    },
    source: "Clean Energy Regulator - Small-scale installation postcode data",
  };

  const dataFile: DataFile = { meta, solar: solarBundle, battery: batteryBundle };
  const postcodeFile: PostcodeFile = {
    solar: buildPostcodePoints(solarDs, centroids),
    battery: buildPostcodePoints(batteryDs, centroids),
  };

  // --- write ---
  const outDir = resolve(ROOT, CONFIG.outDir);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(resolve(outDir, "data.json"), JSON.stringify(dataFile));
  writeFileSync(resolve(outDir, "postcodes.json"), JSON.stringify(postcodeFile));
  writeFileSync(resolve(outDir, "meta.json"), JSON.stringify(meta, null, 2));

  // --- summary ---
  const sm = meta.datasets.solar, bm = meta.datasets.battery;
  console.log("\n  ---- summary ----");
  console.log(`  data as at: ${meta.dataAsAt} (history sourced ${meta.historicSourceDate})`);
  console.log(`  SOLAR   ${sm.startYM}..${sm.endYM}  installs=${sm.totalInstalls.toLocaleString("en-AU")}  capacity=${Math.round(sm.totalCapacity).toLocaleString("en-AU")} kW`);
  console.log(`  BATTERY ${bm.startYM}..${bm.endYM}  installs=${bm.totalInstalls.toLocaleString("en-AU")}  capacity=${Math.round(bm.totalCapacity).toLocaleString("en-AU")} kWh`);
  console.log(`  postcodes: solar=${postcodeFile.solar.length}, battery=${postcodeFile.battery.length}`);
  console.log(`  wrote data.json (${(JSON.stringify(dataFile).length / 1024).toFixed(0)} KB), postcodes.json (${(JSON.stringify(postcodeFile).length / 1024).toFixed(0)} KB)`);
  console.log(`  done in ${Date.now() - t0} ms`);
}

// Run only when executed directly (node/tsx scripts/build-data.ts), not when imported by tests.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
