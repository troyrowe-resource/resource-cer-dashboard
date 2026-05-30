"use client";
/* ReSource CER dashboard - TimeSeries chart.
   Primary metric as an orange line + gradient area, secondary dimension as a
   thin neutral dashed line on its own right-hand scale. Trailing CER 12-month
   STC-window months are flagged "incomplete": shown with a faint band, dashed
   line segments and a "(provisional)" tooltip suffix. Faithful port of the
   design prototype's TimeSeries (paddings, strokes, gradient, tick logic). */
import { useState } from "react";
import { C, useWidth, niceMax, ticks, shortNum, Tooltip } from "@/components/charts/primitives";
import type { MonthPoint, Metric, SizeUnit } from "@/lib/types";
import { metricVal, commas, capacity, monthLong } from "@/lib/cer";

interface TimeSeriesProps {
  months: MonthPoint[]; // already aggregated over selected states + range, ascending
  metric: Metric; // primary series selector
  mode: "month" | "year"; // affects x tick density / tooltip title
  sizeUnit: SizeUnit; // unit for the avg-size tooltip row
  lineOnly?: boolean; // when true, suppress the gradient area
  height?: number; // default 250
}

export function TimeSeries(props: TimeSeriesProps) {
  const { months, metric } = props;
  const [ref, W] = useWidth();
  const [hi, setHi] = useState(-1);
  const H = props.height ?? 250;
  const padL = 46, padR = 48, padT = 14, padB = 26;
  const iw = Math.max(10, W - padL - padR), ih = H - padT - padB;

  const prim = months.map((m) => metricVal(m, metric));
  const primMax = niceMax(Math.max(...prim, 1));
  // secondary series: installs when the primary is capacity, else capacity.
  const secIsInstalls = metric === "capacity";
  const sec = months.map((m) => (secIsInstalls ? m.installs : m.capacity));
  const secMax = niceMax(Math.max(...sec, 1));

  const n = months.length;
  const X = (i: number): number => (n <= 1 ? padL + iw / 2 : padL + (iw * i) / (n - 1));
  const Yp = (v: number): number => padT + ih - (ih * v) / primMax;
  const Ys = (v: number): number => padT + ih - (ih * v) / secMax;

  let areaPath = "", linePath = "", secPath = "";
  months.forEach((m, i) => {
    const x = X(i), y = Yp(prim[i]);
    linePath += (i ? "L" : "M") + x.toFixed(1) + " " + y.toFixed(1) + " ";
    areaPath += (i ? "L" : "M") + x.toFixed(1) + " " + y.toFixed(1) + " ";
    secPath += (i ? "L" : "M") + x.toFixed(1) + " " + Ys(sec[i]).toFixed(1) + " ";
  });
  areaPath += "L" + X(n - 1).toFixed(1) + " " + (padT + ih) + " L" + X(0).toFixed(1) + " " + (padT + ih) + " Z";

  // Incomplete (provisional) trailing months: a dashed overlay over any segment
  // touching an incomplete month, plus a faint band spanning their x-extent.
  let dashPath = "";
  months.forEach((m, i) => {
    if (i === 0) return;
    const prev = months[i - 1];
    if (m.incomplete || prev.incomplete) {
      dashPath +=
        "M" + X(i - 1).toFixed(1) + " " + Yp(prim[i - 1]).toFixed(1) + " " +
        "L" + X(i).toFixed(1) + " " + Yp(prim[i]).toFixed(1) + " ";
    }
  });
  let firstIncomplete = -1;
  for (let i = 0; i < n; i++) {
    if (months[i].incomplete) { firstIncomplete = i; break; }
  }
  const bandX = firstIncomplete >= 0 ? X(firstIncomplete) : 0;
  const bandW = firstIncomplete >= 0 ? Math.max(0, X(n - 1) - bandX) : 0;

  // x tick labels (years): mark January of each year (and index 0), thinned out.
  const yearMode = props.mode === "year";
  let yearMarks: { i: number; label: string }[] = [];
  months.forEach((m, i) => {
    if (yearMode || m.m === 1 || i === 0) yearMarks.push({ i, label: "'" + String(m.y).slice(2) });
  });
  const maxLabels = Math.max(4, Math.floor(iw / 46));
  const step = Math.ceil(yearMarks.length / maxLabels);
  yearMarks = yearMarks.filter((_, k) => k % step === 0);

  function onMove(e: React.MouseEvent<SVGSVGElement>): void {
    const rect = e.currentTarget.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    let i = Math.round((mx - padL) / (iw / Math.max(1, n - 1)));
    i = Math.max(0, Math.min(n - 1, i));
    setHi(i);
  }
  const hov = hi >= 0 && hi < n ? months[hi] : null;
  const avg = hov && hov.installs ? hov.capacity / hov.installs : 0;
  const gid = "ts-grad-" + metric;

  return (
    <div ref={ref} style={{ position: "relative", width: "100%" }}>
      <svg width={W} height={H} onMouseMove={onMove} onMouseLeave={() => setHi(-1)} style={{ display: "block" }}>
        <defs>
          <linearGradient id={gid} x1={0} y1={0} x2={0} y2={1}>
            <stop offset="0%" stopColor={C.orange} stopOpacity={0.42} />
            <stop offset="100%" stopColor={C.orange} stopOpacity={0.03} />
          </linearGradient>
        </defs>
        {/* faint provisional band over incomplete trailing months */}
        {bandW > 0 ? (
          <rect x={bandX} y={padT} width={bandW} height={ih} fill={C.orange} opacity={0.05} />
        ) : null}
        {ticks(primMax, 4).map((t, i) => {
          const y = Yp(t);
          return (
            <g key={i}>
              <line x1={padL} y1={y} x2={padL + iw} y2={y} stroke={C.grid} strokeWidth={1} />
              <text x={padL - 8} y={y + 3} textAnchor="end" fontSize={10} fill={C.faint} fontFamily="var(--font-mono)">
                {shortNum(t)}
              </text>
            </g>
          );
        })}
        {/* secondary line (neutral, right axis) */}
        <path d={secPath} fill="none" stroke={C.base} strokeWidth={1.5} strokeOpacity={0.7} strokeDasharray="3 3" />
        {/* primary area + line */}
        {props.lineOnly ? null : <path d={areaPath} fill={`url(#${gid})`} />}
        <path d={linePath} fill="none" stroke={C.orange} strokeWidth={2} />
        {/* dashed overlay for provisional segments */}
        {dashPath ? <path d={dashPath} fill="none" stroke={C.orange} strokeWidth={2} strokeDasharray="4 3" /> : null}
        {yearMarks.map((mk, i) => (
          <text key={i} x={X(mk.i)} y={H - 8} textAnchor="middle" fontSize={10} fill={C.faint} fontFamily="var(--font-mono)">
            {mk.label}
          </text>
        ))}
        {/* right axis label for secondary */}
        <text x={padL + iw + 6} y={padT + 4} textAnchor="start" fontSize={9} fill={C.faint}>
          {secIsInstalls ? "installs" : props.sizeUnit}
        </text>
        {hov ? (
          <g>
            <line x1={X(hi)} y1={padT} x2={X(hi)} y2={padT + ih} stroke={C.orange} strokeWidth={1} strokeOpacity={0.5} />
            <circle cx={X(hi)} cy={Yp(prim[hi])} r={3.5} fill={C.orange} stroke={C.appBg} strokeWidth={2} />
          </g>
        ) : null}
      </svg>
      <Tooltip
        show={!!hov}
        x={hov ? X(hi) : 0}
        y={hov ? Yp(prim[hi]) + 14 : 0}
        title={hov ? (yearMode ? String(hov.y) : monthLong(hov)) + (hov.incomplete ? "  (provisional)" : "") : ""}
        rows={
          hov
            ? [
                { label: "Installs", value: commas(hov.installs), accent: true },
                { label: "Capacity", value: capacity(hov.capacity, props.sizeUnit) },
                { label: "Avg size", value: avg.toFixed(1) + " " + props.sizeUnit, dim: true },
              ]
            : []
        }
      />
    </div>
  );
}
