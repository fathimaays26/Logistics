import { useMemo, useState } from "react";
import { formatNumber } from "../../format";

export interface StackedSegment {
  name: string;
  value: number;
  color: string;
}

export interface StackedBarItem {
  label: string;
  segments: StackedSegment[];
}

interface StackedHorizontalBarChartProps {
  data: StackedBarItem[];
  height?: number | string;
  emptyMessage?: string;
  showLegend?: boolean;
}

/**
 * Horizontal bars split into stacked segments. Used where a single category
 * needs to be compared on more than one measure at once (for example low-stock
 * and out-of-stock quantity for the same part).
 */
export default function StackedHorizontalBarChart({
  data,
  height = "auto",
  emptyMessage = "No data available",
  showLegend = true,
}: StackedHorizontalBarChartProps) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  const computedMax = useMemo(() => {
    const totals = data.map((item) =>
      item.segments.reduce((sum, segment) => sum + (Number(segment.value) || 0), 0),
    );
    const highest = Math.max(...totals, 0);
    return highest > 0 ? highest : 1;
  }, [data]);

  const legendItems = useMemo(() => {
    const seen = new Map<string, StackedSegment>();
    for (const item of data) {
      for (const segment of item.segments) {
        if (!seen.has(segment.name)) seen.set(segment.name, segment);
      }
    }
    return [...seen.values()];
  }, [data]);

  if (data.length === 0) {
    return (
      <div className="flex h-48 items-center justify-center text-sm text-slate-400">
        {emptyMessage}
      </div>
    );
  }

  return (
    <div className="w-full">
      {showLegend && legendItems.length > 1 && (
        <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1.5">
          {legendItems.map((segment) => (
            <div key={segment.name} className="flex items-center gap-1.5">
              <span
                className={`h-2 w-2 shrink-0 rounded-full ${segment.color}`}
              />
              <span className="text-[10px] font-semibold text-slate-600">
                {segment.name}
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="w-full space-y-3 overflow-y-auto pr-1" style={{ height }}>
        {data.map((item, idx) => {
          const total = item.segments.reduce(
            (sum, segment) => sum + (Number(segment.value) || 0),
            0,
          );
          const isHovered = hoveredIdx === idx;

          return (
            <div
              key={item.label + idx}
              className="group relative"
              onMouseEnter={() => setHoveredIdx(idx)}
              onMouseLeave={() => setHoveredIdx(null)}
            >
              <div className="mb-1 flex items-center justify-between gap-3 text-xs">
                <span
                  className="min-w-0 flex-1 truncate font-semibold text-slate-700"
                  title={item.label}
                >
                  {item.label}
                </span>
                <span className="shrink-0 font-bold tabular-nums text-slate-800">
                  {formatNumber(total)}
                </span>
              </div>

              <div className="flex h-2.5 w-full overflow-hidden rounded-md bg-slate-100">
                {item.segments.map((segment) => {
                  const value = Number(segment.value) || 0;
                  if (value <= 0) return null;
                  const pct = (value / computedMax) * 100;
                  return (
                    <div
                      key={segment.name}
                      className={`h-full transition-all ${segment.color} ${
                        isHovered ? "opacity-90" : "opacity-100"
                      }`}
                      style={{ width: `${Math.max(pct, 0.75)}%` }}
                      title={`${segment.name}: ${formatNumber(value)}`}
                    />
                  );
                })}
              </div>

              {isHovered && (
                <div className="pointer-events-none absolute -top-1 left-1/2 z-20 -translate-x-1/2 -translate-y-full rounded-md border border-slate-200 bg-white px-2 py-1 text-[10px] shadow-sm">
                  <div className="font-bold text-slate-800">{item.label}</div>
                  {item.segments.map((segment) => (
                    <div
                      key={segment.name}
                      className="flex items-center gap-1.5 text-slate-600"
                    >
                      <span
                        className={`h-1.5 w-1.5 rounded-full ${segment.color}`}
                      />
                      {segment.name}:{" "}
                      <span className="font-semibold tabular-nums">
                        {formatNumber(Number(segment.value) || 0)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
