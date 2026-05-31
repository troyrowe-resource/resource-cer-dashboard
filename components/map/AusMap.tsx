"use client";
/* Australia choropleth + postcode heat overlay, rendered as plain SVG from the real
   ABS-derived state GeoJSON. No WebGL/MapLibre worker - so it renders deterministically
   on every load (MapLibre's worker never completed style-load on the host, leaving the
   map blank). Boundaries are the real polygons; the projection is a simple equirectangular
   fit (recognisable, not survey-grade), which is all a choropleth needs. */
import { useEffect, useMemo, useRef, useState } from "react";
import type { Feature, FeatureCollection, Position } from "geojson";
import type { DatasetKey, Metric, StateCode } from "@/lib/types";
import { STATE_CODES, STATE_NAMES } from "@/lib/types";
import { loadPostcodes } from "@/lib/data";

const GAMMA = 0.85;
const VB_W = 1000, VB_H = 900, PAD = 16;
// mainland + Tasmania frame (far offshore islands clip harmlessly)
const LON0 = 112.9, LON1 = 154.0, LAT0 = -43.8, LAT1 = -10.0;

function project(lon: number, lat: number): [number, number] {
  const x = PAD + ((lon - LON0) / (LON1 - LON0)) * (VB_W - 2 * PAD);
  const y = PAD + ((LAT1 - lat) / (LAT1 - LAT0)) * (VB_H - 2 * PAD);
  return [x, y];
}

const LABEL_POS: Record<StateCode, [number, number]> = {
  NSW: [147.0, -32.3], VIC: [144.2, -36.8], QLD: [144.2, -22.6], WA: [121.5, -25.8],
  SA: [135.3, -30.3], TAS: [146.7, -42.1], ACT: [151.6, -35.6], NT: [133.4, -19.6],
};

// heat ramp: low neutral -> mid -> brand orange
function hx(c: string): [number, number, number] { return [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)]; }
function toHex(r: number, g: number, b: number): string { return "#" + [r, g, b].map((v) => ("0" + Math.round(v).toString(16)).slice(-2)).join(""); }
function ramp(t: number): string {
  t = Math.max(0, Math.min(1, t));
  const c0 = hx("#34323B"), c1 = hx("#9C6118"), c2 = hx("#FFA100");
  const mix = (a: number[], b: number[], u: number) => toHex(a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u);
  return t < 0.5 ? mix(c0, c1, t / 0.5) : mix(c1, c2, (t - 0.5) / 0.5);
}

function ringsToPath(coords: Position[][]): string {
  let d = "";
  for (const ring of coords) {
    ring.forEach((pt, i) => { const [x, y] = project(pt[0], pt[1]); d += (i ? "L" : "M") + x.toFixed(1) + " " + y.toFixed(1) + " "; });
    d += "Z ";
  }
  return d;
}
function featurePath(f: Feature): string {
  const g = f.geometry;
  if (g.type === "Polygon") return ringsToPath(g.coordinates);
  if (g.type === "MultiPolygon") return g.coordinates.map(ringsToPath).join("");
  return "";
}

export interface AusMapProps {
  metric: Metric;
  metricLabel: string;
  view: DatasetKey;
  stateValues: Record<StateCode, number>;
  active: Partial<Record<StateCode, boolean>>;
  onPick: (code: StateCode) => void;
  showPostcode: boolean;
  fmt: (v: number) => string;
}

interface HoverInfo { code: StateCode; x: number; y: number; }

export default function AusMap(props: AusMapProps) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [geo, setGeo] = useState<FeatureCollection | null>(null);
  const [heat, setHeat] = useState<{ x: number; y: number; w: number }[]>([]);
  const [failed, setFailed] = useState(false);
  const [hover, setHover] = useState<HoverInfo | null>(null);

  // load state boundaries
  useEffect(() => {
    let cancelled = false;
    fetch("/geo/aus-states.geojson")
      .then((r) => { if (!r.ok) throw new Error("geojson " + r.status); return r.json(); })
      .then((g) => { if (!cancelled) setGeo(g as FeatureCollection); })
      .catch((e) => { console.error("AusMap geojson load failed:", e); if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, []);

  // postcode heat points (lazy; recomputed when dataset/metric/visibility changes)
  useEffect(() => {
    if (!props.showPostcode) { setHeat([]); return; }
    let cancelled = false;
    loadPostcodes()
      .then((pc) => {
        if (cancelled) return;
        const useCapacity = props.metric === "capacity";
        const pts = pc[props.view].filter((p) => p.lat != null && p.lng != null && (useCapacity ? p.capacity : p.installs) > 0);
        const max = Math.max(1, ...pts.map((p) => (useCapacity ? p.capacity : p.installs)));
        setHeat(pts.map((p) => {
          const [x, y] = project(p.lng as number, p.lat as number);
          return { x, y, w: Math.pow((useCapacity ? p.capacity : p.installs) / max, 0.5) };
        }));
      })
      .catch((e) => console.error("AusMap postcodes failed:", e));
    return () => { cancelled = true; };
  }, [props.showPostcode, props.view, props.metric]);

  const paths = useMemo(() => {
    if (!geo) return [];
    return geo.features
      .map((f) => ({ code: (f.properties?.code ?? "") as StateCode, d: featurePath(f) }))
      .filter((s) => STATE_CODES.includes(s.code));
  }, [geo]);

  if (failed) {
    return (
      <div className="map-canvas state-msg" role="img" aria-label="Map unavailable">
        Map unavailable - the by-state chart below carries the same figures.
      </div>
    );
  }

  const max = Math.max(1, ...STATE_CODES.map((c) => props.stateValues[c] || 0));
  const anyActive = STATE_CODES.some((c) => props.active[c]);

  function onMove(e: React.MouseEvent, code: StateCode) {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    setHover({ code, x: e.clientX - rect.left, y: e.clientY - rect.top });
  }

  return (
    <div className="map-canvas" ref={wrapRef} style={{ position: "relative" }}>
      <svg viewBox={`0 0 ${VB_W} ${VB_H}`} width="100%" height="100%" preserveAspectRatio="xMidYMid meet" style={{ display: "block" }} role="img" aria-label={`Choropleth of ${props.metricLabel} by state`}>
        {/* state fills */}
        {paths.map((s) => {
          const v = props.stateValues[s.code] || 0;
          const sel = !!props.active[s.code];
          const dim = anyActive && !sel;
          return (
            <path
              key={s.code}
              d={s.d}
              fillRule="evenodd"
              fill={ramp(Math.pow(v / max, GAMMA))}
              stroke={sel ? "#FFA100" : hover?.code === s.code ? "#FFFFFF" : "#131216"}
              strokeWidth={sel ? 2.5 : hover?.code === s.code ? 1.6 : 1}
              opacity={dim ? 0.45 : 1}
              style={{ cursor: "pointer", transition: "opacity 150ms, fill 200ms" }}
              onMouseEnter={(e) => onMove(e, s.code)}
              onMouseMove={(e) => onMove(e, s.code)}
              onMouseLeave={() => setHover(null)}
              onClick={() => props.onPick(s.code)}
            />
          );
        })}
        {/* postcode heat overlay */}
        {props.showPostcode && heat.length > 0 && (
          <g style={{ mixBlendMode: "screen", pointerEvents: "none" }}>
            {heat.map((h, i) => (
              <circle key={i} cx={h.x} cy={h.y} r={1.4 + h.w * 5} fill="#FFA100" opacity={0.1 + h.w * 0.45} />
            ))}
          </g>
        )}
        {/* state labels */}
        {paths.length > 0 && STATE_CODES.map((code) => {
          const [x, y] = project(LABEL_POS[code][0], LABEL_POS[code][1]);
          const sel = !!props.active[code];
          return (
            <text key={code} x={x} y={y} textAnchor="middle" fontSize={code === "ACT" ? 15 : 19} fontWeight={700} pointerEvents="none"
              fill={sel ? "#FFA100" : anyActive ? "rgba(207,205,214,0.55)" : "#E7E6EA"} style={{ paintOrder: "stroke", stroke: "rgba(0,0,0,0.55)", strokeWidth: 3 }}>
              {code}
            </text>
          );
        })}
      </svg>
      {hover && (
        <div
          style={{
            position: "absolute", left: hover.x, top: hover.y,
            transform: "translate(-50%, calc(-100% - 14px))", pointerEvents: "none", zIndex: 20,
            background: "#0E0D11", border: "1px solid #3A3842", borderRadius: 6, padding: "8px 10px",
            whiteSpace: "nowrap", boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
          }}
        >
          <div style={{ fontSize: 12, color: "#FFF", fontWeight: 800, marginBottom: 2 }}>{STATE_NAMES[hover.code]}</div>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 14, fontSize: 13 }}>
            <span style={{ color: "#9A98A4" }}>{props.metricLabel}</span>
            <span style={{ color: "#FFA100", fontWeight: 700, fontFamily: "var(--font-mono)" }}>{props.fmt(props.stateValues[hover.code] || 0)}</span>
          </div>
          <div style={{ fontSize: 11, color: "#6A6873", marginTop: 3 }}>{props.active[hover.code] ? "Selected - click to remove" : "Click to filter"}</div>
        </div>
      )}
    </div>
  );
}
