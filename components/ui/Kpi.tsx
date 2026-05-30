"use client";
import { Sparkline } from "./Sparkline";
import { Delta } from "./Delta";

export function Kpi(props: {
  id?: string;
  label: string;
  value: string;
  unit?: string;
  spark?: number[];
  delta?: number | null;
  deltaNote?: string;
  sub?: string;
}) {
  return (
    <div className="kpi">
      <div className="kpi-label">{props.label}</div>
      <div className="kpi-row">
        <div className="kpi-num">
          {props.value}
          {props.unit ? <span className="kpi-unit">{props.unit}</span> : null}
        </div>
        {props.spark && props.spark.length ? (
          <div className="kpi-spark">
            <Sparkline data={props.spark} id={props.id} />
          </div>
        ) : null}
      </div>
      {props.delta != null ? (
        <Delta value={props.delta} note={props.deltaNote} />
      ) : (
        <div className="kpi-sub">{props.sub ?? ""}</div>
      )}
    </div>
  );
}
