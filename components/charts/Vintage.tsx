"use client";
/* Installation-vintage / forward waste-arisings chart (the signature chart).
   Install bars by vintage year, an "approaching end-of-life" band, a dashed
   forward waste-arisings projection with a faint gradient fill, and a NOW
   marker. Faithful port of the design prototype (vintage.jsx). */
import { useState } from "react";
import { C, useWidth, niceMax, shortNum, Tooltip } from "@/components/charts/primitives";
import type { YearPoint, SizeUnit } from "@/lib/types";
import { arisingsSeries, commas, capacity } from "@/lib/cer";

interface VintageProps {
  yearly: YearPoint[]; // installs/capacity by install year (aggregated over selection+range)
  field: "installs" | "capacity" | "panels";
  life: number; // assumed service life in years (slider-driven)
  band: number; // width of the "approaching end-of-life" band
  nowYear: number; // data-as-at year, for the NOW marker
  unitName: string; // "systems" | "batteries"
  sizeUnit: SizeUnit;
  height?: number; // default 300
}

interface LegendItemProps {
  color: string;
  label: string;
  dashed?: boolean;
}

function LegendItem(p: LegendItemProps) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      {p.dashed ? (
        <span style={{ width: 16, height: 0, borderTop: `2px dashed ${p.color}`, display: "inline-block" }} />
      ) : (
        <span style={{ width: 11, height: 11, borderRadius: 2, background: p.color, display: "inline-block" }} />
      )}
      {p.label}
    </span>
  );
}

export function Vintage(props: VintageProps) {
  const { field, life, band, nowYear, sizeUnit } = props;
  const [ref, W] = useWidth();
  const [hi, setHi] = useState(-1);
  const H = props.height ?? 300;
  const padL = 50,
    padR = 16,
    padT = 16,
    padB = 40;
  const iw = Math.max(10, W - padL - padR);
  const ih = H - padT - padB;

  const series = arisingsSeries(props.yearly, field, life, band, nowYear);
  const startY = series.length ? series[0].year : nowYear;

  const maxVal = niceMax(
    Math.max(
      Math.max(1, ...series.map((d) => d.value)),
      Math.max(1, ...series.map((d) => d.aris)),
    ),
  );
  const n = series.length;
  const slot = iw / n;
  const bw = Math.max(2, Math.min(slot * 0.62, 26));
  const X = (i: number) => padL + slot * (i + 0.5);
  const Y = (v: number) => padT + ih - (ih * v) / maxVal;

  // arisings path (line + filled area)
  let arisLine = "";
  let arisArea = "";
  series.forEach((d, i) => {
    const c = (i ? "L" : "M") + X(i).toFixed(1) + " " + Y(d.aris).toFixed(1) + " ";
    arisLine += c;
    arisArea += c;
  });
  arisArea += "L" + X(n - 1).toFixed(1) + " " + (padT + ih) + " L" + X(0).toFixed(1) + " " + (padT + ih) + " Z";

  // now marker position (between nowYear and nowYear+1), clamped to the plot
  const nowIdx = nowYear - startY;
  const nowVisible = nowIdx >= -1 && nowIdx <= n - 1;
  const nowX = Math.max(padL, Math.min(padL + iw, padL + slot * (nowIdx + 1)));

  const labelStep = Math.ceil(n / Math.max(6, Math.floor(iw / 42)));

  // approaching-EOL band: contiguous run of "approaching" years
  const aIdx = series.map((d, i) => (d.approaching ? i : -1)).filter((i) => i >= 0);
  const band0 = aIdx.length ? aIdx[0] : -1;
  const band1 = aIdx.length ? aIdx[aIdx.length - 1] : -1;
  const bandX0 = padL + slot * band0;
  const bandX1 = padL + slot * (band1 + 1);

  function onMove(e: React.MouseEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const i = Math.floor((e.clientX - rect.left - padL) / slot);
    setHi(Math.max(0, Math.min(n - 1, i)));
  }

  const hov = hi >= 0 ? series[hi] : null;
  const fmt = field === "capacity" ? (v: number) => capacity(v, sizeUnit) : (v: number) => commas(v);

  return (
    <div ref={ref} style={{ position: "relative", width: "100%" }}>
      <svg width={W} height={H} onMouseMove={onMove} onMouseLeave={() => setHi(-1)} style={{ display: "block" }}>
        <defs>
          <linearGradient id="aris-grad" x1={0} y1={0} x2={0} y2={1}>
            <stop offset="0%" stopColor={C.orangeSoft} stopOpacity={0.22} />
            <stop offset="100%" stopColor={C.orange} stopOpacity={0} />
          </linearGradient>
        </defs>

        {/* approaching-EOL band shading + label */}
        {band0 >= 0 && (
          <g>
            <rect x={bandX0} y={padT} width={bandX1 - bandX0} height={ih} fill={C.orange} opacity={0.07} />
            <text
              x={(bandX0 + bandX1) / 2}
              y={padT + 12}
              textAnchor="middle"
              fontSize={9.5}
              fill={C.orange}
              fontWeight={700}
              letterSpacing="0.04em"
            >
              APPROACHING END-OF-LIFE
            </text>
          </g>
        )}

        {/* y grid */}
        {[0, 0.25, 0.5, 0.75, 1].map((f, i) => {
          const v = maxVal * f;
          const yy = Y(v);
          return (
            <g key={i}>
              <line x1={padL} y1={yy} x2={padL + iw} y2={yy} stroke={C.grid} />
              <text
                x={padL - 8}
                y={yy + 3}
                textAnchor="end"
                fontSize={10}
                fill={C.faint}
                fontFamily="var(--font-mono)"
              >
                {shortNum(v)}
              </text>
            </g>
          );
        })}

        {/* install bars */}
        {series.map((d, i) => {
          if (!d.value) return null;
          const col = d.pastLife ? C.orangeSoft : d.approaching ? C.orange : C.base;
          return (
            <rect
              key={"b" + i}
              x={X(i) - bw / 2}
              y={Y(d.value)}
              width={bw}
              height={padT + ih - Y(d.value)}
              fill={col}
              rx={1.5}
              opacity={hi === i ? 1 : 0.95}
            />
          );
        })}

        {/* arisings projected area + line */}
        <path d={arisArea} fill="url(#aris-grad)" />
        <path d={arisLine} fill="none" stroke={C.orange} strokeWidth={2} strokeDasharray="5 4" strokeLinejoin="round" />

        {/* now marker (only when within the plotted year range) */}
        {nowVisible && (
          <g>
            <line x1={nowX} y1={padT - 4} x2={nowX} y2={padT + ih} stroke="#FFFFFF" strokeWidth={1} strokeOpacity={0.55} strokeDasharray="2 3" />
            <text x={nowX} y={padT - 7} textAnchor="middle" fontSize={9.5} fill="#FFFFFF" fontWeight={700} opacity={0.7}>
              NOW
            </text>
          </g>
        )}

        {/* x labels */}
        {series.map((d, i) =>
          i % labelStep === 0 ? (
            <text
              key={"x" + i}
              x={X(i)}
              y={H - 22}
              textAnchor="middle"
              fontSize={10}
              fill={C.faint}
              fontFamily="var(--font-mono)"
            >
              {"'" + String(d.year).slice(2)}
            </text>
          ) : null,
        )}

        {/* hover guide */}
        {hov ? <line x1={X(hi)} y1={padT} x2={X(hi)} y2={padT + ih} stroke="#FFFFFF" strokeOpacity={0.18} /> : null}
      </svg>

      {/* legend */}
      <div style={{ display: "flex", gap: 18, flexWrap: "wrap", padding: "2px 0 0 50px", fontSize: 11, color: C.mute }}>
        <LegendItem color={C.base} label={field === "panels" ? "Panels by year" : field === "capacity" ? "Capacity by year" : "Installs by year"} />
        <LegendItem color={C.orange} label="Approaching end-of-life" />
        <LegendItem color={C.orangeSoft} label={`Past assumed life (${life}y)`} />
        <LegendItem color={C.orange} dashed label="Projected waste arisings" />
      </div>

      <Tooltip
        show={!!hov}
        x={hov ? X(hi) : 0}
        y={hov ? Math.min(Y(hov.value), Y(hov.aris)) + 14 : 0}
        title={hov ? String(hov.year) + (hov.projected ? "  (projected)" : "") : ""}
        rows={
          hov
            ? [
                { label: "Installed", value: fmt(hov.value), accent: true },
                { label: "Waste arising", value: fmt(hov.aris), dim: !hov.aris },
              ]
            : []
        }
      />
    </div>
  );
}
