"use client";

/** Tiny inline sparkline for KPI cards: orange line + gradient fill. */
export function Sparkline(props: { data: number[]; id?: string; w?: number; h?: number }) {
  const data = props.data;
  if (!data.length) return null;
  const w = props.w ?? 96, h = props.h ?? 26, p = 2;
  const max = Math.max(...data), min = Math.min(...data);
  const rng = max - min || 1, n = data.length;
  const X = (i: number) => p + ((w - 2 * p) * i) / Math.max(1, n - 1);
  const Y = (v: number) => p + (h - 2 * p) * (1 - (v - min) / rng);
  let line = "", area = "";
  data.forEach((v, i) => {
    const c = (i ? "L" : "M") + X(i).toFixed(1) + " " + Y(v).toFixed(1) + " ";
    line += c; area += c;
  });
  area += "L" + X(n - 1).toFixed(1) + " " + (h - p) + " L" + X(0).toFixed(1) + " " + (h - p) + " Z";
  const gid = "spk" + (props.id ?? "");
  return (
    <svg width={w} height={h} style={{ display: "block" }} aria-hidden="true">
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#FFA100" stopOpacity={0.35} />
          <stop offset="100%" stopColor="#FFA100" stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gid})`} />
      <path d={line} fill="none" stroke="#FFA100" strokeWidth={1.5} />
    </svg>
  );
}
