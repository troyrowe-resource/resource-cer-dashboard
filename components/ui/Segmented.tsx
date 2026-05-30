"use client";

interface SegOption<T extends string> {
  value: T;
  label: string;
}

export function Segmented<T extends string>(props: {
  value: T;
  onChange: (v: T) => void;
  options: SegOption<T>[];
  ariaLabel?: string;
}) {
  return (
    <div className="seg" role="group" aria-label={props.ariaLabel}>
      {props.options.map((o) => {
        const on = o.value === props.value;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={on}
            className={"seg-btn" + (on ? " is-on" : "")}
            onClick={() => props.onChange(o.value)}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
