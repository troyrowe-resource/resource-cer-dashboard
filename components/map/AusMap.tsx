"use client";
/* Australia choropleth + postcode heat overlay, built on MapLibre GL JS with a
   token-free blank dark style (our own GeoJSON only - no external tiles).
   MapLibre is dynamically imported so it is lazy-loaded and never touches SSR. */
import { useEffect, useRef, useState } from "react";
import "maplibre-gl/dist/maplibre-gl.css";
import type { Map as MlMap, MapGeoJSONFeature } from "maplibre-gl";
import type { DatasetKey, Metric, StateCode } from "@/lib/types";
import { STATE_CODES, STATE_NAMES } from "@/lib/types";
import { loadPostcodes } from "@/lib/data";

// Heat ramp stops (low neutral -> mid -> brand orange).
const RAMP: [number, string][] = [
  [0, "#34323B"],
  [0.5, "#9C6118"],
  [1, "#FFA100"],
];
const GAMMA = 0.85;

// Approximate label anchor points (lon, lat). ACT nudged east so it clears NSW.
const LABEL_POS: Record<StateCode, [number, number]> = {
  NSW: [147.2, -32.3],
  VIC: [144.4, -36.9],
  QLD: [144.3, -22.6],
  WA: [121.5, -25.8],
  SA: [135.4, -30.3],
  TAS: [146.6, -42.0],
  ACT: [150.6, -35.5],
  NT: [133.6, -19.6],
};

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
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MlMap | null>(null);
  const readyRef = useRef(false);
  const pcAddedRef = useRef(false);
  const [ready, setReady] = useState(false);
  const [hover, setHover] = useState<HoverInfo | null>(null);
  const [labels, setLabels] = useState<{ code: StateCode; x: number; y: number }[]>([]);
  const [failed, setFailed] = useState(false);
  // keep latest props for event handlers without re-binding listeners
  const propsRef = useRef(props);
  propsRef.current = props;

  // ---- init once ----
  useEffect(() => {
    let cancelled = false;
    let map: MlMap | null = null;

    (async () => {
      try {
        const maplibregl = (await import("maplibre-gl")).default;
        if (cancelled || !containerRef.current) return;

        map = new maplibregl.Map({
          container: containerRef.current,
          style: {
            version: 8,
            sources: {},
            layers: [{ id: "bg", type: "background", paint: { "background-color": "#131216" } }],
          },
          attributionControl: false,
          dragRotate: false,
          renderWorldCopies: false,
          maxZoom: 7,
          minZoom: 1,
        });
        mapRef.current = map;
        // fixed choropleth: disable navigation gestures
        map.dragPan.disable();
        map.scrollZoom.disable();
        map.doubleClickZoom.disable();
        map.keyboard.disable();
        map.touchZoomRotate.disable();

        const res = await fetch("/geo/aus-states.geojson");
        if (!res.ok) throw new Error("states geojson " + res.status);
        const states = await res.json();

        await new Promise<void>((resolve) => map!.on("load", () => resolve()));
        if (cancelled) return;

        map.addSource("states", { type: "geojson", data: states, promoteId: "code" });

        // choropleth fill, driven by feature-state `t` (0..1, gamma-applied)
        map.addLayer({
          id: "states-fill",
          type: "fill",
          source: "states",
          paint: {
            "fill-color": [
              "interpolate", ["linear"], ["coalesce", ["feature-state", "t"], 0],
              RAMP[0][0], RAMP[0][1], RAMP[1][0], RAMP[1][1], RAMP[2][0], RAMP[2][1],
            ],
            "fill-opacity": ["case", ["boolean", ["feature-state", "dim"], false], 0.4, 1],
          },
        });
        map.addLayer({
          id: "states-line",
          type: "line",
          source: "states",
          paint: {
            "line-color": [
              "case",
              ["boolean", ["feature-state", "selected"], false], "#FFA100",
              ["boolean", ["feature-state", "hover"], false], "#FFFFFF",
              "#131216",
            ],
            "line-width": [
              "case",
              ["boolean", ["feature-state", "selected"], false], 2,
              ["boolean", ["feature-state", "hover"], false], 1.4,
              1,
            ],
          },
        });

        map.fitBounds([[112, -44], [154, -9.5]], { padding: 18, duration: 0 });

        // interactions
        let hoveredId: string | null = null;
        const setHoverState = (id: string | null, on: boolean) => {
          if (id == null) return;
          map!.setFeatureState({ source: "states", id }, { hover: on });
        };
        map.on("mousemove", "states-fill", (e) => {
          if (!e.features?.length) return;
          const f = e.features[0] as MapGeoJSONFeature;
          const code = f.id as StateCode;
          if (hoveredId !== code) {
            setHoverState(hoveredId, false);
            hoveredId = code;
            setHoverState(hoveredId, true);
          }
          map!.getCanvas().style.cursor = "pointer";
          setHover({ code, x: e.point.x, y: e.point.y });
        });
        map.on("mouseleave", "states-fill", () => {
          setHoverState(hoveredId, false);
          hoveredId = null;
          map!.getCanvas().style.cursor = "";
          setHover(null);
        });
        map.on("click", "states-fill", (e) => {
          if (!e.features?.length) return;
          const code = e.features[0].id as StateCode;
          propsRef.current.onPick(code);
        });

        const recomputeLabels = () => {
          if (!map) return;
          setLabels(
            STATE_CODES.map((code) => {
              const p = map!.project(LABEL_POS[code]);
              return { code, x: p.x, y: p.y };
            }),
          );
        };
        recomputeLabels();
        map.on("move", recomputeLabels);
        map.on("resize", recomputeLabels);

        readyRef.current = true;
        setReady(true);
      } catch (err) {
        console.error("AusMap init failed:", err);
        if (!cancelled) setFailed(true);
      }
    })();

    return () => {
      cancelled = true;
      readyRef.current = false;
      pcAddedRef.current = false;
      if (map) map.remove();
      mapRef.current = null;
    };
  }, []);

  // ---- choropleth values + selection ----
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const vals = STATE_CODES.map((c) => props.stateValues[c] || 0);
    const max = Math.max(1, ...vals);
    const anyActive = STATE_CODES.some((c) => props.active[c]);
    for (const code of STATE_CODES) {
      const v = props.stateValues[code] || 0;
      const t = Math.pow(v / max, GAMMA);
      const selected = !!props.active[code];
      map.setFeatureState(
        { source: "states", id: code },
        { t, selected, dim: anyActive && !selected },
      );
    }
  }, [props.stateValues, props.active, ready]);

  // ---- postcode heat overlay ----
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    let cancelled = false;

    (async () => {
      try {
        const pcFile = await loadPostcodes();
        if (cancelled || !mapRef.current) return;
        const weightProp = props.metric === "capacity" ? "capacity" : "installs";
        const pts = pcFile[props.view]
          .filter((p) => p.lat != null && p.lng != null && (p.installs > 0 || p.capacity > 0))
          .map((p) => ({
            type: "Feature" as const,
            geometry: { type: "Point" as const, coordinates: [p.lng as number, p.lat as number] },
            properties: { installs: p.installs, capacity: p.capacity },
          }));
        const fc = { type: "FeatureCollection" as const, features: pts };
        const maxW = Math.max(1, ...pts.map((f) => f.properties[weightProp as "installs" | "capacity"] as number));

        if (!pcAddedRef.current) {
          map.addSource("pc", { type: "geojson", data: fc });
          map.addLayer({
            id: "pc-heat",
            type: "heatmap",
            source: "pc",
            paint: {
              "heatmap-weight": ["interpolate", ["linear"], ["get", weightProp], 0, 0, maxW, 1],
              "heatmap-intensity": 1.1,
              "heatmap-radius": 16,
              "heatmap-opacity": 0.85,
              "heatmap-color": [
                "interpolate", ["linear"], ["heatmap-density"],
                0, "rgba(0,0,0,0)",
                0.2, "rgba(156,97,24,0.35)",
                0.5, "rgba(255,161,0,0.6)",
                1, "rgba(255,183,51,0.95)",
              ],
            },
          });
          pcAddedRef.current = true;
        } else {
          (map.getSource("pc") as maplibregl.GeoJSONSource).setData(fc);
          map.setPaintProperty("pc-heat", "heatmap-weight", ["interpolate", ["linear"], ["get", weightProp], 0, 0, maxW, 1]);
        }
        map.setLayoutProperty("pc-heat", "visibility", props.showPostcode ? "visible" : "none");
      } catch (err) {
        console.error("AusMap postcode layer failed:", err);
      }
    })();

    return () => { cancelled = true; };
  }, [props.showPostcode, props.view, props.metric, ready]);

  if (failed) {
    return (
      <div className="map-canvas state-msg" role="img" aria-label="Map unavailable">
        Map unavailable - the by-state chart below carries the same figures.
      </div>
    );
  }

  const anyActive = STATE_CODES.some((c) => props.active[c]);
  return (
    <div className="map-wrap">
      <div className="map-canvas" ref={containerRef} aria-label={`Choropleth of ${props.metricLabel} by state`} role="img" />
      {/* HTML state labels (no glyphs needed) */}
      {ready && labels.map((l) => {
        const selected = !!props.active[l.code];
        return (
          <span
            key={l.code}
            style={{
              position: "absolute", left: l.x, top: l.y, transform: "translate(-50%, -50%)",
              pointerEvents: "none", fontSize: l.code === "ACT" ? 10 : 12, fontWeight: 700,
              color: selected ? "#FFA100" : anyActive ? "rgba(207,205,214,0.55)" : "#CFCDD6",
              textShadow: "0 1px 3px rgba(0,0,0,0.8)", whiteSpace: "nowrap",
            }}
          >
            {l.code}
          </span>
        );
      })}
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
            <span style={{ color: "#FFA100", fontWeight: 700, fontFamily: "var(--font-mono)" }}>
              {props.fmt(props.stateValues[hover.code] || 0)}
            </span>
          </div>
          <div style={{ fontSize: 11, color: "#6A6873", marginTop: 3 }}>
            {props.active[hover.code] ? "Selected - click to remove" : "Click to filter"}
          </div>
        </div>
      )}
    </div>
  );
}
