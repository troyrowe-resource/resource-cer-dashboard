/* ============================================================
   Client-side aggregation + formatting (Australian English).
   Pure functions over the emitted SeriesBundle. The heavy
   per-postcode crunch happens at build time; here we only ever
   sum the 9 aligned per-state monthly arrays.
   ============================================================ */
import type { SeriesBundle, MonthPoint, YearPoint, PostcodeState, Metric, SizeUnit } from "./types.ts";
import { STATE_CODES } from "./types.ts";

export const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const ALL_BUCKETS: PostcodeState[] = [...STATE_CODES, "OTHER"];

export function ymToNum(ym: string): number {
  const [y, m] = ym.split("-").map(Number);
  return y * 12 + (m - 1);
}

export interface Aggregate {
  /** Months within range, installs/capacity summed over the selected states. */
  months: MonthPoint[];
  totalInstalls: number;
  totalCapacity: number;
  /** capacity / installs (kW per solar system, kWh per battery). */
  avg: number;
  latestMonth: MonthPoint | null;
  prevMonth: MonthPoint | null;
}

/** Sum the selected state buckets per month, restricted to the inclusive [fromYM, toYM] range. */
export function aggregate(
  bundle: SeriesBundle,
  codes: readonly PostcodeState[],
  fromYM: string,
  toYM: string,
): Aggregate {
  const lo = ymToNum(fromYM), hi = ymToNum(toYM);
  const axis = bundle.national.monthly; // canonical, full month axis
  const months: MonthPoint[] = [];
  for (let i = 0; i < axis.length; i++) {
    const t = ymToNum(axis[i].ym);
    if (t < lo || t > hi) continue;
    let installs = 0, capacity = 0;
    for (const c of codes) {
      const arr = bundle.byState[c];
      if (!arr) continue;
      const p = arr[i];
      if (p) { installs += p.installs; capacity += p.capacity; }
    }
    months.push({ ym: axis[i].ym, y: axis[i].y, m: axis[i].m, installs, capacity, incomplete: axis[i].incomplete });
  }
  let totalInstalls = 0, totalCapacity = 0;
  for (const p of months) { totalInstalls += p.installs; totalCapacity += p.capacity; }
  return {
    months,
    totalInstalls,
    totalCapacity,
    avg: totalInstalls ? totalCapacity / totalInstalls : 0,
    latestMonth: months.length ? months[months.length - 1] : null,
    prevMonth: months.length > 1 ? months[months.length - 2] : null,
  };
}

/** Per-state totals (all buckets) within range, for the map and by-state bar. */
export function stateTotals(
  bundle: SeriesBundle,
  fromYM: string,
  toYM: string,
): Record<PostcodeState, { installs: number; capacity: number }> {
  const lo = ymToNum(fromYM), hi = ymToNum(toYM);
  const out = {} as Record<PostcodeState, { installs: number; capacity: number }>;
  for (const c of ALL_BUCKETS) {
    const arr = bundle.byState[c] ?? [];
    let installs = 0, capacity = 0;
    for (const p of arr) {
      const t = ymToNum(p.ym);
      if (t < lo || t > hi) continue;
      installs += p.installs; capacity += p.capacity;
    }
    out[c] = { installs, capacity };
  }
  return out;
}

/** Yearly rollup of a months array. */
export function byYear(months: MonthPoint[]): YearPoint[] {
  const map = new Map<number, YearPoint>();
  const order: number[] = [];
  for (const p of months) {
    let yp = map.get(p.y);
    if (!yp) { yp = { year: p.y, installs: 0, capacity: 0 }; map.set(p.y, yp); order.push(p.y); }
    yp.installs += p.installs; yp.capacity += p.capacity;
  }
  return order.map((y) => map.get(y)!);
}

export function metricVal(p: { installs: number; capacity: number }, metric: Metric): number {
  if (metric === "capacity") return p.capacity;
  if (metric === "avg") return p.installs ? p.capacity / p.installs : 0;
  return p.installs;
}

// ---- arisings / vintage model -------------------------------------------------
export interface VintageYear {
  year: number;
  value: number; // installs or capacity in that vintage year
  aris: number; // projected waste arising = value(year - life)
  projected: boolean; // year beyond nowYear
  approaching: boolean; // within `band` years of reaching `life`
  pastLife: boolean; // already older than `life`
}

/**
 * Build the vintage + forward waste-arisings series.
 * arisings(year) = installs(year - life). Years run from the first install
 * year to lastInstallYear + life.
 */
export function arisingsSeries(
  yearly: YearPoint[],
  field: "installs" | "capacity",
  life: number,
  band: number,
  nowYear: number,
): VintageYear[] {
  const valByYear = new Map<number, number>();
  let startY = Infinity, lastY = -Infinity;
  for (const y of yearly) {
    valByYear.set(y.year, field === "installs" ? y.installs : y.capacity);
    startY = Math.min(startY, y.year);
    lastY = Math.max(lastY, y.year);
  }
  if (!isFinite(startY)) { startY = nowYear; lastY = nowYear; }
  const out: VintageYear[] = [];
  for (let year = startY; year <= lastY + life; year++) {
    const value = valByYear.get(year) ?? 0;
    const aris = valByYear.get(year - life) ?? 0;
    const age = nowYear - year;
    const toEol = life - age;
    out.push({
      year,
      value,
      aris,
      projected: year > nowYear,
      approaching: toEol > 0 && toEol <= band,
      pastLife: age >= life,
    });
  }
  return out;
}

// ---- formatters (en-AU) -------------------------------------------------------
export function commas(n: number): string {
  return Math.round(n).toLocaleString("en-AU");
}

export function compact(n: number): string {
  n = Math.round(n);
  if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 1 : 2).replace(/\.0+$/, "") + "M";
  if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(n >= 1e4 ? 0 : 1).replace(/\.0$/, "") + "k";
  return "" + n;
}

/** Capacity (kW solar / kWh battery) -> human string, e.g. "29.3 GW" / "9.42 GWh". */
export function capacity(v: number, unit: SizeUnit): string {
  const wh = unit === "kWh";
  if (v >= 1e6) return (v / 1e6).toFixed(2).replace(/\.?0+$/, "") + (wh ? " GWh" : " GW");
  if (v >= 1e3) return (v / 1e3).toFixed(v >= 1e5 ? 0 : 1) + (wh ? " MWh" : " MW");
  return Math.round(v) + (wh ? " kWh" : " kW");
}

/** Capacity split into value + unit, for the big KPI number. */
export function capacityCompact(v: number, unit: SizeUnit): { v: string; u: string } {
  const wh = unit === "kWh";
  if (v >= 1e6) return { v: (v / 1e6).toFixed(2), u: wh ? "GWh" : "GW" };
  if (v >= 1e3) return { v: (v / 1e3).toFixed(v >= 1e5 ? 0 : 1), u: wh ? "MWh" : "MW" };
  return { v: String(Math.round(v)), u: wh ? "kWh" : "kW" };
}

export function monthLabel(p: { y: number; m: number }): string {
  return MON[p.m - 1] + " " + String(p.y).slice(2);
}
export function monthLong(p: { y: number; m: number }): string {
  return MON[p.m - 1] + " " + p.y;
}
/** "Jan 2011" from a "YYYY-MM" string. */
export function ymLabel(ym: string): string {
  const [y, m] = ym.split("-");
  return MON[parseInt(m, 10) - 1] + " " + y;
}

/** Windowed percentage delta on a months array for a field (e.g. last 12mo vs prior 12mo). */
export function windowDelta(months: MonthPoint[], field: "installs" | "capacity", win: number): number | null {
  if (months.length < win + 1) return null;
  let a = 0, b = 0;
  for (let i = months.length - win; i < months.length; i++) a += months[i][field];
  for (let j = months.length - 2 * win; j < months.length - win; j++) {
    if (j < 0) return null;
    b += months[j][field];
  }
  if (!b) return null;
  return ((a - b) / b) * 100;
}
