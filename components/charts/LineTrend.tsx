"use client";
/* LineTrend - small orange line + gradient-area trend chart (e.g. yearly
   average system size). Faithful port of the design-prototype LineTrend:
   padL 40 / padR 16 / padT 14 / padB 24, default height 170, 3 y ticks,
   stepped x labels, hover guide + dot + floating tooltip. */
import { useState, type MouseEvent } from "react";
import { C, useWidth, niceMax, ticks, Tooltip } from "@/components/charts/primitives";

interface LineTrendPoint {
  label: string;
  full: string;
  v: number;
}

interface LineTrendProps {
  points: LineTrendPoint[];
  unit: string;
  rowLabel?: string;
  height?: number;
}

export function LineTrend(props: LineTrendProps) {
  const pts = props.points;
  const [ref, W] = useWidth();
  const [hi, setHi] = useState(-1);
  const H = props.height || 170;
  const padL = 40, padR = 16, padT = 14, padB = 24;
  const iw = Math.max(10, W - padL - padR), ih = H - padT - padB;

  const vals = pts.map((p) => p.v);
  const max = niceMax(Math.max.apply(null, vals.concat([1])));
  const n = pts.length;
  const X = (i: number): number => (n <= 1 ? padL + iw / 2 : padL + (iw * i) / (n - 1));
  const Y = (v: number): number => padT + ih - (ih * v) / max;

  let line = "", area = "";
  pts.forEach((p, i) => {
    const c = (i ? "L" : "M") + X(i).toFixed(1) + " " + Y(p.v).toFixed(1) + " ";
    line += c;
    area += c;
  });
  area += "L" + X(n - 1).toFixed(1) + " " + (padT + ih) + " L" + X(0).toFixed(1) + " " + (padT + ih) + " Z";

  const maxLabels = Math.max(4, Math.floor(iw / 40));
  const step = Math.ceil(n / maxLabels);

  function onMove(e: MouseEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const i = Math.round((e.clientX - rect.left - padL) / (iw / Math.max(1, n - 1)));
    setHi(Math.max(0, Math.min(n - 1, i)));
  }

  const hov = hi >= 0 && hi < n ? pts[hi] : null;

  return (
    <div ref={ref} style={{ position: "relative", width: "100%" }}>
      <svg width={W} height={H} onMouseMove={onMove} onMouseLeave={() => setHi(-1)} style={{ display: "block" }}>
        <defs>
          <linearGradient id="lt-grad" x1={0} y1={0} x2={0} y2={1}>
            <stop offset="0%" stopColor={C.orange} stopOpacity={0.28} />
            <stop offset="100%" stopColor={C.orange} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        {ticks(max, 3).map((t, i) => {
          const y = Y(t);
          return (
            <g key={i}>
              <line x1={padL} y1={y} x2={padL + iw} y2={y} stroke={C.grid} />
              <text x={padL - 8} y={y + 3} textAnchor="end" fontSize={10} fill={C.faint} fontFamily="var(--font-mono)">
                {t.toFixed(t < 10 ? 1 : 0)}
              </text>
            </g>
          );
        })}
        <path d={area} fill="url(#lt-grad)" />
        <path d={line} fill="none" stroke={C.orange} strokeWidth={2} />
        {pts.map((p, i) =>
          i % step === 0 ? (
            <text key={i} x={X(i)} y={H - 7} textAnchor="middle" fontSize={10} fill={C.faint} fontFamily="var(--font-mono)">
              {p.label}
            </text>
          ) : null,
        )}
        {hov ? (
          <g>
            <line x1={X(hi)} y1={padT} x2={X(hi)} y2={padT + ih} stroke={C.orange} strokeOpacity={0.4} />
            <circle cx={X(hi)} cy={Y(hov.v)} r={3.5} fill={C.orange} stroke={C.appBg} strokeWidth={2} />
          </g>
        ) : null}
      </svg>
      <Tooltip
        show={!!hov}
        x={hov ? X(hi) : 0}
        y={hov ? Y(hov.v) + 14 : 0}
        title={hov ? hov.full || hov.label : ""}
        rows={hov ? [{ label: props.rowLabel || "Value", value: hov.v.toFixed(1) + " " + (props.unit || ""), accent: true }] : []}
      />
    </div>
  );
}
