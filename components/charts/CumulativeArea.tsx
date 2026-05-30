"use client";
/* Cumulative area chart - running total of installs or capacity across
   months. Faithful port of the prototype CumulativeArea: orange line over a
   soft-orange to orange vertical gradient, 3 y ticks, sparse year x ticks at each
   January, and a hover guide/dot/tooltip. */
import { useState } from "react";
import { C, useWidth, niceMax, ticks, shortNum, Tooltip } from "@/components/charts/primitives";
import type { MonthPoint, SizeUnit } from "@/lib/types";
import { commas, capacity, monthLong } from "@/lib/cer";

interface CumulativeAreaProps {
  months: MonthPoint[];
  field: "installs" | "capacity";
  unit: SizeUnit;
  height?: number;
}

interface YearMark {
  i: number;
  label: string;
}

export function CumulativeArea(props: CumulativeAreaProps) {
  const months = props.months;
  const [ref, W] = useWidth();
  const [hi, setHi] = useState(-1);
  const H = props.height || 170;
  const padL = 46, padR = 16, padT = 14, padB = 24;
  const iw = Math.max(10, W - padL - padR), ih = H - padT - padB;

  const cum: number[] = [];
  let run = 0;
  months.forEach((m) => { run += props.field === "installs" ? m.installs : m.capacity; cum.push(run); });
  const max = niceMax(Math.max.apply(null, cum.concat([1])));
  const n = cum.length;
  const X = (i: number): number => (n <= 1 ? padL + iw / 2 : padL + (iw * i) / (n - 1));
  const Y = (v: number): number => padT + ih - (ih * v) / max;

  let line = "", area = "";
  cum.forEach((v, i) => { const c = (i ? "L" : "M") + X(i).toFixed(1) + " " + Y(v).toFixed(1) + " "; line += c; area += c; });
  area += "L" + X(n - 1).toFixed(1) + " " + (padT + ih) + " L" + X(0).toFixed(1) + " " + (padT + ih) + " Z";

  let yearMarks: YearMark[] = [];
  months.forEach((m, i) => { if (m.m === 1 || i === 0) yearMarks.push({ i, label: "'" + String(m.y).slice(2) }); });
  const maxLabels = Math.max(4, Math.floor(iw / 44));
  const step = Math.ceil(yearMarks.length / maxLabels);
  yearMarks = yearMarks.filter((_, k) => k % step === 0);

  function onMove(e: React.MouseEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const i = Math.round((e.clientX - rect.left - padL) / (iw / Math.max(1, n - 1)));
    setHi(Math.max(0, Math.min(n - 1, i)));
  }

  const fmt = props.field === "installs"
    ? (v: number): string => commas(v)
    : (v: number): string => capacity(v, props.unit);

  return (
    <div ref={ref} style={{ position: "relative", width: "100%" }}>
      <svg width={W} height={H} onMouseMove={onMove} onMouseLeave={() => setHi(-1)} style={{ display: "block" }}>
        <defs>
          <linearGradient id="cum-grad" x1={0} y1={0} x2={0} y2={1}>
            <stop offset="0%" stopColor={C.orangeSoft} stopOpacity={0.34} />
            <stop offset="100%" stopColor={C.orange} stopOpacity={0.02} />
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
        <path d={area} fill="url(#cum-grad)" />
        <path d={line} fill="none" stroke={C.orange} strokeWidth={2} />
        {yearMarks.map((mk, i) => (
          <text key={i} x={X(mk.i)} y={H - 7} textAnchor="middle" fontSize={10} fill={C.faint} fontFamily="var(--font-mono)">{mk.label}</text>
        ))}
        {hi >= 0 ? (
          <g>
            <line x1={X(hi)} y1={padT} x2={X(hi)} y2={padT + ih} stroke={C.orange} strokeOpacity={0.4} />
            <circle cx={X(hi)} cy={Y(cum[hi])} r={3.5} fill={C.orange} stroke={C.appBg} strokeWidth={2} />
          </g>
        ) : null}
      </svg>
      <Tooltip
        show={hi >= 0}
        x={hi >= 0 ? X(hi) : 0}
        y={hi >= 0 ? Y(cum[hi]) + 14 : 0}
        title={hi >= 0 ? monthLong(months[hi]) : ""}
        rows={hi >= 0 ? [{ label: "Cumulative", value: fmt(cum[hi]), accent: true }] : []}
      />
    </div>
  );
}
