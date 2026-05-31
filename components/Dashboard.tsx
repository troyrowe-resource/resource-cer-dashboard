"use client";
import { useState, useEffect, useMemo, type ReactNode } from "react";
import dynamic from "next/dynamic";
import type { DataFile, DatasetKey, Metric, StateCode, PostcodeState, MonthPoint } from "@/lib/types";
import { STATE_CODES, STATE_NAMES } from "@/lib/types";
import { loadData } from "@/lib/data";
import {
  aggregate, stateTotals, byYear, metricVal, windowDelta,
  commas, capacity, capacityCompact, monthLong, ymToNum, MON,
} from "@/lib/cer";
import { Header } from "./Header";
import { FilterBar } from "./FilterBar";
import { Footer } from "./Footer";
import { Kpi } from "./ui/Kpi";
import { Segmented } from "./ui/Segmented";
import { TimeSeries } from "./charts/TimeSeries";
import { StateBar } from "./charts/StateBar";
import { LineTrend } from "./charts/LineTrend";
import { CumulativeArea } from "./charts/CumulativeArea";
import { Vintage } from "./charts/Vintage";

const AusMap = dynamic(() => import("./map/AusMap"), {
  ssr: false,
  loading: () => (
    <div className="map-canvas state-msg"><span className="spinner" />Loading map</div>
  ),
});

function Panel(props: { title: string; sub?: string; full?: boolean; action?: ReactNode; children: ReactNode }) {
  return (
    <div className={"panel" + (props.full ? " span-all" : "")}>
      <div className="panel-head">
        <div>
          <h2 className="panel-title">{props.title}</h2>
          {props.sub ? <div className="panel-sub">{props.sub}</div> : null}
        </div>
        {props.action ?? null}
      </div>
      <div className="panel-body">{props.children}</div>
    </div>
  );
}

export default function Dashboard() {
  const [data, setData] = useState<DataFile | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [view, setView] = useState<DatasetKey>("solar");
  const [metric, setMetric] = useState<Metric>("installations");
  const [sel, setSel] = useState<Partial<Record<StateCode, boolean>>>({});
  const [showPostcode, setShowPostcode] = useState(true);
  const [gran, setGran] = useState<"month" | "year">("month");
  const [fromYM, setFromYM] = useState("");
  const [toYM, setToYM] = useState("");
  const [life, setLife] = useState(25);
  const [vintageUnit, setVintageUnit] = useState<"installs" | "capacity" | "panels">("installs");

  useEffect(() => {
    loadData().then(setData).catch((e) => setErr(String(e?.message ?? e)));
  }, []);

  const bundle = data ? data[view] : null;
  const meta = data ? data.meta.datasets[view] : null;

  // reset range/selection/lifespan when the dataset changes (and on first load)
  useEffect(() => {
    if (!data) return;
    const m = data.meta.datasets[view];
    setFromYM(m.months[0]);
    setToYM(m.months[m.months.length - 1]);
    setSel({});
    setGran("month");
    setLife(m.assumedLifeYears);
    setVintageUnit("installs");
  }, [view, data]);

  const activeCodes = STATE_CODES.filter((c) => sel[c]);
  const selKey = activeCodes.join(",");
  const selectedForAgg: PostcodeState[] = activeCodes.length ? activeCodes : [...STATE_CODES, "OTHER"];

  const agg = useMemo(
    () => (bundle && fromYM && toYM ? aggregate(bundle, selectedForAgg, fromYM, toYM) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [bundle, fromYM, toYM, selKey],
  );
  const stTot = useMemo(
    () => (bundle && fromYM && toYM ? stateTotals(bundle, fromYM, toYM) : null),
    [bundle, fromYM, toYM],
  );
  // Per-state metric value for the map + bar. Memoised so AusMap's choropleth
  // effect only fires when the values actually change (stable object identity).
  const mapValues = useMemo(() => {
    const mv = {} as Record<StateCode, number>;
    if (stTot) for (const c of STATE_CODES) mv[c] = metricVal(stTot[c], metric);
    return mv;
  }, [stTot, metric]);

  if (err) {
    return <div className="rs-app density-regular"><div className="state-msg" role="alert">Could not load data: {err}</div></div>;
  }
  if (!data || !meta || !bundle || !agg || !stTot || !fromYM || !toYM) {
    return <div className="rs-app density-regular"><div className="state-msg" role="status" aria-live="polite"><span className="spinner" />Loading dashboard</div></div>;
  }

  const months = meta.months;
  const nowYear = data.meta.dataAsAtISO ? parseInt(data.meta.dataAsAtISO.slice(0, 4), 10) : new Date().getFullYear();
  const singular = view === "solar" ? "system" : "battery";

  // ---- handlers ----
  const pick = (code: StateCode) =>
    setSel((prev) => {
      const next = { ...prev };
      if (next[code]) delete next[code];
      else next[code] = true;
      return next;
    });
  const setAll = () => setSel({});
  const onFrom = (v: string) => { setFromYM(v); if (ymToNum(v) > ymToNum(toYM)) setToYM(v); };
  const onTo = (v: string) => { setToYM(v); if (ymToNum(v) < ymToNum(fromYM)) setFromYM(v); };
  const preset = (kind: string) => {
    const first = months[0], last = months[months.length - 1];
    if (kind === "all") { setFromYM(first); setToYM(last); return; }
    if (kind === "ytd") {
      const cand = last.split("-")[0] + "-01";
      setFromYM(ymToNum(cand) < ymToNum(first) ? first : cand);
      setToYM(last); return;
    }
    const back = kind === "1y" ? 11 : kind === "5y" ? 59 : 119;
    const start = ymToNum(last) - back;
    const idx = months.findIndex((s) => ymToNum(s) >= start);
    setFromYM(months[Math.max(0, idx)]);
    setToYM(last);
  };

  // ---- derived for views ----
  const metricLabel = metric === "capacity" ? "Capacity" : metric === "avg" ? "Avg size" : "Installations";
  const fmtMetric = (v: number) =>
    metric === "capacity" ? capacity(v, meta.sizeUnit) : metric === "avg" ? v.toFixed(1) + " " + meta.sizeUnit : commas(v);

  const barRows = STATE_CODES.map((c) => ({ code: c, name: STATE_NAMES[c], val: mapValues[c] })).sort((a, b) => b.val - a.val);

  // KPIs
  const capC = capacityCompact(agg.totalCapacity, meta.sizeUnit);
  const spkN = agg.months.map((m) => m.installs).slice(-36);
  const spkCap = agg.months.map((m) => m.capacity).slice(-36);
  const spkAvg = agg.months.map((m) => (m.installs ? m.capacity / m.installs : 0)).slice(-36);
  const yrs = byYear(agg.months);
  let avgDelta: number | null = null;
  if (yrs.length >= 2) {
    const la = yrs[yrs.length - 1], pa = yrs[yrs.length - 2];
    const lav = la.installs ? la.capacity / la.installs : 0;
    const pav = pa.installs ? pa.capacity / pa.installs : 0;
    if (pav) avgDelta = ((lav - pav) / pav) * 100;
  }
  // Latest COMPLETE month for the KPI: skip the trailing provisional (incomplete) months
  // so the headline figure is not an under-counted partial month.
  let lastCompleteIdx = -1;
  for (let i = agg.months.length - 1; i >= 0; i--) { if (!agg.months[i].incomplete) { lastCompleteIdx = i; break; } }
  const lastComplete = lastCompleteIdx >= 0 ? agg.months[lastCompleteIdx] : agg.latestMonth;
  const beforeComplete = lastCompleteIdx > 0 ? agg.months[lastCompleteIdx - 1] : null;
  const monthDelta =
    beforeComplete && beforeComplete.installs && lastComplete
      ? ((lastComplete.installs - beforeComplete.installs) / beforeComplete.installs) * 100
      : null;

  // time-series records (respect granularity)
  let tsRecords: MonthPoint[];
  if (gran === "year") {
    tsRecords = byYear(agg.months).map((y) => ({ ym: y.year + "-01", y: y.year, m: 1, installs: y.installs, capacity: y.capacity }));
  } else {
    tsRecords = agg.months;
  }

  const trendPoints = byYear(agg.months).map((y) => ({
    label: "'" + String(y.year).slice(2),
    full: String(y.year),
    v: y.installs ? y.capacity / y.installs : 0,
  }));

  const vintageYearly = byYear(agg.months);
  // The vintage view has its own count unit (Systems / Panels / Capacity), independent of the
  // global metric. Panels are solar-only and estimated; never offered for battery.
  const vintField: "installs" | "capacity" | "panels" = view === "battery" && vintageUnit === "panels" ? "installs" : vintageUnit;
  const vintageOpts: { value: "installs" | "capacity" | "panels"; label: string }[] =
    view === "solar"
      ? [{ value: "installs", label: "Systems" }, { value: "panels", label: "Panels" }, { value: "capacity", label: "Capacity" }]
      : [{ value: "installs", label: "Batteries" }, { value: "capacity", label: "Capacity" }];

  return (
    <div className="rs-app density-regular">
      <Header view={view} onView={setView} dataAsAt={data.meta.dataAsAt} />

      <FilterBar
        view={view}
        metric={metric}
        onMetric={setMetric}
        sel={sel}
        onPick={pick}
        onAll={setAll}
        months={months}
        fromYM={fromYM}
        toYM={toYM}
        onFrom={onFrom}
        onTo={onTo}
        onPreset={preset}
      />

      <main>
        {/* KPI row */}
        <div className="kpis">
          <Kpi id="n" label="Total installations" value={commas(agg.totalInstalls)} spark={spkN}
            delta={windowDelta(agg.months, "installs", 12)} deltaNote="vs prior 12mo" sub={meta.unitName} />
          <Kpi id="c" label="Total capacity" value={capC.v} unit={" " + capC.u} spark={spkCap}
            delta={windowDelta(agg.months, "capacity", 12)} deltaNote="vs prior 12mo" sub="installed" />
          <Kpi id="a" label="Average system size" value={agg.avg.toFixed(1)} unit={" " + meta.sizeUnit} spark={spkAvg}
            delta={avgDelta} deltaNote="vs prior year" sub={"per " + singular} />
          <Kpi id="l" label="Latest complete month" value={commas(lastComplete ? lastComplete.installs : 0)} spark={spkN.slice(-13)}
            delta={monthDelta} deltaNote={beforeComplete ? "vs " + MON[beforeComplete.m - 1] : ""}
            sub={lastComplete ? monthLong(lastComplete) : ""} />
        </div>

        {/* map + by-state bar */}
        <div className="grid grid-mapbar">
          <Panel
            title="Installations by location"
            sub="Choropleth by state; postcode heat overlay (cumulative)"
            action={
              <div className="panel-tools">
                <button type="button" className={"tgl" + (showPostcode ? " is-on" : "")} aria-pressed={showPostcode} onClick={() => setShowPostcode((s) => !s)}>
                  <span className="tgl-dot" />Postcode heat
                </button>
              </div>
            }
          >
            <div className="map-wrap">
              <AusMap metric={metric} metricLabel={metricLabel} view={view} stateValues={mapValues} active={sel} onPick={pick} showPostcode={showPostcode} fmt={fmtMetric} />
              <div className="heat-legend">
                <span className="hl-k">Low</span>
                <div className="hl-bar" />
                <span className="hl-k">High</span>
                <span className="hl-metric">{metricLabel}</span>
              </div>
            </div>
          </Panel>

          <Panel title="By state / territory" sub={metricLabel + " over selected range"}>
            <StateBar rows={barRows} active={sel} onPick={(c) => pick(c as StateCode)} fmt={fmtMetric} />
          </Panel>
        </div>

        {/* time series */}
        <Panel
          full
          title={(view === "solar" ? "Rooftop solar" : "Home battery") + " installations over time"}
          sub={"Monthly " + meta.unitName + " (orange) and capacity (dashed). " + (view === "battery" ? "Battery data from Jul 2025." : "Solar data from 2001.")}
          action={<Segmented value={gran} onChange={setGran} ariaLabel="Granularity" options={[{ value: "month", label: "Monthly" }, { value: "year", label: "Yearly" }]} />}
        >
          <TimeSeries months={tsRecords} metric={metric} mode={gran} sizeUnit={meta.sizeUnit} height={250} />
          <div className="note" style={{ marginTop: 12 }}>
            <span className="note-mark" aria-hidden="true">i</span>
            <span>
              Approved small-scale certificate (STC) installations as at {data.meta.dataAsAt}. Under the CER 12-month
              certificate-creation window the most recent {meta.incompleteMonths} months are incomplete and will rise in
              later updates (shown dashed{gran === "year" ? ", at the year level the final year is partial" : ""}).{" "}
              {view === "battery" ? "Government 'installed' headlines (about 400,000 batteries) include pending applications and exceed approved-STC counts. " : ""}
              Capacity is rated kW for solar and usable kWh for battery - the two are never combined.
            </span>
          </div>
        </Panel>

        {/* two-up: avg size + cumulative */}
        <div className="grid grid-two">
          <Panel title="Average system size" sub={"Yearly trend (" + meta.sizeUnit + ")"}>
            <LineTrend points={trendPoints} unit={meta.sizeUnit} rowLabel="Avg size" height={180} />
          </Panel>
          <Panel title="Cumulative capacity" sub="Running total installed capacity">
            <CumulativeArea months={agg.months} field="capacity" unit={meta.sizeUnit} height={180} />
          </Panel>
        </div>

        {/* vintage / arisings */}
        <Panel
          full
          title="Installation vintage and waste arisings"
          sub={"By year of installation, with an end-of-life band and a forward waste-arisings projection (arisings = the cohort installed " + life + " years earlier)."}
          action={
            <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
              <Segmented value={vintField} onChange={setVintageUnit} ariaLabel="Vintage count unit" options={vintageOpts} />
              <div className="life-ctl">
                <label htmlFor="life-slider" className="fk">Assumed life</label>
                <input id="life-slider" type="range" min={meta.lifeMin} max={meta.lifeMax} step={1} value={life} onChange={(e) => setLife(Number(e.target.value))} />
                <span className="life-val">{life} yrs</span>
              </div>
            </div>
          }
        >
          <Vintage yearly={vintageYearly} field={vintField} life={life} band={meta.bandYears} nowYear={nowYear} unitName={meta.unitName} sizeUnit={meta.sizeUnit} height={310} />
          {vintField === "panels" && (
            <div className="note" style={{ marginTop: 12 }}>
              <span className="note-mark" aria-hidden="true">i</span>
              <span>
                Panel counts are <strong>estimated</strong> - the CER records system capacity, not panel numbers. We divide installed
                capacity by the average module wattage for each install year (about 80 W in 2001 rising to about 440 W in 2026), so
                treat these as indicative of the number of panels reaching end-of-life.
              </span>
            </div>
          )}
        </Panel>
      </main>

      <Footer dataAsAt={data.meta.dataAsAt} historicSourceDate={data.meta.historicSourceDate} source={data.meta.source} />
    </div>
  );
}
