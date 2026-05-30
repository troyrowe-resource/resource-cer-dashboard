/* ============================================================
   Aggregation / maths tests. Verifies the client-side aggregation in
   lib/cer.ts and the integrity of the emitted aggregations.
   Runner: node --test (Node >= 22.18).
   ============================================================ */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { aggregate, byYear, arisingsSeries, ymToNum } from "../lib/cer.ts";
import { STATE_CODES } from "../lib/types.ts";
import type { DataFile, PostcodeState, SeriesBundle, YearPoint } from "../lib/types.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const data: DataFile = JSON.parse(readFileSync(resolve(ROOT, "public/data/data.json"), "utf8"));
const ALL: PostcodeState[] = [...STATE_CODES, "OTHER"];

function eachDataset(fn: (b: SeriesBundle, key: "solar" | "battery") => void) {
  fn(data.solar, "solar");
  fn(data.battery, "battery");
}

// ---- B1: per-state monthly sums to the national monthly ----
test("per-state monthly figures sum to the national monthly figures", () => {
  eachDataset((b, key) => {
    const n = b.national.monthly.length;
    for (let i = 0; i < n; i++) {
      let installs = 0, capacity = 0;
      for (const code of ALL) {
        const p = b.byState[code]?.[i];
        if (p) { installs += p.installs; capacity += p.capacity; }
      }
      assert.equal(installs, b.national.monthly[i].installs, `${key} installs mismatch at ${b.national.monthly[i].ym}`);
      assert.ok(Math.abs(capacity - b.national.monthly[i].capacity) < 1, `${key} capacity mismatch at ${b.national.monthly[i].ym}`);
    }
  });
});

// ---- B2: cumulative series is monotonic and ends at the grand total ----
test("cumulative series is monotonic non-decreasing and ends at the grand total", () => {
  eachDataset((b, key) => {
    const cum = b.national.cumulative;
    for (let i = 1; i < cum.length; i++) {
      assert.ok(cum[i].installs >= cum[i - 1].installs, `${key} cumulative installs dipped at ${cum[i].ym}`);
      assert.ok(cum[i].capacity >= cum[i - 1].capacity - 1e-6, `${key} cumulative capacity dipped at ${cum[i].ym}`);
    }
    const tail = cum[cum.length - 1];
    assert.equal(tail.installs, data.meta.datasets[key].totalInstalls, `${key} cumulative tail != total installs`);
    assert.ok(Math.abs(tail.capacity - data.meta.datasets[key].totalCapacity) < 1, `${key} cumulative tail != total capacity`);
  });
});

// ---- B3: lib/cer aggregate() over all states+range reproduces the national total ----
test("aggregate() over all states and full range equals the reported totals", () => {
  eachDataset((b, key) => {
    const m = data.meta.datasets[key];
    const agg = aggregate(b, ALL, m.startYM, m.endYM);
    assert.equal(agg.totalInstalls, m.totalInstalls, `${key} aggregate total installs`);
    assert.ok(Math.abs(agg.totalCapacity - m.totalCapacity) < 1, `${key} aggregate total capacity`);
    assert.ok(agg.avg > 0 && Number.isFinite(agg.avg), `${key} avg not finite`);
  });
});

// ---- B3b: a sub-range is a strict subset (fewer months, smaller-or-equal total) ----
test("aggregate() respects the time range", () => {
  const m = data.meta.datasets.solar;
  const full = aggregate(data.solar, ALL, m.startYM, m.endYM);
  const sub = aggregate(data.solar, ALL, "2020-01", "2020-12");
  assert.equal(sub.months.length, 12);
  assert.ok(sub.totalInstalls < full.totalInstalls);
  assert.ok(sub.months.every((p) => ymToNum(p.ym) >= ymToNum("2020-01") && ymToNum(p.ym) <= ymToNum("2020-12")));
});

// ---- B4: selecting a subset of states reduces the aggregate ----
test("selecting fewer states reduces the aggregate installs", () => {
  const m = data.meta.datasets.solar;
  const all = aggregate(data.solar, ALL, m.startYM, m.endYM);
  const nswOnly = aggregate(data.solar, ["NSW"], m.startYM, m.endYM);
  assert.ok(nswOnly.totalInstalls > 0 && nswOnly.totalInstalls < all.totalInstalls);
});

// ---- B5: arisings curve uses the editable lifespan parameter ----
test("arisings(year) = installs(year - life) and moves when lifespan changes", () => {
  const yearly: YearPoint[] = [
    { year: 2000, installs: 100, capacity: 0 },
    { year: 2001, installs: 200, capacity: 0 },
    { year: 2002, installs: 300, capacity: 0 },
  ];
  const life = 25, now = 2026;
  const s = arisingsSeries(yearly, "installs", life, 5, now);
  const at = (y: number) => s.find((d) => d.year === y);
  // series spans 2000 .. lastInstall(2002)+life(25) = 2027
  assert.equal(s[0].year, 2000);
  assert.equal(s[s.length - 1].year, 2027);
  // arisings shifted by exactly `life`
  assert.equal(at(2025)!.aris, 100, "arisings 2025 should equal installs 2000");
  assert.equal(at(2026)!.aris, 200, "arisings 2026 should equal installs 2001");
  assert.equal(at(2027)!.aris, 300, "arisings 2027 should equal installs 2002");
  // changing the lifespan moves the curve
  const s30 = arisingsSeries(yearly, "installs", 30, 5, now);
  assert.equal(s30.find((d) => d.year === 2030)!.aris, 100, "with life=30, arisings 2030 = installs 2000");
  assert.notDeepEqual(s.map((d) => d.aris), s30.map((d) => d.aris).slice(0, s.length), "curve did not move with lifespan");
});

// ---- B6: the "approaching end-of-life" band lines up with the right install years ----
test("approaching-EOL band covers exactly the cohorts within `band` years of life", () => {
  // real solar vintage, life 25, band 5, now 2026:
  //   approaching = install years with (year-startYearOfLife) in (0,5] => 2002..2006
  //   pastLife    = age >= 25 => install year 2001 (and earlier; solar starts 2001)
  const s = arisingsSeries(data.solar.vintage.national, "installs", 25, 5, 2026);
  const approaching = s.filter((d) => d.approaching).map((d) => d.year).sort((a, z) => a - z);
  assert.deepEqual(approaching, [2002, 2003, 2004, 2005, 2006], `approaching years were ${approaching}`);
  const pastLife = s.filter((d) => d.pastLife).map((d) => d.year);
  assert.ok(pastLife.includes(2001), "2001 (age 25) should be past assumed life");
  assert.ok(!pastLife.includes(2002), "2002 (age 24) is not yet past life");
  // a year safely mid-life is neither
  const y2015 = s.find((d) => d.year === 2015)!;
  assert.ok(!y2015.approaching && !y2015.pastLife);
});

// ---- B7: byYear rollup matches the emitted vintage ----
test("byYear(national monthly) matches the emitted vintage series", () => {
  const rolled = byYear(data.solar.national.monthly);
  const vint = data.solar.vintage.national;
  assert.equal(rolled.length, vint.length);
  for (let i = 0; i < rolled.length; i++) {
    assert.equal(rolled[i].year, vint[i].year);
    assert.equal(rolled[i].installs, vint[i].installs, `vintage installs mismatch for ${rolled[i].year}`);
  }
});
