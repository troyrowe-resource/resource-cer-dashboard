"use client";
import { Segmented } from "./ui/Segmented";
import type { DatasetKey } from "@/lib/types";

export function Header(props: { view: DatasetKey; onView: (v: DatasetKey) => void; dataAsAt: string }) {
  return (
    <header className="hd">
      <div className="hd-left">
        {/* Brand asset slot - swap public/brand/resource-logo-horizontal-white.png (or drop in an .svg and update this src) */}
        <img src="/brand/resource-logo-horizontal-white.png" alt="ReSource" className="hd-logo" />
        <div className="hd-divider" />
        <h1 className="hd-title">
          <span className="tw">Solar and Battery </span>
          <span className="tor">Installations</span>
        </h1>
      </div>
      <div className="hd-right">
        <Segmented
          value={props.view}
          onChange={props.onView}
          ariaLabel="Dataset: solar or battery"
          options={[
            { value: "solar", label: "Solar" },
            { value: "battery", label: "Battery" },
          ]}
        />
        <div className="hd-stamp">
          <span className="stamp-k">Data as at</span>
          <span className="stamp-v">{props.dataAsAt}</span>
        </div>
      </div>
    </header>
  );
}
