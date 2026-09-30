interface KPICardProps {
  title: string;
  value: string;
  subtext?: string;
  trend?: { direction: "up" | "down" | "flat"; label: string };
  tooltip?: string;
  loading?: boolean;
  progress?: { value: number; max?: number; color?: string };
  badge?: string;
  accentColor?:
    | "blue"
    | "emerald"
    | "amber"
    | "rose"
    | "indigo"
    | "slate"
    | "orange"
    | "red"
    | "violet"
    | "cyan";
}

const trendColor = {
  up: "text-emerald-700 bg-emerald-50 border-emerald-200",
  down: "text-rose-700 bg-rose-50 border-rose-200",
  flat: "text-slate-600 bg-slate-100 border-slate-200",
};

const trendArrow = { up: "▲", down: "▼", flat: "—" };

const accentBorders = {
  blue: "hover:border-blue-400 border-t-2 border-t-blue-600",
  emerald: "hover:border-emerald-400 border-t-2 border-t-emerald-500",
  amber: "hover:border-amber-400 border-t-2 border-t-amber-500",
  rose: "hover:border-rose-400 border-t-2 border-t-rose-500",
  indigo: "hover:border-indigo-400 border-t-2 border-t-indigo-600",
  slate: "hover:border-slate-400 border-t-2 border-t-slate-700",
  orange: "hover:border-orange-400 border-t-2 border-t-orange-500",
  red: "hover:border-red-400 border-t-2 border-t-red-500",
  violet: "hover:border-violet-400 border-t-2 border-t-violet-500",
  cyan: "hover:border-cyan-400 border-t-2 border-t-cyan-500",
};

export default function KPICard({
  title,
  value,
  subtext,
  trend,
  tooltip,
  loading,
  progress,
  badge,
  accentColor = "blue",
}: KPICardProps) {
  return (
    <div
      className={`bg-white rounded-xl border border-slate-200/90 shadow-xs p-4 min-w-0 transition-all duration-200 hover:shadow-md ${accentBorders[accentColor]}`}
    >
      <div className="flex items-start justify-between gap-1.5 mb-2 min-h-[1.75rem]">
        <span className="text-xs font-semibold text-slate-600 leading-tight">
          {title}
        </span>
        <div className="flex items-center gap-1 shrink-0 mt-0.5">
          {badge && (
            <span className="text-[10px] font-semibold px-1.5 py-0.2 rounded bg-slate-100 text-slate-600">
              {badge}
            </span>
          )}
          {tooltip && (
            <span className="group relative inline-flex">
              <span className="text-[10px] text-slate-400 border border-slate-300 rounded-full w-4 h-4 flex items-center justify-center cursor-help hover:text-slate-600 hover:border-slate-500 transition-colors">
                ?
              </span>
              <span className="pointer-events-none absolute right-0 bottom-full mb-1.5 w-52 rounded-md bg-slate-900 text-white text-[11px] leading-snug px-2.5 py-1.5 opacity-0 group-hover:opacity-100 transition-opacity z-30 shadow-xl">
                {tooltip}
              </span>
            </span>
          )}
        </div>
      </div>

      {loading ? (
        <div className="space-y-2 py-1">
          <div className="h-7 w-28 bg-slate-100 rounded animate-pulse" />
          <div className="h-3 w-20 bg-slate-50 rounded animate-pulse" />
        </div>
      ) : (
        <>
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-2xl font-bold tracking-tight text-slate-900 tabular-nums">
              {value}
            </span>
            {trend && (
              <span
                className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border ${trendColor[trend.direction]} shrink-0`}
              >
                {trendArrow[trend.direction]} {trend.label}
              </span>
            )}
          </div>

          {subtext && (
            <p className="text-[11px] text-slate-500 mt-1 truncate">
              {subtext}
            </p>
          )}

          {progress && (
            <div className="mt-2.5">
              <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${
                    progress.color || "bg-blue-600"
                  }`}
                  style={{
                    width: `${Math.min(
                      100,
                      (progress.value / (progress.max || 100)) * 100,
                    )}%`,
                  }}
                />
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
