"use client";
/* Shared chart primitives: brand chart palette, width-measuring hook, SVG
   scale helpers and the floating tooltip. All hand-built SVG charts import
   from here so they stay visually consistent. */
import { useState, useRef, useLayoutEffect, type CSSProperties } from "react";

/** Chart palette (mirrors the ReSource Design System chart tokens). */
export const C = {
  orange: "#FFA100",
  orangeSoft: "#FFB733",
  base: "#5B5963", // neutral series fill
  baseHi: "#8C8996", // hover lighten
  grid: "#2C2A33", // faint gridlines
  faint: "#6A6873", // axis labels
  mute: "#9A98A4", // muted text
  track: "#211F26", // bar track
  appBg: "#161519",
  tipBg: "#0E0D11",
  tipBorder: "#3A3842",
  green: "#47A141",
  red: "#CC3524",
} as const;

/** Measure the rendered width of a container (for responsive SVG). */
export function useWidth(initial = 640): [React.RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement | null>(null);
  const [w, setW] = useState(initial);
  useLayoutEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver((entries) => {
      const cw = entries[0].contentRect.width;
      if (cw > 0) setW(cw);
    });
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

/** Round a max value up to a "nice" axis bound. */
export function niceMax(v: number): number {
  if (v <= 0) return 1;
  const exp = Math.floor(Math.log10(v));
  const base = Math.pow(10, exp);
  const f = v / base;
  const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
  return nice * base;
}

/** n+1 evenly spaced tick values from 0..max. */
export function ticks(max: number, n: number): number[] {
  const out: number[] = [];
  for (let i = 0; i <= n; i++) out.push((max * i) / n);
  return out;
}

/** Compact axis number, e.g. 12000 -> "12k", 1_500_000 -> "1.5M". */
export function shortNum(v: number): string {
  if (v >= 1e6) return (v / 1e6).toFixed(1).replace(/\.0$/, "") + "M";
  if (v >= 1e3) return (v / 1e3).toFixed(v >= 1e4 ? 0 : 1).replace(/\.0$/, "") + "k";
  return "" + Math.round(v);
}

export interface TooltipRow {
  label: string;
  value: string;
  accent?: boolean; // orange value
  dim?: boolean; // muted label
}

/** Floating tooltip card, absolutely positioned within a relative parent. */
export function Tooltip(props: { show: boolean; x: number; y: number; title: string; rows: TooltipRow[] }) {
  if (!props.show) return null;
  const style: CSSProperties = {
    position: "absolute",
    left: props.x,
    top: props.y,
    transform: "translate(-50%, calc(-100% - 12px))",
    pointerEvents: "none",
    zIndex: 20,
    background: C.tipBg,
    border: `1px solid ${C.tipBorder}`,
    borderRadius: 6,
    padding: "8px 10px",
    minWidth: 120,
    boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
    whiteSpace: "nowrap",
  };
  return (
    <div style={style} role="tooltip">
      <div style={{ fontSize: 11, letterSpacing: "0.04em", textTransform: "uppercase", color: C.mute, marginBottom: 4, fontWeight: 700 }}>
        {props.title}
      </div>
      {props.rows.map((r, i) => (
        <div key={i} style={{ display: "flex", justifyContent: "space-between", gap: 16, fontSize: 13, lineHeight: 1.5 }}>
          <span style={{ color: r.dim ? C.faint : "#CFCDD6" }}>{r.label}</span>
          <span style={{ color: r.accent ? C.orange : "#FFFFFF", fontWeight: 700, fontFamily: "var(--font-mono)" }}>{r.value}</span>
        </div>
      ))}
    </div>
  );
}
