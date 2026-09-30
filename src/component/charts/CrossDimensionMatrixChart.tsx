import { useMemo, useState } from "react";
import { formatNumber } from "../../format";

export type CrossDimension = "region" | "vehicleType" | "model" | "variant";

export type CrossMetric = "delivered" | "onTimeRate" | "avgTatDays";

export interface CrossDimensionFact {
  region: string;
  vehicleType: string;
  model: string;
  variant: string;
  delivered: boolean;
  onTime: boolean;
  tatDays: number | null;
}

export const CROSS_DIMENSIONS: readonly CrossDimension[] = [
  "region",
  "vehicleType",
  "model",
  "variant",
];

export const CROSS_METRICS: readonly CrossMetric[] = [
  "delivered",
  "onTimeRate",
  "avgTatDays",
];

const DIMENSION_LABELS: Record<CrossDimension, string> = {
  region: "Region",
  vehicleType: "Vehicle Type",
  model: "Model",
  variant: "Variant",
};

const METRIC_LABELS: Record<CrossMetric, string> = {
  delivered: "Delivered",
  onTimeRate: "On-Time Rate",
  avgTatDays: "Avg TAT",
};

const METRIC_HINTS: Record<CrossMetric, string> = {
  delivered: "Completed deliveries",
  onTimeRate: "Delivered on or before planned date",
  avgTatDays: "Dispatch to delivery, in days",
};

const METRIC_LEGEND: Record<CrossMetric, { low: string; high: string }> = {
  delivered: { low: "Low", high: "High" },
  onTimeRate: { low: "Low rate", high: "High rate" },
  avgTatDays: { low: "Fast", high: "Slow" },
};

interface CellAggregate {
  delivered: number;
  onTime: number;
  tatSum: number;
  tatCount: number;
}

function emptyCell(): CellAggregate {
  return { delivered: 0, onTime: 0, tatSum: 0, tatCount: 0 };
}

function mergeCell(target: CellAggregate, source: CellAggregate) {
  target.delivered += source.delivered;
  target.onTime += source.onTime;
  target.tatSum += source.tatSum;
  target.tatCount += source.tatCount;
}

function cellValue(cell: CellAggregate, metric: CrossMetric): number | null {
  if (metric === "delivered") return cell.delivered;
  if (metric === "onTimeRate") {
    return cell.delivered > 0 ? (cell.onTime / cell.delivered) * 100 : null;
  }
  return cell.tatCount > 0 ? cell.tatSum / cell.tatCount : null;
}

function formatValue(value: number | null, metric: CrossMetric): string {
  if (value === null) return "—";
  if (metric === "delivered") return formatNumber(value);
  if (metric === "onTimeRate") return `${value.toFixed(1)}%`;
  return `${value.toFixed(1)}d`;
}

function ToggleButton({
  active,
  label,
  title,
  onClick,
}: {
  active: boolean;
  label: string;
  title: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={`rounded-md px-2.5 py-1 text-[11px] font-semibold transition-colors ${
        active
          ? "bg-blue-600 text-white shadow-xs"
          : "bg-slate-100 text-slate-600 hover:bg-slate-200/80 hover:text-slate-900"
      }`}
    >
      {label}
    </button>
  );
}

export default function CrossDimensionMatrixChart({
  facts,
  allRegions,
  height = 300,
}: {
  facts: CrossDimensionFact[];
  /** Full region dimension, so every region stays comparable as a column. */
  allRegions: string[];
  height?: number;
}) {
  const [rowDimension, setRowDimension] = useState<CrossDimension>(
    "vehicleType",
  );
  const [colDimension, setColDimension] = useState<CrossDimension>("region");
  const [metric, setMetric] = useState<CrossMetric>("delivered");
  const [search, setSearch] = useState("");

  // The two axes can never be the same dimension.
  const columnDimension: CrossDimension =
    colDimension === rowDimension
      ? CROSS_DIMENSIONS.find((item) => item !== rowDimension) ?? "region"
      : colDimension;

  const columnLabels = useMemo(() => {
    if (columnDimension === "region") return allRegions;
    const present = new Set<string>();
    for (const fact of facts) present.add(fact[columnDimension]);
    return [...present].sort((a, b) => a.localeCompare(b));
  }, [facts, columnDimension, allRegions]);

  const {
    rowLabels,
    cells,
    rowTotals,
    colTotals,
    grandTotal,
    maxValue,
  } = useMemo(() => {
    const rows = new Map<string, Map<string, CellAggregate>>();
    const rowDeliveryCount = new Map<string, number>();
    const rowTotalsMap = new Map<string, CellAggregate>();
    const colTotalsMap = new Map<string, CellAggregate>();

    for (const fact of facts) {
      const rowKey = fact[rowDimension];
      const colKey = fact[columnDimension];

      rowDeliveryCount.set(
        rowKey,
        (rowDeliveryCount.get(rowKey) ?? 0) + (fact.delivered ? 1 : 0),
      );

      let rowCells = rows.get(rowKey);
      if (!rowCells) {
        rowCells = new Map<string, CellAggregate>();
        rows.set(rowKey, rowCells);
      }

      let cell = rowCells.get(colKey);
      if (!cell) {
        cell = emptyCell();
        rowCells.set(colKey, cell);
      }

      if (fact.delivered) {
        cell.delivered += 1;
        if (fact.onTime) cell.onTime += 1;
      }
      if (fact.tatDays !== null) {
        cell.tatSum += fact.tatDays;
        cell.tatCount += 1;
      }
    }

    const query = search.trim().toLowerCase();
    const labels = [...rows.keys()]
      .filter((label) =>
        query ? label.toLowerCase().includes(query) : true,
      )
      .sort((a, b) => {
        const byVolume =
          (rowDeliveryCount.get(b) ?? 0) - (rowDeliveryCount.get(a) ?? 0);
        return byVolume !== 0 ? byVolume : a.localeCompare(b);
      });

    const visible = labels;
    const grand = emptyCell();
    let peak = 0;

    const track = (value: number | null) => {
      if (value !== null && value > peak) peak = value;
    };

    for (const label of visible) {
      const rowCells = rows.get(label)!;
      const rowTotal = emptyCell();

      for (const col of columnLabels) {
        const cell = rowCells.get(col);
        if (!cell) continue;
        mergeCell(rowTotal, cell);
        track(cellValue(cell, metric));

        const colTotal = colTotalsMap.get(col) ?? emptyCell();
        mergeCell(colTotal, cell);
        colTotalsMap.set(col, colTotal);
      }

      rowTotalsMap.set(label, rowTotal);
      mergeCell(grand, rowTotal);
    }

    for (const col of columnLabels) {
      const colTotal = colTotalsMap.get(col);
      if (colTotal) track(cellValue(colTotal, metric));
    }
    track(cellValue(grand, metric));

    return {
      rowLabels: visible,
      cells: rows,
      rowTotals: rowTotalsMap,
      colTotals: colTotalsMap,
      grandTotal: grand,
      maxValue: peak,
    };
  }, [facts, rowDimension, columnDimension, columnLabels, metric, search]);

  const cellStyle = (value: number | null) => {
    if (value === null) {
      return { backgroundColor: "rgba(248, 250, 252, 0.75)", color: "#a8b3c2" };
    }
    if (value === 0) {
      return { backgroundColor: "rgba(241, 245, 249, 0.9)", color: "#cbd5e1" };
    }
    const alpha = Math.min(0.92, Math.max(0.1, (value / maxValue) * 0.92));
    return {
      backgroundColor: `rgba(37, 99, 235, ${alpha})`,
      color: alpha > 0.5 ? "#ffffff" : "#1e3a8a",
    };
  };

  return (
    <div className="flex h-full flex-col" style={{ minHeight: height }}>
      {/* Axis + metric selectors */}
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
            Analyse
          </span>
          <div className="flex flex-wrap gap-1">
            {CROSS_DIMENSIONS.map((dimension) => (
              <ToggleButton
                key={dimension}
                active={rowDimension === dimension}
                label={DIMENSION_LABELS[dimension]}
                title={`Rows: one per ${DIMENSION_LABELS[dimension]}`}
                onClick={() => {
                  if (dimension === columnDimension) {
                    setColDimension(rowDimension);
                  }
                  setRowDimension(dimension);
                  setSearch("");
                }}
              />
            ))}
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
            Across
          </span>
          <div className="flex flex-wrap gap-1">
            {CROSS_DIMENSIONS.map((dimension) => (
              <ToggleButton
                key={dimension}
                active={columnDimension === dimension}
                label={DIMENSION_LABELS[dimension]}
                title={`Columns: one per ${DIMENSION_LABELS[dimension]}`}
                onClick={() => setColDimension(dimension)}
              />
            ))}
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
            Metric
          </span>
          <div className="flex flex-wrap gap-1">
            {CROSS_METRICS.map((item) => (
              <ToggleButton
                key={item}
                active={metric === item}
                label={METRIC_LABELS[item]}
                title={METRIC_HINTS[item]}
                onClick={() => setMetric(item)}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Row scope controls */}
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <div className="relative">
          <input
            type="text"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={`Find a ${DIMENSION_LABELS[rowDimension].toLowerCase()}...`}
            className="w-60 rounded-lg border border-slate-200 bg-slate-50/70 px-2.5 py-1 text-[11px] text-slate-700 placeholder-slate-400 focus:border-blue-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] font-bold text-slate-400 hover:text-slate-600"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* Matrix */}
      <div className="min-h-0 flex-1 overflow-auto rounded-xl border border-slate-200/90 shadow-xs">
        {rowLabels.length === 0 || columnLabels.length === 0 ? (
          <div className="flex h-40 items-center justify-center text-xs text-slate-400">
            No delivery data available for the active filters
          </div>
        ) : (
          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr>
                <th className="sticky left-0 top-0 z-20 border-b border-r border-slate-200 bg-slate-50 px-3 py-2.5 text-[11px] font-bold uppercase tracking-wider text-slate-900 whitespace-nowrap">
                  {DIMENSION_LABELS[rowDimension]}
                </th>
                {columnLabels.map((col) => (
                  <th
                    key={col}
                    title={col}
                    className="sticky top-0 z-10 border-b border-slate-200 bg-slate-50 px-3 py-2.5 text-center text-[11px] font-bold uppercase tracking-wider text-slate-800 whitespace-nowrap"
                  >
                    <span className="block max-w-[130px] truncate">{col}</span>
                  </th>
                ))}
                <th className="sticky top-0 z-10 border-b border-l border-slate-200 bg-slate-100 px-3 py-2.5 text-center text-[11px] font-bold uppercase tracking-wider text-slate-900 whitespace-nowrap">
                  All {DIMENSION_LABELS[columnDimension]}
                </th>
              </tr>
            </thead>
            <tbody>
              {rowLabels.map((row) => {
                const rowCells = cells.get(row);
                return (
                  <tr key={row}>
                    <td
                      title={row}
                      className="sticky left-0 z-10 border-b border-r border-slate-100 bg-white px-3 py-2 text-[11px] font-semibold text-slate-900 whitespace-nowrap"
                    >
                      <span className="block max-w-[190px] truncate">{row}</span>
                    </td>
                    {columnLabels.map((col) => {
                      const cell = rowCells?.get(col) ?? null;
                      const value = cell ? cellValue(cell, metric) : null;
                      return (
                        <td
                          key={col}
                          title={`${row} × ${col} — ${METRIC_HINTS[metric]}: ${formatValue(
                            value,
                            metric,
                          )}`}
                          className="border-b border-slate-100 px-3 py-2 text-center text-[11px] font-bold tabular-nums transition-all duration-150 hover:brightness-95"
                          style={cellStyle(value)}
                        >
                          {formatValue(value, metric)}
                        </td>
                      );
                    })}
                    <td className="border-b border-l border-slate-100 bg-slate-50/70 px-3 py-2 text-center text-[11px] font-black tabular-nums text-slate-900">
                      {formatValue(
                        rowTotals.has(row) ? cellValue(rowTotals.get(row)!, metric) : null,
                        metric,
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td className="sticky left-0 z-10 border-r border-t-2 border-slate-300 bg-slate-100 px-3 py-2.5 text-[11px] font-black uppercase tracking-wider text-slate-900 whitespace-nowrap">
                  All {DIMENSION_LABELS[rowDimension]}
                </td>
                {columnLabels.map((col) => {
                  const colTotal = colTotals.get(col);
                  return (
                    <td
                      key={col}
                      className="border-t-2 border-slate-300 bg-slate-100 px-3 py-2.5 text-center text-[11px] font-black tabular-nums text-slate-900"
                    >
                      {formatValue(
                        colTotal ? cellValue(colTotal, metric) : null,
                        metric,
                      )}
                    </td>
                  );
                })}
                <td className="border-l border-t-2 border-slate-300 bg-blue-50 px-3 py-2.5 text-center text-[11px] font-black tabular-nums text-blue-700">
                  {formatValue(cellValue(grandTotal, metric), metric)}
                </td>
              </tr>
            </tfoot>
          </table>
        )}
      </div>

      {/* Legend */}
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500">
        <div className="flex items-center gap-2">
          <span className="font-medium text-slate-600">
            {METRIC_LEGEND[metric].low}
          </span>
          <div className="h-3 w-28 rounded-full border border-slate-200 bg-gradient-to-r from-blue-100 via-blue-400 to-blue-700" />
          <span className="font-semibold text-slate-800">
            {METRIC_LEGEND[metric].high}
            {maxValue > 0 ? ` (${formatValue(maxValue, metric)})` : ""}
          </span>
        </div>
        <span className="text-slate-400">
          {METRIC_HINTS[metric]} — computed from the filtered deliveries
        </span>
      </div>
    </div>
  );
}
