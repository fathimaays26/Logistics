import { useMemo, useState } from "react";
import { formatNumber } from "../../format";

export type DrilldownNode = {
  label: string;
  value: number;
  children: Map<string, DrilldownNode>;
};

export function buildCountHierarchy(rows: string[][]): Map<string, DrilldownNode> {
  const root = new Map<string, DrilldownNode>();

  for (const values of rows) {
    let current = root;

    values.forEach((rawValue, index) => {
      const label = rawValue || "Unknown";
      let node = current.get(label);

      if (!node) {
        node = { label, value: 0, children: new Map() };
        current.set(label, node);
      }

      node.value += 1;

      if (index < values.length - 1) {
        current = node.children;
      }
    });
  }

  return root;
}

export default function DrilldownBarChart({
  hierarchy,
  levels,
  resetKey,
  valueFormatter = formatNumber,
  barClassName = "bg-blue-600",
}: {
  hierarchy: Map<string, DrilldownNode>;
  levels: readonly string[];
  resetKey?: string;
  valueFormatter?: (value: number) => string;
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
    const level = path.reduce<Map<string, DrilldownNode> | null>(
      (current, segment) => current?.get(segment)?.children ?? null,
      hierarchy,
    );

    if (!level) return [];
    return [...level.values()].sort((a, b) => b.value - a.value);
  }, [hierarchy, path]);

  const level = path.length;
  const max = Math.max(1, ...view.map((item) => item.value));
  const canGoDeeper = level < levels.length - 1;

  return (
    <div className="flex h-[235px] flex-col">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="text-[11px] text-slate-500">
          {levels[level] ?? levels[levels.length - 1]}
          {path.length > 0 && (
            <span className="ml-1 text-slate-400">• {path.join(" / ")}</span>
          )}
        </div>

        {path.length > 0 && (
          <button
            type="button"
            onClick={() =>
                    setState((current) => ({
                      ...current,
                      path: current.path.slice(0, -1),
                    }))
                  }
            className="rounded-md border border-slate-200 px-2.5 py-1 text-[11px] font-semibold text-slate-600 hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700"
          >
            ↖ Back
          </button>
        )}
      </div>

      <div className="space-y-2 overflow-y-auto pr-1">
        {view.length === 0 ? (
          <div className="flex h-40 items-center justify-center text-xs text-slate-400">
            No data
          </div>
        ) : (
          view.map((item) => {
            const canDrill = canGoDeeper && item.children.size > 0;

            return (
              <button
                key={item.label}
                type="button"
                disabled={!canDrill}
                onClick={() => {
                  if (canDrill) {
                    setState((current) => ({
                      ...current,
                      path: [...current.path, item.label],
                    }));
                  }
                }}
                className={`group w-full text-left ${
                  canDrill ? "cursor-pointer" : "cursor-default"
                }`}
                title={canDrill ? `Drill down into ${item.label}` : item.label}
              >
                <div className="mb-1 flex items-center justify-between">
                  <span className="flex min-w-0 items-center gap-1.5 pr-2 text-[11px] font-semibold text-slate-700">
                    <span className="truncate">{item.label}</span>
                    {canDrill && (
                      <span className="text-[10px] text-blue-500 opacity-0 group-hover:opacity-100">
                        ↘
                      </span>
                    )}
                  </span>
                  <span className="text-[11px] font-bold text-slate-800">
                    {valueFormatter(item.value)}
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                  <div
                    className={`h-full rounded-full transition-all ${barClassName} ${
                      canDrill ? "group-hover:brightness-110" : ""
                    }`}
                    style={{ width: `${(item.value / max) * 100}%` }}
                  />
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
