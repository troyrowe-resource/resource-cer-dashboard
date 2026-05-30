/* ============================================================
   Sanity-check the generated data before pushing a refresh.
   Run:  npm run verify:data
   Prints headline totals, per-state breakdown and runs internal
   consistency checks (national == sum of states; cumulative tail
   == reported total; centroid coverage). Exits non-zero on failure.
   ============================================================ */
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { DataFile, PostcodeFile, SeriesBundle, DatasetKey, PostcodeState } from "../lib/types.ts";
import { STATE_CODES } from "../lib/types.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DATA = resolve(ROOT, "public/data");

function load<T>(name: string): T {
  const p = resolve(DATA, name);
  if (!existsSync(p)) throw new Error(`Missing ${name} - run \`npm run build:data\` first.`);
  return JSON.parse(readFileSync(p, "utf8")) as T;
}

const fmtInt = (n: number) => Math.round(n).toLocaleString("en-AU");
function fmtCap(kw: number, unit: string): string {
  if (unit === "kWh") return kw >= 1e6 ? (kw / 1e6).toFixed(2) + " GWh" : (kw / 1e3).toFixed(1) + " MWh";
  return kw >= 1e6 ? (kw / 1e6).toFixed(2) + " GW" : (kw / 1e3).toFixed(1) + " MW";
}

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? "  (" + detail + ")" : ""}`);
  if (!ok) failures++;
}

function reportDataset(key: DatasetKey, data: DataFile, pc: PostcodeFile) {
  const meta = data.meta.datasets[key];
  const b: SeriesBundle = data[key];
  console.log(`\n=== ${meta.label.toUpperCase()} (${meta.title}) ===`);
  console.log(`  range:       ${meta.startYM} -> ${meta.endYM}  (${meta.months.length} months)`);
  console.log(`  installs:    ${fmtInt(meta.totalInstalls)} ${meta.unitName}`);
  console.log(`  capacity:    ${fmtCap(meta.totalCapacity, meta.sizeUnit)}  (${fmtInt(meta.totalCapacity)} ${meta.sizeUnit})`);
  const avgSize = meta.totalInstalls ? meta.totalCapacity / meta.totalInstalls : 0;
  console.log(`  avg size:    ${avgSize.toFixed(2)} ${meta.sizeUnit} per ${meta.unitName === "systems" ? "system" : "battery"}`);
  console.log(`  assumed life:${meta.assumedLifeYears}y (band ${meta.bandYears}y, slider ${meta.lifeMin}-${meta.lifeMax})`);
  console.log(`  incomplete:  last ${meta.incompleteMonths} months flagged`);

  // per-state cumulative installs
  console.log("  by state (cumulative installs):");
  const buckets: PostcodeState[] = [...STATE_CODES, "OTHER"];
  let stateSum = 0;
  for (const s of buckets) {
    const series = b.byState[s] ?? [];
    const inst = series.reduce((a, p) => a + p.installs, 0);
    const cap = series.reduce((a, p) => a + p.capacity, 0);
    stateSum += inst;
    if (inst > 0) console.log(`     ${s.padEnd(5)} ${fmtInt(inst).padStart(12)}   ${fmtCap(cap, meta.sizeUnit)}`);
  }

  // checks
  const natInst = b.national.monthly.reduce((a, p) => a + p.installs, 0);
  check(`national monthly sum == sum of states`, Math.abs(natInst - stateSum) < 1, `nat ${fmtInt(natInst)} vs states ${fmtInt(stateSum)}`);
  const cumTail = b.national.cumulative.at(-1);
  check(`cumulative tail == total installs`, !!cumTail && cumTail.installs === meta.totalInstalls, `cum ${cumTail ? fmtInt(cumTail.installs) : "?"} vs total ${fmtInt(meta.totalInstalls)}`);
  const vintInst = b.vintage.national.reduce((a, y) => a + y.installs, 0);
  check(`vintage national sum == total installs`, Math.abs(vintInst - meta.totalInstalls) <= 1, `vintage ${fmtInt(vintInst)}`);
  check(`every month present in byState series`, buckets.every((s) => (b.byState[s] ?? []).length === meta.months.length), `expected ${meta.months.length}`);
  const incompleteCount = b.national.monthly.filter((p) => p.incomplete).length;
  check(`incomplete-month flag count == meta.incompleteMonths`, incompleteCount === meta.incompleteMonths, `${incompleteCount}`);

  const pts = pc[key];
  const withCentroid = pts.filter((p) => p.lat != null && p.lng != null).length;
  check(`postcode centroid coverage > 85%`, withCentroid / pts.length > 0.85, `${withCentroid}/${pts.length} = ${(100 * withCentroid / pts.length).toFixed(1)}%`);
  const pcInst = pts.reduce((a, p) => a + p.installs, 0);
  check(`postcode installs sum == total`, Math.abs(pcInst - meta.totalInstalls) <= 1, `pc ${fmtInt(pcInst)}`);

  // vintage peak
  const peak = [...b.vintage.national].sort((a, z) => z.installs - a.installs)[0];
  if (peak) console.log(`  vintage peak year: ${peak.year} (${fmtInt(peak.installs)} ${meta.unitName})`);
}

function main() {
  const data = load<DataFile>("data.json");
  const pc = load<PostcodeFile>("postcodes.json");
  console.log("CER dashboard - data verification");
  console.log(`  data as at:   ${data.meta.dataAsAt}  (ISO ${data.meta.dataAsAtISO})`);
  console.log(`  history from: ${data.meta.historicSourceDate}`);
  console.log(`  source:       ${data.meta.source}`);
  reportDataset("solar", data, pc);
  reportDataset("battery", data, pc);
  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : failures + " CHECK(S) FAILED"}`);
  if (failures > 0) process.exit(1);
}

main();
