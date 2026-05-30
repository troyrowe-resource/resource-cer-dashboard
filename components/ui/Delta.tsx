"use client";

/** Green up / red down percentage change with an optional caption. */
export function Delta(props: { value: number | null; note?: string }) {
  const v = props.value;
  if (v == null || !isFinite(v)) return null;
  const up = v >= 0;
  const col = up ? "var(--accent-green)" : "var(--delta-down)";
  return (
    <span className="delta" style={{ color: col }}>
      <span style={{ fontSize: 11 }} aria-hidden="true">{up ? "▲" : "▼"}</span>
      <span className="sr-only">{up ? "up " : "down "}</span>
      {Math.abs(v).toFixed(1)}%<span className="delta-cap"> {props.note ?? ""}</span>
    </span>
  );
}
