import { useMemo, useState } from "react";
import { formatNumber } from "../../format";

export interface DonutItem {
  label: string;
  value: number;
  color?: string;
}

interface DonutChartProps {
  data: DonutItem[];
  height?: number;
  emptyMessage?: string;
  valueFormatter?: (val: number) => string;
}

const DONUT_COLORS = [
  "#2563eb", // blue-600
  "#3b82f6", // blue-500
  "#0ea5e9", // sky-500
  "#06b6d4", // cyan-500
  "#14b8a6", // teal-500
  "#10b981", // emerald-500
  "#6366f1", // indigo-500
  "#8b5cf6", // purple-500
  "#f59e0b", // amber-500
];

export default function DonutChart({
  data,
  height = 260,
  emptyMessage = "No data available",
  valueFormatter = (v) => formatNumber(v),
}: DonutChartProps) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  const total = useMemo(() => {
    return data.reduce((acc, curr) => acc + curr.value, 0);
  }, [data]);

  const segments = useMemo(() => {
    if (total === 0) return [];
    let accumulatedAngle = 0;
    const radius = 70;
    const circumference = 2 * Math.PI * radius;

    return data.map((item, idx) => {
      const percentage = (item.value / total) * 100;
      const strokeDash = (percentage / 100) * circumference;
      const strokeOffset = -accumulatedAngle;
      accumulatedAngle += strokeDash;

      return {
        ...item,
        color: item.color || DONUT_COLORS[idx % DONUT_COLORS.length],
        percentage,
        strokeDash: `${strokeDash} ${circumference}`,
        strokeOffset,
      };
    });
  }, [data, total]);

  if (data.length === 0 || total === 0) {
    return (
      <div className="flex h-56 items-center justify-center text-sm text-slate-400">
        {emptyMessage}
      </div>
    );
  }

  const activeItem = hoveredIndex !== null ? segments[hoveredIndex] : null;

  return (
    <div
      className="grid grid-cols-1 sm:grid-cols-[200px_minmax(0,1fr)] items-center gap-6 w-full"
      style={{ minHeight: height }}
    >
      {/* Donut SVG */}
      <div className="relative mx-auto flex items-center justify-center w-48 h-48">
        <svg
          viewBox="0 0 200 200"
          className="w-full h-full -rotate-90 transform"
        >
          <circle
            cx="100"
            cy="100"
            r="70"
            className="stroke-slate-100"
            strokeWidth="28"
            fill="transparent"
          />
          {segments.map((seg, idx) => {
            const isHovered = hoveredIndex === idx;
            return (
              <circle
                key={seg.label}
                cx="100"
                cy="100"
                r="70"
                fill="transparent"
                stroke={seg.color}
                strokeWidth={isHovered ? "34" : "28"}
                strokeDasharray={seg.strokeDash}
                strokeDashoffset={seg.strokeOffset}
                className="cursor-pointer transition-all duration-200"
                onMouseEnter={() => setHoveredIndex(idx)}
                onMouseLeave={() => setHoveredIndex(null)}
              />
            );
          })}
        </svg>

        {/* Center callout */}
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none text-center px-4">
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest truncate max-w-[120px]">
            {activeItem ? activeItem.label : "Total Volume"}
          </span>
          <span className="text-xl font-black text-slate-900 tabular-nums">
            {activeItem
              ? valueFormatter(activeItem.value)
              : formatNumber(total)}
          </span>
          {activeItem ? (
            <span className="text-[11px] font-bold text-blue-600">
              {activeItem.percentage.toFixed(1)}% Share
            </span>
          ) : (
            <span className="text-[10px] text-slate-400">100% Total</span>
          )}
        </div>
      </div>

      {/* Legend & Breakdown bars */}
      <div className="w-full space-y-2">
        {segments.map((seg, idx) => {
          const isHovered = hoveredIndex === idx;
          return (
            <div
              key={seg.label}
              className={`p-2 rounded-lg cursor-pointer transition-all duration-150 border ${
                isHovered
                  ? "bg-blue-50/60 border-blue-200 shadow-xs"
                  : "bg-white border-slate-100 hover:bg-slate-50"
              }`}
              onMouseEnter={() => setHoveredIndex(idx)}
              onMouseLeave={() => setHoveredIndex(null)}
            >
              <div className="flex items-center justify-between text-xs mb-1">
                <div className="flex items-center gap-2 min-w-0 pr-2">
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: seg.color }}
                  />
                  <span className="font-semibold text-slate-800 truncate">
                    {seg.label}
                  </span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="font-bold tabular-nums text-slate-900">
                    {valueFormatter(seg.value)}
                  </span>
                  <span className="text-xs font-semibold tabular-nums px-1.5 py-0.2 rounded bg-slate-100 text-slate-600">
                    {seg.percentage.toFixed(1)}%
                  </span>
                </div>
              </div>

              {/* Mini progress track */}
              <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-300"
                  style={{
                    width: `${seg.percentage}%`,
                    backgroundColor: seg.color,
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
