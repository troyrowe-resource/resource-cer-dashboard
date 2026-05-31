"use client";
import { useState, useEffect, useMemo, type ReactNode, type DragEvent } from "react";
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

type CountUnit = "installs" | "capacity" | "panels";
const DEFAULT_ORDER = ["map", "cumulative", "vintage", "bystate", "timeseries", "avgsize"] as const;
const ORDER_KEY = "rs-panel-order-v1";

function Panel(props: { title: string; sub?: string; action?: ReactNode; dragHandle?: ReactNode; children: ReactNode }) {
  return (
    <div className="panel">
      <div className="panel-head">
        {props.dragHandle ?? null}
        <div style={{ flex: 1, minWidth: 0 }}>
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
  const [vintageUnit, setVintageUnit] = useState<CountUnit>("installs");
  const [cumUnit, setCumUnit] = useState<CountUnit>("capacity");
  const [cumLife, setCumLife] = useState(25);
  // panel order (drag-and-drop reorderable, persisted)
  const [order, setOrder] = useState<string[]>([...DEFAULT_ORDER]);
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [overKey, setOverKey] = useState<string | null>(null);

  useEffect(() => {
    loadData().then(setData).catch((e) => setErr(String(e?.message ?? e)));
  }, []);

  // restore a saved panel order
  useEffect(() => {
    try {
      const s = localStorage.getItem(ORDER_KEY);
      if (!s) return;
      const arr = JSON.parse(s);
      if (Array.isArray(arr) && arr.length === DEFAULT_ORDER.length && DEFAULT_ORDER.every((k) => arr.includes(k))) {
        setOrder(arr);
      }
    } catch { /* ignore */ }
  }, []);

  const bundle = data ? data[view] : null;
  const meta = data ? data.meta.datasets[view] : null;

  // reset range/selection/lifespan/units when the dataset changes (and on first load)
  useEffect(() => {
    if (!data) return;
    const m = data.meta.datasets[view];
    setFromYM(m.months[0]);
    setToYM(m.months[m.months.length - 1]);
    setSel({});
    setGran("month");
    setLife(m.assumedLifeYears);
    setCumLife(m.assumedLifeYears);
    setVintageUnit("installs");
    setCumUnit("capacity");
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
  const mapValues = useMemo(() => {
    const mv = {} as Record<StateCode, number>;
    if (stTot) for (const c of STATE_CODES) mv[c] = metricVal(stTot[c], metric);
    return mv;
  }, [stTot, metric]);

  // ---- drag-and-drop reordering ----
  const persistOrder = (o: string[]) => { try { localStorage.setItem(ORDER_KEY, JSON.stringify(o)); } catch { /* ignore */ } };
  const onDrop = (target: string) => {
    const from = dragKey;
    setDragKey(null);
    setOverKey(null);
    if (!from || from === target) return;
    setOrder((prev) => {
      const a = prev.filter((k) => k !== from);
      const i = a.indexOf(target);
      a.splice(i < 0 ? a.length : i, 0, from);
      persistOrder(a);
      return a;
    });
  };
  const handle = (key: string) => (
    <span
      className="drag-handle"
      draggable
      role="button"
      tabIndex={0}
      aria-label="Drag to reorder this panel"
      title="Drag to reorder"
      onDragStart={(e: DragEvent) => { setDragKey(key); e.dataTransfer.effectAllowed = "move"; try { e.dataTransfer.setData("text/plain", key); } catch { /* ignore */ } }}
      onDragEnd={() => { setDragKey(null); setOverKey(null); }}
    >
      &#x283F;
    </span>
  );

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
  let lastCompleteIdx = -1;
  for (let i = agg.months.length - 1; i >= 0; i--) { if (!agg.months[i].incomplete) { lastCompleteIdx = i; break; } }
  const lastComplete = lastCompleteIdx >= 0 ? agg.months[lastCompleteIdx] : agg.latestMonth;
  const beforeComplete = lastCompleteIdx > 0 ? agg.months[lastCompleteIdx - 1] : null;
  const monthDelta =
    beforeComplete && beforeComplete.installs && lastComplete
      ? ((lastComplete.installs - beforeComplete.installs) / beforeComplete.installs) * 100
      : null;

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
  const vintField: CountUnit = view === "battery" && vintageUnit === "panels" ? "installs" : vintageUnit;
  const cumField: CountUnit = view === "battery" && cumUnit === "panels" ? "capacity" : cumUnit;
  const unitOpts: { value: CountUnit; label: string }[] =
    view === "solar"
      ? [{ value: "installs", label: "Systems" }, { value: "panels", label: "Panels" }, { value: "capacity", label: "Capacity" }]
      : [{ value: "installs", label: "Batteries" }, { value: "capacity", label: "Capacity" }];

  const panelsNote = (
    <div className="note" style={{ marginTop: 12 }}>
      <span className="note-mark" aria-hidden="true">i</span>
      <span>
        Panel counts are <strong>estimated</strong> - the CER records system capacity, not panel numbers. We divide installed
        capacity by the average module wattage for each install year (about 80 W in 2001 rising to about 440 W in 2026), so
        treat these as indicative of the number of panels reaching end-of-life.
      </span>
    </div>
  );

  // ---- one renderer per draggable panel ----
  function renderPanel(key: string): ReactNode {
    // re-narrow for this closure (only ever called after the loading guard above)
    if (!data || !meta || !agg) return null;
    switch (key) {
      case "map":
        return (
          <Panel
            title="Installations by location"
            sub="Choropleth by state; postcode heat overlay (cumulative)"
            dragHandle={handle(key)}
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
        );
      case "bystate":
        return (
          <Panel title="By state / territory" sub={metricLabel + " over selected range"} dragHandle={handle(key)}>
            <StateBar rows={barRows} active={sel} onPick={(c) => pick(c as StateCode)} fmt={fmtMetric} />
          </Panel>
        );
      case "timeseries":
        return (
          <Panel
            title={(view === "solar" ? "Rooftop solar" : "Home battery") + " installations over time"}
            sub={"Monthly " + meta.unitName + " (orange) and capacity (dashed). " + (view === "battery" ? "Battery data from Jul 2025." : "Solar data from 2001.")}
            dragHandle={handle(key)}
            action={<Segmented value={gran} onChange={setGran} ariaLabel="Granularity" options={[{ value: "month", label: "Monthly" }, { value: "year", label: "Yearly" }]} />}
          >
            <TimeSeries months={tsRecords} metric={metric} mode={gran} sizeUnit={meta.sizeUnit} height={250} />
            <div className="note" style={{ marginTop: 12 }}>
              <span className="note-mark" aria-hidden="true">i</span>
              <span>
                Approved small-scale certificate (STC) installations as at {data!.meta.dataAsAt}. Under the CER 12-month
                certificate-creation window the most recent {meta!.incompleteMonths} months are incomplete and will rise in
                later updates (shown dashed{gran === "year" ? ", at the year level the final year is partial" : ""}).{" "}
                {view === "battery" ? "Government 'installed' headlines (about 400,000 batteries) include pending applications and exceed approved-STC counts. " : ""}
                Capacity is rated kW for solar and usable kWh for battery - the two are never combined.
              </span>
            </div>
          </Panel>
        );
      case "avgsize":
        return (
          <Panel title="Average system size" sub={"Yearly trend (" + meta.sizeUnit + ")"} dragHandle={handle(key)}>
            <LineTrend points={trendPoints} unit={meta.sizeUnit} rowLabel="Avg size" height={180} />
          </Panel>
        );
      case "cumulative":
        return (
          <Panel
            title="Cumulative capacity"
            sub="Running total over time, with the share that has reached end-of-life shaded (assumed life adjustable)."
            dragHandle={handle(key)}
            action={
              <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
                <Segmented value={cumField} onChange={setCumUnit} ariaLabel="Cumulative count unit" options={unitOpts} />
                <div className="life-ctl">
                  <label htmlFor="cum-life-slider" className="fk">Assumed life</label>
                  <input id="cum-life-slider" type="range" min={meta.lifeMin} max={meta.lifeMax} step={1} value={cumLife} onChange={(e) => setCumLife(Number(e.target.value))} />
                  <span className="life-val">{cumLife} yrs</span>
                </div>
              </div>
            }
          >
            <CumulativeArea months={agg.months} field={cumField} unit={meta.sizeUnit} life={cumLife} height={180} />
            {cumField === "panels" ? panelsNote : null}
          </Panel>
        );
      case "vintage":
        return (
          <Panel
            title="Installation vintage and waste arisings"
            sub={"By year of installation, with an end-of-life band and a forward waste-arisings projection (arisings = the cohort installed " + life + " years earlier)."}
            dragHandle={handle(key)}
            action={
              <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
                <Segmented value={vintField} onChange={setVintageUnit} ariaLabel="Vintage count unit" options={unitOpts} />
                <div className="life-ctl">
                  <label htmlFor="vintage-life-slider" className="fk">Assumed life</label>
                  <input id="vintage-life-slider" type="range" min={meta.lifeMin} max={meta.lifeMax} step={1} value={life} onChange={(e) => setLife(Number(e.target.value))} />
                  <span className="life-val">{life} yrs</span>
                </div>
              </div>
            }
          >
            <Vintage yearly={vintageYearly} field={vintField} life={life} band={meta.bandYears} nowYear={nowYear} unitName={meta.unitName} sizeUnit={meta.sizeUnit} height={310} />
            {vintField === "panels" ? panelsNote : null}
          </Panel>
        );
      default:
        return null;
    }
  }

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

        <div className="reorder-hint">Drag the &#x283F; handle on any panel to reorder the dashboard. Your layout is saved in this browser.</div>

        {/* reorderable panels */}
        <div className="reorder-list">
          {order.map((key) => (
            <div
              key={key}
              className={"reorder-slot" + (overKey === key && dragKey && dragKey !== key ? " drag-over" : "") + (dragKey === key ? " dragging" : "")}
              onDragOver={(e) => { if (!dragKey) return; e.preventDefault(); e.dataTransfer.dropEffect = "move"; if (overKey !== key) setOverKey(key); }}
              onDrop={(e) => { e.preventDefault(); onDrop(key); }}
            >
              {renderPanel(key)}
            </div>
          ))}
        </div>
      </main>

      <Footer dataAsAt={data.meta.dataAsAt} historicSourceDate={data.meta.historicSourceDate} source={data.meta.source} />
    </div>
  );
}
