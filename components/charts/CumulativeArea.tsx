"use client";
/* Cumulative chart - running total of systems / panels (estimated) / capacity over time,
   with the portion that has reached end-of-life shaded. The end-of-life amount is the
   cumulative installed `life` years ago, so it grows as the assumed-life slider shrinks. */
import { useState } from "react";
import { C, useWidth, niceMax, ticks, shortNum, Tooltip } from "@/components/charts/primitives";
import type { MonthPoint, SizeUnit } from "@/lib/types";
import { commas, capacity, monthLong, panelsForYear } from "@/lib/cer";

interface CumulativeAreaProps {
  months: MonthPoint[];
  field: "installs" | "capacity" | "panels";
  unit: SizeUnit;
  life: number;
  height?: number;
}

function monthVal(m: MonthPoint, field: "installs" | "capacity" | "panels"): number {
  if (field === "capacity") return m.capacity;
  if (field === "panels") return panelsForYear(m.capacity, m.y);
  return m.installs;
}

export function CumulativeArea(props: CumulativeAreaProps) {
  const months = props.months;
  const [ref, W] = useWidth();
  const [hi, setHi] = useState(-1);
  const H = props.height || 180;
  const padL = 46, padR = 16, padT = 14, padB = 24;
  const iw = Math.max(10, W - padL - padR), ih = H - padT - padB;

  const cum: number[] = [], cumEol: number[] = [];
  let run = 0;
  const lag = Math.round(props.life * 12); // months of installs that are now past assumed life
  months.forEach((m, i) => {
    run += monthVal(m, props.field);
    cum.push(run);
    cumEol.push(i - lag >= 0 ? cum[i - lag] : 0);
  });
  const max = niceMax(Math.max.apply(null, cum.concat([1])));
  const n = cum.length;
  const X = (i: number): number => (n <= 1 ? padL + iw / 2 : padL + (iw * i) / (n - 1));
  const Y = (v: number): number => padT + ih - (ih * v) / max;

  const buildPath = (arr: number[]) => {
    let line = "", area = "";
    arr.forEach((v, i) => { const c = (i ? "L" : "M") + X(i).toFixed(1) + " " + Y(v).toFixed(1) + " "; line += c; area += c; });
    area += "L" + X(n - 1).toFixed(1) + " " + (padT + ih) + " L" + X(0).toFixed(1) + " " + (padT + ih) + " Z";
    return { line, area };
  };
  const total = buildPath(cum);
  const eol = buildPath(cumEol);

  let yearMarks: { i: number; label: string }[] = [];
  months.forEach((m, i) => { if (m.m === 1 || i === 0) yearMarks.push({ i, label: "'" + String(m.y).slice(2) }); });
  const maxLabels = Math.max(4, Math.floor(iw / 44));
  const step = Math.ceil(yearMarks.length / maxLabels);
  yearMarks = yearMarks.filter((_, k) => k % step === 0);

  function onMove(e: React.MouseEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const i = Math.round((e.clientX - rect.left - padL) / (iw / Math.max(1, n - 1)));
    setHi(Math.max(0, Math.min(n - 1, i)));
  }
  const fmt = props.field === "capacity" ? (v: number) => capacity(v, props.unit) : (v: number) => commas(v);

  return (
    <div ref={ref} style={{ position: "relative", width: "100%" }}>
      <svg width={W} height={H} onMouseMove={onMove} onMouseLeave={() => setHi(-1)} style={{ display: "block" }}>
        <defs>
          <linearGradient id="cum-grad" x1={0} y1={0} x2={0} y2={1}>
            <stop offset="0%" stopColor={C.orangeSoft} stopOpacity={0.3} />
            <stop offset="100%" stopColor={C.orange} stopOpacity={0.02} />
          </linearGradient>
          <linearGradient id="cum-eol" x1={0} y1={0} x2={0} y2={1}>
            <stop offset="0%" stopColor={C.orange} stopOpacity={0.5} />
            <stop offset="100%" stopColor={C.orange} stopOpacity={0.12} />
          </linearGradient>
        </defs>
        {ticks(max, 3).map((t, i) => {
          const y = Y(t);
          return (
            <g key={i}>
              <line x1={padL} y1={y} x2={padL + iw} y2={y} stroke={C.grid} />
              <text x={padL - 8} y={y + 3} textAnchor="end" fontSize={10} fill={C.faint} fontFamily="var(--font-mono)">{shortNum(t)}</text>
            </g>
          );
        })}
        {/* total cumulative */}
        <path d={total.area} fill="url(#cum-grad)" />
        <path d={total.line} fill="none" stroke={C.orange} strokeWidth={2} />
        {/* reached end-of-life (shaded band; grows as assumed life shrinks) */}
        <path d={eol.area} fill="url(#cum-eol)" />
        <path d={eol.line} fill="none" stroke={C.orange} strokeWidth={1.5} strokeDasharray="4 3" />
        {yearMarks.map((mk, i) => (
          <text key={i} x={X(mk.i)} y={H - 7} textAnchor="middle" fontSize={10} fill={C.faint} fontFamily="var(--font-mono)">{mk.label}</text>
        ))}
        {hi >= 0 ? (
          <g>
            <line x1={X(hi)} y1={padT} x2={X(hi)} y2={padT + ih} stroke={C.orange} strokeOpacity={0.4} />
            <circle cx={X(hi)} cy={Y(cum[hi])} r={3.5} fill={C.orange} stroke={C.appBg} strokeWidth={2} />
            {cumEol[hi] > 0 ? <circle cx={X(hi)} cy={Y(cumEol[hi])} r={3} fill={C.orangeSoft} stroke={C.appBg} strokeWidth={2} /> : null}
          </g>
        ) : null}
      </svg>
      <div style={{ display: "flex", gap: 18, flexWrap: "wrap", padding: "2px 0 0 46px", fontSize: 11, color: C.mute }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 11, height: 11, borderRadius: 2, background: C.orange, opacity: 0.45, display: "inline-block" }} />Cumulative installed
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 16, height: 0, borderTop: `2px dashed ${C.orange}`, display: "inline-block" }} />Reached end-of-life ({props.life}y)
        </span>
      </div>
      <Tooltip
        show={hi >= 0}
        x={hi >= 0 ? X(hi) : 0}
        y={hi >= 0 ? Y(cum[hi]) + 14 : 0}
        title={hi >= 0 ? monthLong(months[hi]) : ""}
        rows={hi >= 0 ? [
          { label: "Cumulative", value: fmt(cum[hi]), accent: true },
          { label: "Reached EOL", value: fmt(cumEol[hi]), dim: !cumEol[hi] },
        ] : []}
      />
    </div>
  );
}
