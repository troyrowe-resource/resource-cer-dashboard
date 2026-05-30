"use client";
import { Segmented } from "./ui/Segmented";
import { STATE_CODES, type StateCode, type DatasetKey, type Metric } from "@/lib/types";
import { ymLabel, ymToNum } from "@/lib/cer";

export function FilterBar(props: {
  view: DatasetKey;
  metric: Metric;
  onMetric: (m: Metric) => void;
  sel: Partial<Record<StateCode, boolean>>;
  onPick: (c: StateCode) => void;
  onAll: () => void;
  months: string[];
  fromYM: string;
  toYM: string;
  onFrom: (v: string) => void;
  onTo: (v: string) => void;
  onPreset: (k: string) => void;
}) {
  const anySel = STATE_CODES.some((c) => props.sel[c]);
  const presets = (["all", props.view === "solar" ? "10y" : null, "5y", "1y", "ytd"].filter(Boolean) as string[]);

  return (
    <div className="fbar">
      <div className="fgrp">
        <span className="fk">Dataset</span>
        <span className="pill pill--ds">{props.view === "solar" ? "Rooftop solar" : "Home battery"}</span>
      </div>

      <div className="fgrp">
        <span className="fk">States / territories</span>
        <div className="chips" role="group" aria-label="Filter by state or territory">
          <button type="button" className={"chip chip--all" + (!anySel ? " is-on" : "")} aria-pressed={!anySel} onClick={props.onAll}>
            All
          </button>
          {STATE_CODES.map((c) => (
            <button key={c} type="button" className={"chip" + (props.sel[c] ? " is-on" : "")} aria-pressed={!!props.sel[c]} onClick={() => props.onPick(c)}>
              {c}
            </button>
          ))}
        </div>
      </div>

      <div className="fgrp">
        <span className="fk">Time range</span>
        <div className="range-ctl">
          <select className="sel" aria-label="From month" value={props.fromYM} onChange={(e) => props.onFrom(e.target.value)}>
            {props.months.filter((s) => ymToNum(s) <= ymToNum(props.toYM)).map((s) => (
              <option key={s} value={s}>{ymLabel(s)}</option>
            ))}
          </select>
          <span className="range-arrow" aria-hidden="true">→</span>
          <select className="sel" aria-label="To month" value={props.toYM} onChange={(e) => props.onTo(e.target.value)}>
            {props.months.filter((s) => ymToNum(s) >= ymToNum(props.fromYM)).map((s) => (
              <option key={s} value={s}>{ymLabel(s)}</option>
            ))}
          </select>
          <div className="presets">
            {presets.map((k) => (
              <button key={k} type="button" className="preset" onClick={() => props.onPreset(k)}>{k.toUpperCase()}</button>
            ))}
          </div>
        </div>
      </div>

      <div className="fgrp">
        <span className="fk">Metric</span>
        <Segmented
          value={props.metric}
          onChange={props.onMetric}
          ariaLabel="Metric"
          options={[
            { value: "installations", label: "Installs" },
            { value: "capacity", label: "Capacity" },
            { value: "avg", label: "Avg size" },
          ]}
        />
      </div>
    </div>
  );
}
