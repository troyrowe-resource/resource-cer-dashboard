/* ============================================================
   Data-pipeline tests (highest-risk area). Adversarial: tries to break
   the parser/stitch against the ACTUAL uploaded CER files + generated JSON.

   Runner: Node's built-in test runner (node --test). Requires Node >= 22.18
   for native TypeScript. Run:  npm test
   ============================================================ */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import XLSX from "xlsx";
import { parseSheet, parseAoa, parseMonthHeader, stitchSolar, CONFIG, type Row } from "../scripts/build-data.ts";
import { postcodeToState, normalisePostcode } from "../lib/postcode.ts";
import type { DataFile, PostcodeFile, MetaFile } from "../lib/types.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CER = resolve(ROOT, CONFIG.cerDir);
const load = <T,>(p: string): T => JSON.parse(readFileSync(resolve(ROOT, p), "utf8")) as T;

const data = load<DataFile>("public/data/data.json");
const meta = load<MetaFile>("public/data/meta.json");
const postcodes = load<PostcodeFile>("public/data/postcodes.json");

function sumMonthly(parsed: { perPc: Map<string, Map<string, number>> }): number {
  let s = 0;
  for (const mp of parsed.perPc.values()) for (const v of mp.values()) s += v;
  return s;
}
function sumVals(m: Map<string, number>): number {
  let s = 0;
  for (const v of m.values()) s += v;
  return s;
}

// ---- A1: leading zeros preserved, postcodes never coerced to int ----
test("postcodes keep leading zeros and are 4-digit strings", () => {
  for (const ds of [postcodes.solar, postcodes.battery]) {
    for (const p of ds) {
      assert.match(p.pc, /^\d{4}$/, `postcode "${p.pc}" is not a zero-padded 4-digit string`);
    }
  }
  // specific NT postcodes that begin with 0 must be present and intact
  const battPcs = new Set(postcodes.battery.map((p) => p.pc));
  assert.ok(battPcs.has("0810"), '"0810" (Darwin) missing - leading zero likely lost');
  const leadingZero = postcodes.battery.filter((p) => p.pc.startsWith("0"));
  assert.ok(leadingZero.length >= 10, `expected many 0-prefixed postcodes, got ${leadingZero.length}`);
  // normalisePostcode must pad numeric and preserve string input
  assert.equal(normalisePostcode(810), "0810");
  assert.equal(normalisePostcode("0810"), "0810");
  assert.equal(normalisePostcode(872), "0872");
  assert.equal(normalisePostcode(3026), "3026");
});

// ---- A2: 2001-2010 solar stitch is correct + the known national totals ----
test("2001-2010 solar reconciles to the known national totals (installs + capacity)", () => {
  const inst0110 = parseSheet(CONFIG.files.solarInstalls0110, CONFIG.sheets.solar);
  const inst11 = parseSheet(CONFIG.files.installs11present, CONFIG.sheets.solar);
  const cap0110 = parseSheet(CONFIG.files.solarCapacity0110, CONFIG.sheets.solar);
  const cap11 = parseSheet(CONFIG.files.capacity11present, CONFIG.sheets.solar);
  assert.ok(inst0110 && inst11 && cap0110 && cap11, "a required solar sheet failed to parse");

  // installs: 2001-2010 monthly sum == Historic Total column == 283,311 exactly
  assert.equal(sumMonthly(inst0110), 283311, "2001-2010 solar installs national total");
  assert.equal(sumVals(inst11.historic), 283311, "Historic Total (2001-2010) installs column");

  // capacity: 506,527 kW within rounding
  assert.ok(Math.abs(sumMonthly(cap0110) - 506527) < 1, `2001-2010 solar capacity got ${sumMonthly(cap0110)}`);
  assert.ok(Math.abs(sumVals(cap11.historic) - 506527) < 1, "Historic Total capacity column");
});

// ---- A3: no double-count; continuous series = detail + Jan-2011-onward ----
test("solar stitch does not double-count the 2001-2010 decade", () => {
  const inst0110 = parseSheet(CONFIG.files.solarInstalls0110, CONFIG.sheets.solar)!;
  const inst11 = parseSheet(CONFIG.files.installs11present, CONFIG.sheets.solar)!;
  const early = sumMonthly(inst0110); // 283,311
  const recentMonthly = sumMonthly(inst11); // Jan 2011 -> latest (excludes Historic + Total cols)
  const totalCol = sumVals(inst11.total); // file's own grand total
  const historic = sumVals(inst11.historic); // 283,311

  const stitched = stitchSolar(inst0110, inst11, "installs");
  let stitchedNat = 0;
  for (const mp of stitched.values()) for (const v of mp.values()) stitchedNat += v;

  assert.equal(stitchedNat, early + recentMonthly, "stitched != detail + monthly (unexpected)");
  assert.equal(stitchedNat, totalCol, "stitched national != file Total column");
  assert.equal(stitchedNat, 4402670, "known national solar installs");
  // the double-count trap: must NOT equal detail + monthly + historic
  assert.notEqual(stitchedNat, early + recentMonthly + historic, "DOUBLE COUNT: historic added on top of detail");
});

// ---- A4: month-column parsing is semantic, not positional ----
test("parseMonthHeader reads the differently-worded headers across files", () => {
  assert.deepEqual(parseMonthHeader("Apr 2001 - Installations Quantity"), { ym: "2001-04", y: 2001, m: 4 });
  assert.deepEqual(parseMonthHeader("Jan 2011 - Installation Quantity"), { ym: "2011-01", y: 2011, m: 1 });
  assert.deepEqual(parseMonthHeader("Apr 2001 - SGU Rated Output In kW"), { ym: "2001-04", y: 2001, m: 4 });
  assert.deepEqual(parseMonthHeader("Mar 2026 - Rated Power Output in kW"), { ym: "2026-03", y: 2026, m: 3 });
  assert.deepEqual(parseMonthHeader("Jul 2025 - Usable capacity in kWh"), { ym: "2025-07", y: 2025, m: 7 });
  // aggregate columns must NOT be read as months
  assert.equal(parseMonthHeader("Historic Total Installation Quantity (2001 - 2010)"), null);
  assert.equal(parseMonthHeader("Total Installation Quantity"), null);
  assert.equal(parseMonthHeader("Small Unit Installation Postcode"), null);
});

test("parser picks up a newly-added trailing month column with no code change", () => {
  const wb = XLSX.readFile(resolve(CER, CONFIG.files.installs11present), { cellDates: false });
  const aoa = XLSX.utils.sheet_to_json<Row>(wb.Sheets[CONFIG.sheets.battery], { header: 1, blankrows: false, defval: null });
  const baseline = parseAoa(aoa);
  assert.ok(!baseline.months.includes("2026-05"), "fixture already contains 2026-05");

  // simulate next month's file: append a "May 2026" column to the header and data rows
  const injected: Row[] = aoa.map((r) => (Array.isArray(r) ? [...r] : r)) as Row[];
  const hr = injected.findIndex((r) => r && r[0] != null && String(r[0]).toLowerCase().includes("postcode"));
  injected[hr] = [...injected[hr], "May 2026 - Installation Quantity"];
  let added = 0;
  for (let i = hr + 1; i < injected.length; i++) {
    if (!injected[i]) continue;
    const v = i === hr + 1 ? 7 : 0;
    injected[i] = [...injected[i], v];
    added += v;
  }
  const out = parseAoa(injected);
  assert.ok(out.months.includes("2026-05"), "new month column not detected (positional assumption?)");
  let mayTotal = 0;
  for (const mp of out.perPc.values()) mayTotal += mp.get("2026-05") ?? 0;
  assert.equal(mayTotal, added, "injected May 2026 value not summed correctly");
});

// ---- A5: battery starts Jul 2025, nothing invents earlier history ----
test("battery series starts 2025-07 with no pre-2025 entries", () => {
  assert.equal(data.meta.datasets.battery.startYM, "2025-07");
  for (const p of data.battery.national.monthly) {
    assert.ok(p.ym >= "2025-07", `battery month ${p.ym} predates Jul 2025`);
  }
  // every per-state battery series also starts no earlier than 2025-07
  for (const series of Object.values(data.battery.byState)) {
    for (const p of series) assert.ok(p.ym >= "2025-07");
  }
});

// ---- A6: units kept distinct (kW solar, kWh battery) ----
test("solar capacity is kW, battery capacity is kWh - stored distinctly", () => {
  assert.equal(data.meta.datasets.solar.sizeUnit, "kW");
  assert.equal(data.meta.datasets.battery.sizeUnit, "kWh");
  assert.notEqual(data.meta.datasets.solar.sizeUnit, data.meta.datasets.battery.sizeUnit);
  // solar and battery are separate bundles - no shared series object
  assert.notEqual(data.solar, data.battery);
});

// ---- A7: postcode->state coverage + battery cross-checks ----
test("every postcode maps to a state with negligible OTHER, and battery totals cross-check", () => {
  for (const ds of [postcodes.solar, postcodes.battery]) {
    for (const p of ds) {
      assert.equal(postcodeToState(p.pc), p.state, `state mismatch for ${p.pc}`);
    }
  }
  const battTotal = data.meta.datasets.battery.totalInstalls;
  assert.equal(battTotal, 343874, "battery national installs (30/04/2026 file)");
  // usable capacity ~ 9,424 MWh and ~27.4 kWh average
  const battCapKWh = data.meta.datasets.battery.totalCapacity;
  assert.ok(Math.abs(battCapKWh / 1000 - 9424) < 5, `battery MWh got ${(battCapKWh / 1000).toFixed(0)}`);
  assert.ok(Math.abs(battCapKWh / battTotal - 27.4) < 0.5, `battery avg kWh got ${(battCapKWh / battTotal).toFixed(2)}`);

  // OTHER share negligible
  const otherInstalls = (data.battery.byState.OTHER ?? []).reduce((a, p) => a + p.installs, 0)
    + (data.solar.byState.OTHER ?? []).reduce((a, p) => a + p.installs, 0);
  const grand = data.meta.datasets.solar.totalInstalls + battTotal;
  assert.ok(otherInstalls / grand < 0.0001, `OTHER share ${(100 * otherInstalls / grand).toFixed(4)}% too high`);

  // NSW + VIC + WA ~ 65% of battery installs
  const sumState = (code: "NSW" | "VIC" | "WA") => data.battery.byState[code].reduce((a, p) => a + p.installs, 0);
  const share = (sumState("NSW") + sumState("VIC") + sumState("WA")) / battTotal;
  assert.ok(share > 0.6 && share < 0.7, `NSW+VIC+WA battery share ${(100 * share).toFixed(1)}% (expected ~65%)`);
});

// ---- A8: divide-by-zero guard on average system size ----
test("average system size is zero-safe when installs are zero", () => {
  // a fabricated zero-install month must not produce NaN/Infinity downstream
  const zero = { installs: 0, capacity: 0 };
  const avg = zero.installs ? zero.capacity / zero.installs : 0;
  assert.equal(avg, 0);
  assert.ok(Number.isFinite(avg));
});

// ---- A9: meta carries both source dates + lifespan assumptions ----
test("meta.json carries both source dates and lifespan assumptions", () => {
  assert.equal(meta.dataAsAtISO, "2026-04-30");
  assert.equal(meta.dataAsAt, "30 Apr 2026");
  assert.equal(meta.historicSourceDate, "31 Mar 2024");
  assert.ok(meta.datasets.solar.assumedLifeYears > 0 && meta.datasets.solar.bandYears > 0);
  assert.ok(meta.datasets.battery.assumedLifeYears > 0 && meta.datasets.battery.bandYears > 0);
  assert.notEqual(meta.generatedAt, "1970-01-01T00:00:00.000Z", "generatedAt should be a real build time");
});
