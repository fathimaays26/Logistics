import { useMemo, useState } from "react";
import { formatNumber } from "../../format";

/**
 * One aggregated level of a drill-down tree. Raw counters are accumulated at
 * every node so rates and averages are always recomputed from the underlying
 * records rather than averaged across children.
 */
export interface MetricDrillNode {
  label: string;
  vehicles: number;
  onTimeCount: number;
  onTimeEvaluated: number;
  transitTotal: number;
  transitCount: number;
  delayCount: number;
  cost: number;
  km: number;
  children: Map<string, MetricDrillNode>;
}

/** A single source record, already joined to its dimension labels. */
export interface MetricDrillRow {
  labels: string[];
  vehicles?: number;
  onTimeCount?: number;
  onTimeEvaluated?: number;
  transitTotal?: number;
  transitCount?: number;
  delayCount?: number;
  cost?: number;
  km?: number;
}

export function buildMetricHierarchy(
  rows: MetricDrillRow[],
): Map<string, MetricDrillNode> {
  const root = new Map<string, MetricDrillNode>();

  for (const row of rows) {
    let level = root;

    row.labels.forEach((rawLabel, index) => {
      const label = rawLabel || "Unknown";
      let node = level.get(label);

      if (!node) {
        node = {
          label,
          vehicles: 0,
          onTimeCount: 0,
          onTimeEvaluated: 0,
          transitTotal: 0,
          transitCount: 0,
          delayCount: 0,
          cost: 0,
          km: 0,
          children: new Map(),
        };
        level.set(label, node);
      }

      node.vehicles += row.vehicles ?? 1;
      node.onTimeCount += row.onTimeCount ?? 0;
      node.onTimeEvaluated += row.onTimeEvaluated ?? 0;
      node.transitTotal += row.transitTotal ?? 0;
      node.transitCount += row.transitCount ?? 0;
      node.delayCount += row.delayCount ?? 0;
      node.cost += row.cost ?? 0;
      node.km += row.km ?? 0;

      if (index < row.labels.length - 1) {
        level = node.children;
      }
    });
  }

  return root;
}

export default function MetricDrilldownChart({
  hierarchy,
  levels,
  resetKey,
  height = 300,
  barClassName = "bg-blue-600",
}: {
  hierarchy: Map<string, MetricDrillNode>;
  levels: readonly string[];
  resetKey?: string;
  height?: number;
  barClassName?: string;
}) {
  const [state, setState] = useState<{ key: string; path: string[] }>({
    key: resetKey ?? "",
    path: [],
  });

  // Reset the drill path when the global filters change. Adjusting state during
  // render is the documented alternative to an effect, which would cause a
  // cascading second render.
  if (state.key !== (resetKey ?? "")) {
    setState({ key: resetKey ?? "", path: [] });
  }

  const path = state.key === (resetKey ?? "") ? state.path : [];

  const view = useMemo(() => {
    const level = path.reduce<Map<string, MetricDrillNode> | null>(
      (current, segment) => current?.get(segment)?.children ?? null,
      hierarchy,
    );

    if (!level) return [];
    return [...level.values()].sort((a, b) => b.vehicles - a.vehicles);
  }, [hierarchy, path]);

  const maxVehicles = Math.max(1, ...view.map((node) => node.vehicles));
  const canGoDeeper = path.length < levels.length - 1;
  const level = path.length;

  return (
    <div className="flex flex-col" style={{ height }}>
      <div className="mb-2 flex shrink-0 items-center justify-between gap-2">
        <div className="text-[11px] text-slate-500">
          <span className="font-semibold text-slate-700">
            {levels[level] ?? levels[levels.length - 1]}
          </span>
          {path.length > 0 && (
            <span className="ml-1 text-slate-400">• {path.join(" / ")}</span>
          )}
        </div>

        {path.length > 0 && (
          <button
            type="button"
            onClick={() => setState((current) => ({ ...current, path: current.path.slice(0, -1) }))}
            className="rounded-md border border-slate-200 px-2.5 py-1 text-[11px] font-semibold text-slate-600 hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700"
          >
            ↖ Back
          </button>
        )}
      </div>

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
        {view.length === 0 ? (
          <div className="flex h-32 items-center justify-center text-xs text-slate-400">
            No data matches the current filters
          </div>
        ) : (
          view.map((node) => {
            const canDrill = canGoDeeper && node.children.size > 0;
            const onTimeRate =
              node.onTimeEvaluated > 0
                ? (node.onTimeCount / node.onTimeEvaluated) * 100
                : null;
            const avgTransit =
              node.transitCount > 0 ? node.transitTotal / node.transitCount : null;
            const delayRate =
              node.vehicles > 0 ? (node.delayCount / node.vehicles) * 100 : 0;
            const costPerKm = node.km > 0 ? node.cost / node.km : null;

            return (
              <button
                key={node.label}
                type="button"
                disabled={!canDrill}
                onClick={() => {
                  if (canDrill)
                    setState((current) => ({
                      ...current,
                      path: [...current.path, node.label],
                    }));
                }}
                className={`group block w-full rounded-lg border border-slate-100 bg-slate-50/60 p-2.5 text-left transition-colors ${
                  canDrill
                    ? "cursor-pointer hover:border-blue-200 hover:bg-blue-50/50"
                    : "cursor-default"
                }`}
                title={
                  canDrill
                    ? `Drill down into ${node.label}`
                    : `${node.label} — leaf level`
                }
              >
                <div className="mb-1.5 flex items-center justify-between gap-3">
                  <span className="flex min-w-0 items-center gap-1.5 text-[11px] font-semibold text-slate-800">
                    <span className="truncate">{node.label}</span>
                    {canDrill && (
                      <span className="text-[10px] text-blue-500 opacity-0 transition-opacity group-hover:opacity-100">
                        ↘
                      </span>
                    )}
                  </span>
                  <span className="shrink-0 text-[11px] font-bold tabular-nums text-slate-800">
                    {formatNumber(node.vehicles)}
                    <span className="ml-1 font-medium text-slate-400">
                      vehicles
                    </span>
                  </span>
                </div>

                <div className="h-1.5 overflow-hidden rounded-full bg-slate-200">
                  <div
                    className={`h-full rounded-full transition-all ${barClassName}`}
                    style={{ width: `${(node.vehicles / maxVehicles) * 100}%` }}
                  />
                </div>

                <div className="mt-1.5 grid grid-cols-5 gap-1 text-[10px] text-slate-500">
                  <div>
                    <div className="font-bold tabular-nums text-slate-700">
                      {onTimeRate === null ? "—" : `${onTimeRate.toFixed(0)}%`}
                    </div>
                    <div className="truncate" title="Delivered on or before the planned delivery date">
                      On-time
                    </div>
                  </div>
                  <div>
                    <div className="font-bold tabular-nums text-slate-700">
                      {avgTransit === null ? "—" : `${avgTransit.toFixed(1)}d`}
                    </div>
                    <div className="truncate">Transit</div>
                  </div>
                  <div>
                    <div
                      className={`font-bold tabular-nums ${
                        delayRate > 20
                          ? "text-rose-600"
                          : delayRate > 10
                            ? "text-amber-600"
                            : "text-slate-700"
                      }`}
                    >
                      {delayRate.toFixed(0)}%
                    </div>
                    <div
                      className="truncate"
                      title="Latest movement record for the dispatch carries a Delayed status"
                    >
                      Delayed
                    </div>
                  </div>
                  <div>
                    <div className="font-bold tabular-nums text-slate-700">
                      ₹{formatNumber(Math.round(node.cost))}
                    </div>
                    <div className="truncate">Cost</div>
                  </div>
                  <div>
                    <div className="font-bold tabular-nums text-slate-700">
                      {costPerKm === null ? "—" : `₹${costPerKm.toFixed(2)}`}
                    </div>
                    <div className="truncate">Cost/km</div>
                  </div>
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}