import { useEffect, useMemo, useState } from "react";
import DashboardLayout from "../component/DashboardLayout";
import KPICard from "../component/KpiCard";
import ChartCard from "../component/ChartCard";
import type { DashboardPage } from "../component/Header";
import { useFilters } from "../context/FilterContext";
import { formatNumber } from "../format";
import DonutChart from "../component/charts/DonutChart";
import StackedHorizontalBarChart from "../component/charts/StackedHorizontalBarChart";
import {
  loadDatabaseSnapshot,
  type DimLocation,
  type DimPart,
  type FactPartInventory,
} from "../dataService";

type PartHierarchyNode = {
  label: string;
  quantity: number;
  records: number;
  statuses: Map<string, number>;
  children: Map<string, PartHierarchyNode>;
};

function normalize(value: string | null | undefined) {
  return (value ?? "").trim().toLowerCase().replace(/[_-]+/g, " ");
}

function partStatusDotClass(status: string): string {
  const value = normalize(status);
  if (value.includes("avail")) return "bg-emerald-500";
  if (value.includes("low")) return "bg-amber-500";
  if (value.includes("out") || value.includes("obsolete")) return "bg-rose-500";
  return "bg-slate-400";
}

const PART_STATUS_ORDER = ["Available", "Low Stock", "Out of Stock"];

/**
 * Builds a drill-down tree from part inventory rows. The axis labels are
 * supplied per row so the same component can render either
 * Part Type → Part → Location or Location → Part Type → Part.
 */
function buildPartHierarchy(
  rows: FactPartInventory[],
  labelsFor: (row: FactPartInventory) => string[],
): Map<string, PartHierarchyNode> {
  const root = new Map<string, PartHierarchyNode>();

  for (const row of rows) {
    let level = root;
    const labels = labelsFor(row);

    labels.forEach((label, index) => {
      const key = label || "Unknown";
      let node = level.get(key);

      if (!node) {
        node = {
          label: key,
          quantity: 0,
          records: 0,
          statuses: new Map(),
          children: new Map(),
        };
        level.set(key, node);
      }

      const quantity = Number(row.quantity) || 0;
      node.quantity += quantity;
      node.records += 1;

      const status = row.inventory_status || "Unknown";
      node.statuses.set(status, (node.statuses.get(status) ?? 0) + quantity);

      if (index < labels.length - 1) {
        level = node.children;
      }
    });
  }

  return root;
}

function orderedPartStatusEntries(
  statuses: Map<string, number>,
): Array<[string, number]> {
  const remaining = new Map(statuses);
  const ordered: Array<[string, number]> = [];

  for (const canonical of PART_STATUS_ORDER) {
    const key = [...remaining.keys()].find(
      (status) => normalize(status) === normalize(canonical),
    );
    if (key !== undefined) {
      ordered.push([key, remaining.get(key) ?? 0]);
      remaining.delete(key);
    } else {
      ordered.push([canonical, 0]);
    }
  }

  ordered.push(...[...remaining.entries()].sort((a, b) => b[1] - a[1]));
  return ordered;
}

function PartInventoryChart({
  hierarchy,
  path,
  levels,
  onDrill,
}: {
  hierarchy: Map<string, PartHierarchyNode>;
  path: string[];
  levels: readonly string[];
  onDrill: (label: string) => void;
}) {
  const nodes = useMemo(() => {
    const level = path.reduce<Map<string, PartHierarchyNode> | null>(
      (current, segment) => current?.get(segment)?.children ?? null,
      hierarchy,
    );

    if (!level) return [];
    return [...level.values()].sort((a, b) => b.quantity - a.quantity);
  }, [hierarchy, path]);

  const maxQuantity = Math.max(1, ...nodes.map((node) => node.quantity));

  return (
    <div className="h-[280px] overflow-y-auto pr-1">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="text-[11px] text-slate-500">
          {levels[path.length] ?? levels[levels.length - 1]}
          {path.length > 0 && (
            <span className="ml-1 text-slate-400">• {path.join(" / ")}</span>
          )}
        </div>
        {path.length > 0 && (
          <button
            type="button"
            onClick={() => onDrill("__BACK__")}
            className="rounded-md border border-slate-200 px-2.5 py-1 text-[11px] font-semibold text-slate-600 hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700"
          >
            ↖ Back
          </button>
        )}
      </div>

      {nodes.length === 0 ? (
        <div className="flex h-36 items-center justify-center text-xs text-slate-400">
          No matching part inventory records.
        </div>
      ) : (
        <div className="space-y-3">
          {nodes.map((node) => {
            const statusEntries = orderedPartStatusEntries(node.statuses);

            return (
              <button
                key={node.label}
                type="button"
                disabled={node.children.size === 0}
                onClick={() =>
                  node.children.size > 0 && onDrill(node.label)
                }
                className={`group block w-full text-left ${
                  node.children.size > 0 ? "cursor-pointer" : "cursor-default"
                }`}
                title={`${node.label} • ${formatNumber(node.records)} records${
                  node.children.size > 0 ? " • Click to drill down" : ""
                }`}
              >
                <div className="mb-1 flex items-center justify-between gap-3">
                  <span className="flex min-w-0 items-center gap-1.5 text-[11px] font-semibold text-slate-700">
                    <span className="truncate">{node.label}</span>
                    {node.children.size > 0 && (
                      <span className="text-[10px] text-blue-500 opacity-0 group-hover:opacity-100">
                        ↘
                      </span>
                    )}
                  </span>
                  <span className="shrink-0 text-[11px] font-bold tabular-nums text-slate-700">
                    {formatNumber(node.quantity)}
                  </span>
                </div>

                <div className="h-2.5 overflow-hidden rounded-md bg-slate-100">
                  <div
                    className="h-full rounded-md bg-indigo-500 transition-all"
                    style={{
                      width: `${Math.max(
                        (node.quantity / maxQuantity) * 100,
                        3,
                      )}%`,
                    }}
                  />
                </div>

                <div className="mt-1.5 space-y-0.5">
                  {statusEntries.map(([status, quantity]) => (
                    <div
                      key={status}
                      className="flex items-center gap-1.5 text-[10px] leading-relaxed"
                    >
                      <span
                        className={`h-1.5 w-1.5 shrink-0 rounded-full ${partStatusDotClass(status)}`}
                      />
                      <span className="text-slate-500">{status}:</span>
                      <span className="font-semibold tabular-nums text-slate-600">
                        {formatNumber(quantity)}
                      </span>
                    </div>
                  ))}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function PartsInventory({
  activePage,
  onPageChange,
}: {
  activePage: DashboardPage;
  onPageChange: (page: DashboardPage) => void;
}) {
  const { filters } = useFilters();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [locations, setLocations] = useState<DimLocation[]>([]);
  const [partInventory, setPartInventory] = useState<FactPartInventory[]>([]);
  const [parts, setParts] = useState<DimPart[]>([]);
  const filterKey = JSON.stringify(filters);
  const [drillState, setDrillState] = useState<{
    key: string;
    part: string[];
    location: string[];
  }>({ key: filterKey, part: [], location: [] });

  // Reset both drill paths when the global filters change, adjusting state
  // during render instead of inside an effect.
  if (drillState.key !== filterKey) {
    setDrillState({ key: filterKey, part: [], location: [] });
  }

  const partDrillPath =
    drillState.key === filterKey ? drillState.part : [];
  const locationDrillPath =
    drillState.key === filterKey ? drillState.location : [];
  const setPartDrillPath = (
    updater: (current: string[]) => string[],
  ): void =>
    setDrillState((current) => ({ ...current, part: updater(current.part) }));
  const setLocationDrillPath = (
    updater: (current: string[]) => string[],
  ): void =>
    setDrillState((current) => ({
      ...current,
      location: updater(current.location),
    }));
  const [attentionPartTypeFilter, setAttentionPartTypeFilter] = useState("");
  const [viewMode, setViewMode] = useState<"overview" | "attention">("overview");

  useEffect(() => {
    async function loadData() {
      setLoading(true);
      setError(null);
      try {
        const snapshot = await loadDatabaseSnapshot();
        setLocations(snapshot.locations);
        setPartInventory(snapshot.partInventory);
        setParts(snapshot.parts);
      } catch (loadError) {
        console.error(loadError);
        setError("Unable to load Parts & Inventory data from Supabase.");
      } finally {
        setLoading(false);
      }
    }

    void loadData();
  }, []);

  const locationMap = useMemo(
    () => new Map(locations.map((location) => [location.location_id, location])),
    [locations],
  );

  const partMap = useMemo(
    () => new Map(parts.map((part) => [part.part_id, part])),
    [parts],
  );

  const filteredParts = useMemo(() => {
    return partInventory.filter((row) => {
      const location = locationMap.get(row.location_id);

      if (filters.locationId && row.location_id !== filters.locationId) {
        return false;
      }

      if (filters.regionId && location?.region_id !== filters.regionId) {
        return false;
      }

      if (
        filters.inventoryStatus &&
        normalize(row.inventory_status) !== normalize(filters.inventoryStatus)
      ) {
        return false;
      }

      return true;
    });
  }, [partInventory, locationMap, filters]);

  const totalQuantity = useMemo(
    () => filteredParts.reduce((sum, row) => sum + (Number(row.quantity) || 0), 0),
    [filteredParts],
  );

  const quantityByStatus = useMemo(() => {
    const totals = {
      available: 0,
      lowStock: 0,
      outOfStock: 0,
      other: 0,
    };

    for (const row of filteredParts) {
      const quantity = Number(row.quantity) || 0;
      const status = normalize(row.inventory_status);

      if (status.includes("avail")) totals.available += quantity;
      else if (status.includes("low")) totals.lowStock += quantity;
      else if (status.includes("out")) totals.outOfStock += quantity;
      else totals.other += quantity;
    }

    return totals;
  }, [filteredParts]);

  const uniqueParts = useMemo(
    () => new Set(filteredParts.map((row) => row.part_id)).size,
    [filteredParts],
  );

  const stockedLocations = useMemo(
    () =>
      new Set(
        filteredParts
          .filter((row) => (Number(row.quantity) || 0) > 0)
          .map((row) => row.location_id),
      ).size,
    [filteredParts],
  );

  // Part Type → Part → Location (main inventory view)
  const partHierarchy = useMemo(
    () =>
      buildPartHierarchy(filteredParts, (row) => {
        const part = partMap.get(row.part_id);
        return [
          part?.part_type ?? "Unknown Part Type",
          part?.part_name ?? row.part_id,
          locationMap.get(row.location_id)?.location_name ?? row.location_id,
        ];
      }),
    [filteredParts, partMap, locationMap],
  );

  // Location → Part Type → Part (where are we running short?)
  const locationHierarchy = useMemo(
    () =>
      buildPartHierarchy(filteredParts, (row) => {
        const part = partMap.get(row.part_id);
        return [
          locationMap.get(row.location_id)?.location_name ?? row.location_id,
          part?.part_type ?? "Unknown Part Type",
          part?.part_name ?? row.part_id,
        ];
      }),
    [filteredParts, partMap, locationMap],
  );

  // Part × Location combinations that are short of stock, sorted by severity.
  const attentionRows = useMemo(() => {
    const grouped = new Map<
      string,
      {
        part: string;
        partType: string;
        location: string;
        available: number;
        lowStock: number;
        outOfStock: number;
        total: number;
      }
    >();

    for (const row of filteredParts) {
      const part = partMap.get(row.part_id);
      const partName = part?.part_name ?? row.part_id;
      const locationName =
        locationMap.get(row.location_id)?.location_name ?? row.location_id;
      const key = `${partName}||${locationName}`;

      const current = grouped.get(key) ?? {
        part: partName,
        partType: part?.part_type ?? "Unknown Part Type",
        location: locationName,
        available: 0,
        lowStock: 0,
        outOfStock: 0,
        total: 0,
      };

      const quantity = Number(row.quantity) || 0;
      current.total += quantity;

      const status = normalize(row.inventory_status);
      if (status.includes("avail")) current.available += quantity;
      else if (status.includes("low")) current.lowStock += quantity;
      else if (status.includes("out")) current.outOfStock += quantity;

      grouped.set(key, current);
    }

    return [...grouped.values()]
      .filter((row) => row.lowStock > 0 || row.outOfStock > 0)
      .sort(
        (a, b) =>
          b.outOfStock - a.outOfStock ||
          b.lowStock - a.lowStock ||
          b.total - a.total,
      );
  }, [filteredParts, partMap, locationMap]);

  const partsBelowStockLevel = attentionRows.length;

  // Part-level rollup of the same attention positions, ranked by combined
  // low-stock + out-of-stock quantity. The detail table still lists every
  // part-location position; this is only the ranked "which parts hurt most" view.
  const attentionByPart = useMemo(() => {
    const grouped = new Map<
      string,
      { part: string; lowStock: number; outOfStock: number }
    >();

    for (const row of attentionRows) {
      const current = grouped.get(row.part) ?? {
        part: row.part,
        lowStock: 0,
        outOfStock: 0,
      };
      current.lowStock += row.lowStock;
      current.outOfStock += row.outOfStock;
      grouped.set(row.part, current);
    }

    return [...grouped.values()]
      .map((entry) => ({ ...entry, total: entry.lowStock + entry.outOfStock }))
      .filter((entry) => entry.total > 0)
      .sort((a, b) => b.total - a.total || a.part.localeCompare(b.part));
  }, [attentionRows]);

  const ATTENTION_CHART_LIMIT = 10;

  const topAttentionParts = useMemo(
    () =>
      attentionByPart.slice(0, ATTENTION_CHART_LIMIT).map((entry) => ({
        label: entry.part,
        segments: [
          {
            name: "Low Stock",
            value: entry.lowStock,
            color: "bg-amber-500",
          },
          {
            name: "Out of Stock",
            value: entry.outOfStock,
            color: "bg-rose-500",
          },
        ],
      })),
    [attentionByPart],
  );

  const attentionPartTypeOptions = useMemo(
    () => [...new Set(attentionRows.map((row) => row.partType))].sort((a, b) => a.localeCompare(b)),
    [attentionRows],
  );

  const visibleAttentionRows = useMemo(() => {
    if (!attentionPartTypeFilter) return attentionRows;
    return attentionRows.filter((row) => row.partType === attentionPartTypeFilter);
  }, [attentionRows, attentionPartTypeFilter]);

  const stockStatusDonut = useMemo(
    () => [
      {
        label: "Available",
        value: quantityByStatus.available,
        color: "#10b981",
      },
      {
        label: "Low Stock",
        value: quantityByStatus.lowStock,
        color: "#f59e0b",
      },
      {
        label: "Out of Stock",
        value: quantityByStatus.outOfStock,
        color: "#f43f5e",
      },
      ...(quantityByStatus.other > 0
        ? [
            {
              label: "Other",
              value: quantityByStatus.other,
              color: "#94a3b8",
            },
          ]
        : []),
    ],
    [quantityByStatus],
  );

  return (
    <DashboardLayout activePage={activePage} onPageChange={onPageChange}>
      {viewMode === "attention" ? (
        <div className="space-y-5">
          <div className="rounded-xl border border-slate-200/90 bg-white p-5 shadow-xs">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <div className="flex items-center gap-2.5">
                  <h1 className="text-xl font-bold tracking-tight text-slate-900">
                    Parts Requiring Attention
                  </h1>
                  <button
                    type="button"
                    onClick={() => setViewMode("overview")}
                    className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-lg font-semibold text-slate-700 transition hover:bg-blue-50 hover:text-blue-700"
                    title="Back to Parts & Inventory"
                    aria-label="Back to Parts & Inventory"
                  >
                    ←
                  </button>
                  <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-800">
                    Page 5
                  </span>
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  Part-location positions currently holding low-stock or out-of-stock quantity.
                </p>
              </div>
            </div>
          </div>

          <ChartCard
            title="Parts Requiring Attention"
            subtitle={`${formatNumber(attentionRows.length)} stock positions need attention under the current filters`}
            height={650}
          >
            <div className="h-[560px] overflow-auto rounded-lg border border-slate-200">
              <table className="w-full min-w-[900px] text-left text-xs">
                <thead className="sticky top-0 z-10 bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="w-[30%] px-3 py-2.5 align-top">Part</th>
                    <th className="w-[22%] px-3 py-2.5 align-top">
                      <div className="mb-1">Part Type</div>
                      <select
                        value={attentionPartTypeFilter}
                        onChange={(event) => setAttentionPartTypeFilter(event.target.value)}
                        className="w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-[11px] font-normal normal-case tracking-normal text-slate-600 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                        aria-label="Filter by part type"
                      >
                        <option value="">All Part Types</option>
                        {attentionPartTypeOptions.map((partType) => (
                          <option key={partType} value={partType}>
                            {partType}
                          </option>
                        ))}
                      </select>
                    </th>
                    <th className="w-[28%] px-3 py-2.5 align-top">Location</th>
                    <th className="px-3 py-2.5 text-right align-top">Available</th>
                    <th className="px-3 py-2.5 text-right align-top">Low Stock</th>
                    <th className="px-3 py-2.5 text-right align-top">Out of Stock</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {visibleAttentionRows.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-14 text-center text-xs text-slate-400">
                        No low-stock or out-of-stock part records match the selected part type.
                      </td>
                    </tr>
                  ) : (
                    visibleAttentionRows.map((row) => (
                      <tr key={`${row.part}||${row.location}`} className="hover:bg-slate-50">
                        <td className="max-w-[280px] truncate px-3 py-2.5 font-medium text-slate-700" title={row.part}>
                          {row.part}
                        </td>
                        <td className="px-3 py-2.5 text-slate-600">{row.partType}</td>
                        <td className="max-w-[300px] truncate px-3 py-2.5 text-slate-600" title={row.location}>
                          {row.location}
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-emerald-700">
                          {formatNumber(row.available)}
                        </td>
                        <td className="px-3 py-2.5 text-right font-semibold tabular-nums text-amber-600">
                          {formatNumber(row.lowStock)}
                        </td>
                        <td className="px-3 py-2.5 text-right font-semibold tabular-nums text-rose-600">
                          {formatNumber(row.outOfStock)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </ChartCard>
        </div>
      ) : (
        <>
          <div className="mb-6 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-200/90 bg-white p-5 shadow-xs">
            <div>
              <div className="flex items-center gap-2.5">
                <h1 className="text-xl font-bold tracking-tight text-slate-900">Parts &amp; Inventory</h1>
                <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-800">Page 5</span>
              </div>
              <p className="mt-1 text-xs text-slate-500">
                Monitor spare-part stock availability, inventory levels, and distribution across logistics locations.
              </p>
            </div>
          </div>

          {error && (
            <div className="mb-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
          )}

          <div className="mb-6 grid grid-cols-2 gap-3.5 md:grid-cols-3 xl:grid-cols-6">
            <KPICard title="Total Part Quantity" value={formatNumber(totalQuantity)} subtext={`Units • ${formatNumber(uniqueParts)} distinct parts`} tooltip="Total quantity across all matching part inventory records" accentColor="blue" loading={loading} />
            <KPICard title="Available Quantity" value={formatNumber(quantityByStatus.available)} subtext="Available stock" tooltip="Part units currently marked Available" accentColor="emerald" loading={loading} />
            <KPICard title="Low Stock Quantity" value={formatNumber(quantityByStatus.lowStock)} subtext="Needs replenishment" tooltip="Part units currently marked Low Stock" accentColor="amber" loading={loading} />
            <KPICard title="Out of Stock" value={formatNumber(quantityByStatus.outOfStock)} subtext="No available quantity" tooltip="Part units currently marked Out of Stock" accentColor="rose" loading={loading} />
            <KPICard title="Locations with Parts" value={formatNumber(stockedLocations)} subtext="Carrying filtered stock" tooltip="Distinct logistics locations holding part quantity above zero under the current filters" accentColor="indigo" loading={loading} />
            <KPICard title="Stock Positions Below Level" value={formatNumber(partsBelowStockLevel)} subtext="Low or out of stock" tooltip="Part-location inventory positions currently holding low-stock or out-of-stock quantity" accentColor="rose" loading={loading} />
          </div>

          <div className="mb-5 grid grid-cols-1 gap-5 xl:grid-cols-2">
            <ChartCard title="Part Inventory Overview" subtitle="Part Type → Part → Location • Quantity with stock-status breakdown" badge="Interactive Drill-down" height={390}>
              <PartInventoryChart
                hierarchy={partHierarchy}
                path={partDrillPath}
                levels={["Part Type", "Part", "Location"]}
                onDrill={(label) => label === "__BACK__" ? setPartDrillPath((current) => current.slice(0, -1)) : setPartDrillPath((current) => [...current, label])}
              />
            </ChartCard>
            <ChartCard title="Part Availability by Location" subtitle="Location → Part Type → Part • Quantity with stock-status breakdown" badge="Interactive Drill-down" height={390}>
              <PartInventoryChart
                hierarchy={locationHierarchy}
                path={locationDrillPath}
                levels={["Location", "Part Type", "Part"]}
                onDrill={(label) => label === "__BACK__" ? setLocationDrillPath((current) => current.slice(0, -1)) : setLocationDrillPath((current) => [...current, label])}
              />
            </ChartCard>
          </div>

          <div className="mb-5 grid grid-cols-1 items-stretch gap-5 lg:grid-cols-12">
            <div className="lg:col-span-5">
              <ChartCard title="Stock Status Distribution" subtitle="Share of part units by availability status" height={330}>
                <DonutChart data={stockStatusDonut} height={260} emptyMessage="No matching part inventory records." />
              </ChartCard>
            </div>
            <div className="lg:col-span-7">
              <ChartCard
                title="Parts Requiring Attention"
                subtitle={`Top ${Math.min(ATTENTION_CHART_LIMIT, topAttentionParts.length)} parts by combined low-stock and out-of-stock quantity across ${formatNumber(partsBelowStockLevel)} stock positions`}
                height={330}
                action={
                  <button
                    type="button"
                    onClick={() => setViewMode("attention")}
                    className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-lg font-semibold text-slate-700 transition hover:bg-blue-50 hover:text-blue-700"
                    title="Open parts requiring attention"
                    aria-label="Open parts requiring attention"
                  >
                    →
                  </button>
                }
              >
                <div className="h-[262px] overflow-y-auto pr-1">
                  <StackedHorizontalBarChart
                    data={topAttentionParts}
                    height="236px"
                    emptyMessage="No low-stock or out-of-stock part records match the current filters."
                  />
                </div>
              </ChartCard>
            </div>
          </div>
        </>
      )}
    </DashboardLayout>
  );
}
