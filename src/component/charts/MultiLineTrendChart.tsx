import { useMemo, useState } from "react";
import { formatNumber } from "../../format";

export interface LineSeries {
  name: string;
  color: string;
  data: number[]; // parallel to labels array
}

interface MultiLineTrendChartProps {
  labels: string[]; // e.g. ["Jan", "Feb", "Mar", ...]
  series: LineSeries[];
  valueFormatter?: (val: number) => string;
  height?: number;
  emptyMessage?: string;
  yMin?: number;
  yMax?: number;
  onPointClick?: (label: string) => void;
}

const PALETTE = [
  "#2563eb", // blue-600
  "#0d9488", // teal-600
  "#f59e0b", // amber-500
  "#e11d48", // rose-600
  "#8b5cf6", // violet-500
  "#06b6d4", // cyan-500
  "#10b981", // emerald-500
  "#ec4899", // pink-500
];

export default function MultiLineTrendChart({
  labels,
  series,
  valueFormatter = (v) => formatNumber(v),
  height = 260,
  emptyMessage = "No trend data available",
  yMin,
  yMax,
  onPointClick,
}: MultiLineTrendChartProps) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  const seriesWithColors = useMemo(() => {
    return series.map((s, idx) => ({
      ...s,
      color: s.color || PALETTE[idx % PALETTE.length],
    }));
  }, [series]);

  // Compute scale boundaries
  const { computedMin, computedMax } = useMemo(() => {
    let min = typeof yMin === "number" ? yMin : Infinity;
    let max = typeof yMax === "number" ? yMax : -Infinity;

    for (const s of series) {
      for (const val of s.data) {
        if (typeof yMin !== "number" && val < min) min = val;
        if (typeof yMax !== "number" && val > max) max = val;
      }
    }

    if (!Number.isFinite(min)) min = 0;
    if (!Number.isFinite(max) || max === min) max = min + 10;

    // Pad top by 10%
    const padding = (max - min) * 0.1 || 1;
    const finalMin =
      typeof yMin === "number" ? yMin : Math.max(0, min - padding);
    const finalMax = typeof yMax === "number" ? yMax : max + padding;

    return { computedMin: finalMin, computedMax: finalMax };
  }, [series, yMin, yMax]);

  const range = computedMax - computedMin || 1;

  // ViewBox coordinate space: 700 x 240
  const width = 700;
  const chartHeight = 220;
  const paddingLeft = 45;
  const paddingRight = 20;
  const paddingTop = 15;
  const paddingBottom = 25;
  const plotWidth = width - paddingLeft - paddingRight;
  const plotHeight = chartHeight - paddingTop - paddingBottom;

  const pointsBySeries = useMemo(() => {
    if (labels.length === 0) return [];
    const stepX =
      labels.length > 1 ? plotWidth / (labels.length - 1) : plotWidth / 2;

    return seriesWithColors.map((s) => {
      const coords = s.data.map((val, idx) => {
        const x =
          paddingLeft + (labels.length > 1 ? idx * stepX : plotWidth / 2);
        const yNorm = (val - computedMin) / range;
        const y = paddingTop + plotHeight - yNorm * plotHeight;
        return { x, y, val };
      });

      let pathD = "";
      let areaD = "";
      if (coords.length > 0) {
        pathD = `M ${coords[0].x} ${coords[0].y}`;
        for (let i = 1; i < coords.length; i++) {
          pathD += ` L ${coords[i].x} ${coords[i].y}`;
        }
        areaD = `${pathD} L ${coords[coords.length - 1].x} ${paddingTop + plotHeight} L ${coords[0].x} ${paddingTop + plotHeight} Z`;
      }

      return {
        ...s,
        coords,
        pathD,
        areaD,
      };
    });
  }, [labels, seriesWithColors, plotWidth, plotHeight, computedMin, range]);

  if (labels.length === 0 || series.length === 0) {
    return (
      <div className="flex h-56 items-center justify-center text-sm text-slate-400">
        {emptyMessage}
      </div>
    );
  }

  // Y-axis tick marks (5 marks)
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((pct) => {
    const val = computedMin + pct * range;
    const y = paddingTop + plotHeight - pct * plotHeight;
    return { val, y };
  });

  const isSingle = seriesWithColors.length === 1;

  return (
    <div className="w-full flex flex-col justify-between">
      {/* Legend */}
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs border-b border-slate-100 pb-2">
        {seriesWithColors.map((s) => (
          <div key={s.name} className="flex items-center gap-1.5">
            <span
              className="h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: s.color }}
            />
            <span className="font-semibold text-slate-700">{s.name}</span>
          </div>
        ))}
      </div>

      <div className="relative w-full overflow-hidden" style={{ height }}>
        <svg
          viewBox={`0 0 ${width} ${chartHeight}`}
          className="w-full h-full overflow-visible"
        >
          <defs>
            {seriesWithColors.map((s, i) => (
              <linearGradient
                key={s.name + i}
                id={`gradient-${i}`}
                x1="0"
                y1="0"
                x2="0"
                y2="1"
              >
                <stop offset="0%" stopColor={s.color} stopOpacity="0.25" />
                <stop offset="100%" stopColor={s.color} stopOpacity="0.0" />
              </linearGradient>
            ))}
          </defs>

          {/* Grid lines */}
          {yTicks.map((tick, idx) => (
            <g key={idx}>
              <line
                x1={paddingLeft}
                y1={tick.y}
                x2={width - paddingRight}
                y2={tick.y}
                stroke="#f1f5f9"
                strokeWidth="1"
              />
              <text
                x={paddingLeft - 8}
                y={tick.y + 3}
                textAnchor="end"
                fontSize="10"
                fill="#94a3b8"
                fontFamily="inherit"
                fontWeight="500"
              >
                {valueFormatter(tick.val)}
              </text>
            </g>
          ))}

          {/* X axis labels */}
          {labels.map((lbl, idx) => {
            const stepX =
              labels.length > 1
                ? plotWidth / (labels.length - 1)
                : plotWidth / 2;
            const x =
              paddingLeft + (labels.length > 1 ? idx * stepX : plotWidth / 2);
            return (
              <text
                key={lbl + idx}
                x={x}
                y={chartHeight - 6}
                textAnchor="middle"
                fontSize="10"
                fill={hoveredIdx === idx ? "#0f172a" : "#64748b"}
                fontWeight={hoveredIdx === idx ? "700" : "500"}
              >
                {lbl}
              </text>
            );
          })}

          {/* Area Fills if single or double series */}
          {isSingle &&
            pointsBySeries.map((s, i) => (
              <path
                key={`area-${s.name}`}
                d={s.areaD}
                fill={`url(#gradient-${i})`}
              />
            ))}

          {/* Line Paths */}
          {pointsBySeries.map((s) => (
            <g key={s.name}>
              <path
                d={s.pathD}
                fill="none"
                stroke={s.color}
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              {/* Point circles */}
              {s.coords.map((pt, ptIdx) => (
                <circle
                  key={ptIdx}
                  cx={pt.x}
                  cy={pt.y}
                  r={hoveredIdx === ptIdx ? 5.5 : 3.5}
                  fill="#ffffff"
                  stroke={s.color}
                  strokeWidth={hoveredIdx === ptIdx ? 3 : 2}
                  className="transition-all duration-150 cursor-pointer"
                  onMouseEnter={() => setHoveredIdx(ptIdx)}
                  onClick={() => onPointClick?.(labels[ptIdx])}
                />
              ))}
            </g>
          ))}

          {/* Vertical guide bar */}
          {hoveredIdx !== null && labels.length > 1 && (
            <line
              x1={paddingLeft + hoveredIdx * (plotWidth / (labels.length - 1))}
              y1={paddingTop}
              x2={paddingLeft + hoveredIdx * (plotWidth / (labels.length - 1))}
              y2={paddingTop + plotHeight}
              stroke="#64748b"
              strokeWidth="1.5"
              strokeDasharray="3 3"
            />
          )}
        </svg>

        {/* Hover info tooltip */}
        {hoveredIdx !== null && (
          <div
            className="absolute top-2 right-2 bg-slate-900/95 text-white px-3.5 py-2.5 rounded-lg shadow-2xl text-xs z-30 pointer-events-none max-w-xs border border-slate-700"
            onMouseLeave={() => setHoveredIdx(null)}
          >
            <div className="font-bold border-b border-slate-700 pb-1.5 mb-2 text-slate-100 flex items-center justify-between">
              <span>{labels[hoveredIdx]}</span>
            </div>
            <div className="space-y-1.5">
              {pointsBySeries.map((s) => (
                <div
                  key={s.name}
                  className="flex items-center justify-between gap-4"
                >
                  <div className="flex items-center gap-1.5">
                    <span
                      className="h-2 w-2 rounded-full shrink-0"
                      style={{ backgroundColor: s.color }}
                    />
                    <span className="text-slate-300 font-medium truncate max-w-[130px]">
                      {s.name}
                    </span>
                  </div>
                  <span className="font-bold tabular-nums text-white">
                    {valueFormatter(s.data[hoveredIdx] ?? 0)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
