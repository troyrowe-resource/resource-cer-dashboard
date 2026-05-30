"use client";
/* ============================================================
   StateBar - horizontal per-state bars, active highlighted,
   clickable + keyboard-operable. Faithful port of the prototype
   StateBar (rowH 26 / gap 8 / padL 44 / padR 64 / padT 6).
   ============================================================ */
import { useState, type KeyboardEvent } from "react";
import { C, useWidth, niceMax, shortNum } from "@/components/charts/primitives";
import type { PostcodeState } from "@/lib/types";

interface StateBarRow {
  code: PostcodeState;
  name: string;
  val: number;
}

interface StateBarProps {
  rows: StateBarRow[]; // pre-sorted descending by the parent
  active: Partial<Record<PostcodeState, boolean>>; // which states are selected
  onPick: (code: PostcodeState) => void; // toggle selection
  fmt: (v: number) => string; // value formatter from parent
  height?: number;
}

export function StateBar(props: StateBarProps) {
  const { rows, active, onPick } = props;
  // fmt is the parent-supplied formatter; fall back to shortNum (prototype default).
  const fmt: (v: number) => string = props.fmt ?? shortNum;
  const [ref, W] = useWidth();
  const [hi, setHi] = useState(-1);
  const [focus, setFocus] = useState(-1);

  const rowH = 26;
  const gap = 8;
  const padL = 44;
  const padR = 64;
  const padT = 6;
  const H = props.height ?? rows.length * (rowH + gap) + padT;
  const iw = Math.max(10, W - padL - padR);
  const max = niceMax(Math.max(...rows.map((r) => r.val).concat([1])));

  return (
    <div ref={ref} style={{ position: "relative", width: "100%" }}>
      <svg width={W} height={H} style={{ display: "block" }}>
        {rows.map((r, i) => {
          const y = padT + i * (rowH + gap);
          const bw = (iw * r.val) / max;
          const isActive = !!active[r.code];
          const isHover = hi === i;
          const fill = isActive ? C.orange : isHover ? C.baseHi : C.base;
          const onKeyDown = (e: KeyboardEvent<SVGRectElement>) => {
            if (e.key === "Enter" || e.key === " " || e.key === "Spacebar") {
              e.preventDefault();
              onPick(r.code);
            }
          };
          return (
            <g
              key={r.code}
              style={{ cursor: "pointer" }}
              onMouseEnter={() => setHi(i)}
              onMouseLeave={() => setHi(-1)}
              onClick={() => onPick(r.code)}
            >
              <text x={0} y={y + rowH * 0.66} fontSize={12} fill={isActive ? "#FFFFFF" : C.mute} fontWeight={700}>
                {r.code}
              </text>
              <rect x={padL} y={y + 3} width={iw} height={rowH - 6} fill={C.track} rx={2} />
              <rect
                x={padL}
                y={y + 3}
                width={Math.max(2, bw)}
                height={rowH - 6}
                fill={fill}
                rx={2}
                style={{ transition: "width 300ms ease, fill 120ms" }}
              />
              <text
                x={padL + iw + 8}
                y={y + rowH * 0.66}
                fontSize={12}
                fill={isActive ? C.orange : "#CFCDD6"}
                fontWeight={700}
                fontFamily="var(--font-mono)"
              >
                {fmt(r.val)}
              </text>
              {/* Keyboard-operable overlay: covers the whole row, carries focus + the visible ring. */}
              {focus === i && (
                <rect
                  x={1}
                  y={y - padT + 1}
                  width={Math.max(0, W - 2)}
                  height={rowH + gap - 2}
                  fill="none"
                  stroke={C.orange}
                  strokeWidth={2}
                  rx={3}
                  pointerEvents="none"
                />
              )}
              <rect
                x={0}
                y={y - padT}
                width={W}
                height={rowH + gap}
                fill="transparent"
                role="button"
                tabIndex={0}
                aria-label={`${r.name}: ${fmt(r.val)}, click to filter`}
                aria-pressed={isActive}
                style={{ cursor: "pointer", outline: "none" }}
                onKeyDown={onKeyDown}
                onFocus={() => setFocus(i)}
                onBlur={() => setFocus(-1)}
              />
            </g>
          );
        })}
      </svg>
    </div>
  );
}
