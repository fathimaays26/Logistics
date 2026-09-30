import { useEffect, useMemo, useState } from "react";
import DashboardLayout from "../component/DashboardLayout";
import KPICard from "../component/KpiCard";
import ChartCard from "../component/ChartCard";
import type { DashboardPage } from "../component/Header";
import { useFilters } from "../context/FilterContext";
import { formatNumber } from "../format";
import {
  loadDatabaseSnapshot,
  type DimLocation,
  type DimRegion,
  type DimVehicle,
  type DimVModel,
  type FactVehicleInventory,
} from "../dataService";
const AGE_BUCKETS = ["0–30 Days", "31–60 Days", "61–90 Days", "91–120 Days", "120+ Days"];

type InventoryRecord = {
  inventory: FactVehicleInventory;
  vehicle?: DimVehicle;
  model?: DimVModel;
  location?: DimLocation;
  region?: DimRegion;
  ageDays: number;
  isActive: boolean;
};

type HierarchyNode = {
  label: string;
  count: number;
  children: Map<string, HierarchyNode>;
};

function normalize(value: string | null | undefined) {
  return (value ?? "").trim().toLowerCase().replace(/[_-]+/g, " ");
}

function dateOnly(value: string | null | undefined) {
  return value ? value.slice(0, 10) : "";
}

function daysSince(value: string | null | undefined) {
  if (!value) return 0;
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return 0;
  return Math.max(0, (Date.now() - timestamp) / (1000 * 60 * 60 * 24));
}

function ageBucket(days: number) {
  if (days <= 30) return "0–30 Days";
  if (days <= 60) return "31–60 Days";
  if (days <= 90) return "61–90 Days";
  if (days <= 120) return "91–120 Days";
  return "120+ Days";
}

// Groups a raw inventory_status into one exclusive stacked-chart group so the
// column totals always add up to the filtered active inventory count.
function inventoryStatusGroup(value: string | null | undefined): string {
  const status = normalize(value);
  if (status.includes("allocat")) return "Allocated";
  if (status.includes("await") || status.includes("dispatch")) {
    return "Awaiting Dispatch";
  }
  if (
    status.includes("avail") ||
    status.includes("stock") ||
    status.includes("ready")
  ) {
    return "Available";
  }
  return "Other";
}

function buildHierarchy(
  rows: Array<{ labels: string[] }>,
): Map<string, HierarchyNode> {
  const root = new Map<string, HierarchyNode>();

  for (const row of rows) {
    let level = root;

    row.labels.forEach((rawLabel, index) => {
      const label = rawLabel || "Unknown";
      let node = level.get(label);

      if (!node) {
        node = { label, count: 0, children: new Map() };
        level.set(label, node);
      }

      node.count += 1;
      if (index < row.labels.length - 1) {
        level = node.children;
      }
    });
  }

  return root;
}

function getHierarchyView(
  hierarchy: Map<string, HierarchyNode>,
  path: string[],
) {
  let current = hierarchy;

  for (const segment of path) {
    const node = current.get(segment);
    if (!node) return [];
    current = node.children;
  }

  return [...current.values()].sort((a, b) => b.count - a.count);
}

function InventoryHierarchyChart({
  hierarchy,
  path,
  levels,
  onDrill,
}: {
  hierarchy: Map<string, HierarchyNode>;
  path: string[];
  levels: readonly string[];
  onDrill: (label: string) => void;
}) {
  const nodes = useMemo(
    () => getHierarchyView(hierarchy, path),
    [hierarchy, path],
  );

  const maxValue = Math.max(1, ...nodes.map((node) => node.count));

  return (
    <div className="h-[235px] overflow-y-auto pr-1">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="text-[11px] text-slate-500">
          {levels[path.length] ?? levels[levels.length - 1]}
          {path.length > 0 && (
            <span className="ml-1 text-slate-400">• {path.join(" / ")}</span>
          )}
        </div>


      </div>

      {nodes.length === 0 ? (
        <div className="flex h-36 items-center justify-center text-xs text-slate-400">
          No matching inventory records.
        </div>
      ) : (
        <div className="space-y-2.5">
          {nodes.map((node) => (
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
              title={
                node.children.size > 0
                  ? `Drill down into ${node.label}`
                  : node.label
              }
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
                  {formatNumber(node.count)}
                </span>
              </div>

              <div className="h-2.5 overflow-hidden rounded-md bg-slate-100">
                <div
                  className="h-full rounded-md bg-blue-600 transition-all"
                  style={{
                    width: `${Math.max((node.count / maxValue) * 100, 3)}%`,
                  }}
                />
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

type StackedColumnSegment = {
  name: string;
  value: number;
  colorClass: string;
};

// Smallest reusable stacked column chart (page-local): each category column is
// divided into vertical segments so multiple dimensions fit in one column.
function StackedColumnChart({
  data,
  valueFormatter = formatNumber,
}: {
  data: Array<{ category: string; segments: StackedColumnSegment[] }>;
  valueFormatter?: (value: number) => string;
}) {
  const totals = data.map((group) =>
    group.segments.reduce((sum, segment) => sum + segment.value, 0),
  );
  const maxTotal = Math.max(1, ...totals);

  const legendNames: string[] = [];
  const colorByName = new Map<string, string>();
  for (const group of data) {
    for (const segment of group.segments) {
      if (!legendNames.includes(segment.name)) {
        legendNames.push(segment.name);
      }
      colorByName.set(segment.name, segment.colorClass);
    }
  }

  if (totals.every((total) => total === 0)) {
    return (
      <div className="flex h-40 items-center justify-center text-xs text-slate-400">
        No active inventory records match the current filters.
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {legendNames.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-3 border-b border-slate-100 pb-2">
          {legendNames.map((name) => (
            <span
              key={name}
              className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-600"
            >
              <span
                className={`h-2.5 w-2.5 rounded-xs ${colorByName.get(name) ?? "bg-slate-400"}`}
              />
              {name}
            </span>
          ))}
        </div>
      )}

      <div className="flex min-h-0 flex-1 gap-2 sm:gap-3">
        {data.map((group, index) => {
          const total = totals[index];

          return (
            <div
              key={group.category}
              className="flex min-w-0 flex-1 flex-col items-center justify-end"
            >
              <span className="mb-1 shrink-0 text-[11px] font-bold tabular-nums text-slate-700">
                {valueFormatter(total)}
              </span>
              {total === 0 ? (
                <div className="h-1 w-full max-w-[64px] rounded-full bg-slate-100" />
              ) : (
                <div
                  className="flex w-full max-w-[64px] flex-col overflow-hidden rounded-t-md shadow-xs transition-all"
                  style={{
                    height: `${Math.max((total / maxTotal) * 190, 8)}px`,
                  }}
                  title={`${group.category}: ${valueFormatter(total)} vehicles`}
                >
                  {group.segments
                    .filter((segment) => segment.value > 0)
                    .map((segment) => (
                      <div
                        key={segment.name}
                        className={`transition-all ${segment.colorClass}`}
                        style={{
                          height: `${(segment.value / total) * 100}%`,
                        }}
                        title={`${group.category} • ${segment.name}: ${valueFormatter(segment.value)}`}
                      />
                    ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-1.5 flex shrink-0 gap-2 sm:gap-3">
        {data.map((group) => (
          <div
            key={group.category}
            className="min-w-0 flex-1 text-center text-[10px] font-semibold leading-tight text-slate-500"
          >
            {group.category}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function InventoryAvailability({
  activePage,
  onPageChange,
}: {
  activePage: DashboardPage;
  onPageChange: (page: DashboardPage) => void;
}) {
  const { filters } = useFilters();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [vehicles, setVehicles] = useState<DimVehicle[]>([]);
  const [models, setModels] = useState<DimVModel[]>([]);
  const [regions, setRegions] = useState<DimRegion[]>([]);
  const [locations, setLocations] = useState<DimLocation[]>([]);
  const [vehicleInventory, setVehicleInventory] = useState<FactVehicleInventory[]>([]);

  const filterKey = JSON.stringify(filters);
  const [drillState, setDrillState] = useState<{ key: string; path: string[] }>({
    key: filterKey,
    path: [],
  });

  // Reset the drill path when the global filters change, adjusting state during
  // render instead of inside an effect.
  if (drillState.key !== filterKey) {
    setDrillState({ key: filterKey, path: [] });
  }

  const regionDrillPath = drillState.key === filterKey ? drillState.path : [];
  const setRegionDrillPath = (updater: (current: string[]) => string[]): void =>
    setDrillState((current) => ({ ...current, path: updater(current.path) }));

  useEffect(() => {
    async function loadData() {
      setLoading(true);
      setError(null);

      try {
        const snapshot = await loadDatabaseSnapshot();
        setVehicles(snapshot.vehicles);
        setModels(snapshot.models);
        setRegions(snapshot.regions);
        setLocations(snapshot.locations);
        setVehicleInventory(snapshot.vehicleInventory);
      } catch (loadError) {
        console.error(loadError);
        setError("Unable to load Logistics inventory data from Supabase.");
      } finally {
        setLoading(false);
      }
    }

    void loadData();
  }, []);

  const maps = useMemo(
    () => ({
      vehicle: new Map(vehicles.map((vehicle) => [vehicle.vehicle_id, vehicle])),
      model: new Map(models.map((model) => [model.model_id, model])),
      region: new Map(regions.map((region) => [region.region_id, region])),
      location: new Map(
        locations.map((location) => [location.location_id, location]),
      ),
    }),
    [vehicles, models, regions, locations],
  );

  const enrichedInventory = useMemo<InventoryRecord[]>(
    () =>
      vehicleInventory.map((inventory) => {
        const vehicle = maps.vehicle.get(inventory.vehicle_id);
        const model = vehicle
          ? maps.model.get(vehicle.model_id)
          : undefined;
        const location = maps.location.get(inventory.location_id);
        const region = location
          ? maps.region.get(location.region_id)
          : undefined;

        return {
          inventory,
          vehicle,
          model,
          location,
          region,
          ageDays: daysSince(inventory.inventory_entry_date),
          isActive: !inventory.exit_date,
        };
      }),
    [vehicleInventory, maps],
  );

  const filteredInventory = useMemo(() => {
    return enrichedInventory.filter((row) => {
      const { inventory, vehicle, model, region } = row;

      if (!row.isActive) return false;

      const inventoryDate = dateOnly(inventory.inventory_entry_date);

      if (filters.startDate && inventoryDate < filters.startDate) return false;
      if (filters.endDate && inventoryDate > filters.endDate) return false;

      if (filters.regionId && region?.region_id !== filters.regionId) return false;
      if (filters.locationId && inventory.location_id !== filters.locationId) return false;
      if (filters.modelId && vehicle?.model_id !== filters.modelId) return false;
      if (filters.variant && model?.variant !== filters.variant) return false;
      if (filters.vehicleType && model?.vehicle_type !== filters.vehicleType) {
        return false;
      }

      if (
        filters.inventoryStatus &&
        normalize(inventory.inventory_status) !== normalize(filters.inventoryStatus)
      ) {
        return false;
      }

      return true;
    });
  }, [enrichedInventory, filters]);

  const availableVehicles = useMemo(
    () =>
      filteredInventory.filter((row) =>
        ["available", "in stock", "ready"].includes(
          normalize(row.inventory.inventory_status),
        ),
      ).length,
    [filteredInventory],
  );

  const vehiclesAllocated = useMemo(
    () =>
      filteredInventory.filter((row) =>
        normalize(row.inventory.inventory_status).includes("allocat"),
      ).length,
    [filteredInventory],
  );

  const averageInventoryAge = useMemo(() => {
    if (filteredInventory.length === 0) return 0;
    return (
      filteredInventory.reduce((sum, row) => sum + row.ageDays, 0) /
      filteredInventory.length
    );
  }, [filteredInventory]);


  const inventoryAgeingStatusData = useMemo(() => {
    const bucketCounts = new Map<string, Map<string, number>>(
      AGE_BUCKETS.map((bucket) => [bucket, new Map<string, number>()]),
    );

    for (const row of filteredInventory) {
      const counts = bucketCounts.get(ageBucket(row.ageDays));
      if (!counts) continue;
      const group = inventoryStatusGroup(row.inventory.inventory_status);
      counts.set(group, (counts.get(group) ?? 0) + 1);
    }

    let otherTotal = 0;
    for (const counts of bucketCounts.values()) {
      otherTotal += counts.get("Other") ?? 0;
    }

    const groups = [
      { name: "Available", colorClass: "bg-blue-600" },
      { name: "Allocated", colorClass: "bg-teal-500" },
      { name: "Awaiting Dispatch", colorClass: "bg-amber-500" },
      ...(otherTotal > 0
        ? [{ name: "Other", colorClass: "bg-slate-400" }]
        : []),
    ];

    return AGE_BUCKETS.map((bucket) => {
      const counts = bucketCounts.get(bucket);
      return {
        category: bucket,
        segments: groups.map((group) => ({
          name: group.name,
          value: counts?.get(group.name) ?? 0,
          colorClass: group.colorClass,
        })),
      };
    });
  }, [filteredInventory]);

  const inventoryAvailabilityRate =
    filteredInventory.length > 0
      ? (availableVehicles / filteredInventory.length) * 100
      : 0;

  const regionHierarchy = useMemo(
    () =>
      buildHierarchy(
        filteredInventory.map((row) => ({
          labels: [
            row.region?.region_name ?? "Unknown Region",
            row.location?.location_name ?? "Unknown Location",
            row.model?.vehicle_type ?? "Unknown Type",
            row.model?.model_name ?? "Unknown Model",
            row.model?.variant ?? "Unknown Variant",
          ],
        })),
      ),
    [filteredInventory],
  );


  return (
    <DashboardLayout activePage={activePage} onPageChange={onPageChange}>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-200/90 bg-white p-5 shadow-xs">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-xl font-bold tracking-tight text-slate-900">
              Vehicle Inventory
            </h1>
            <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-800">
              Page 4
            </span>
          </div>
          <p className="mt-1 text-xs text-slate-500">
            Monitor finished vehicles currently held across the logistics network, including inventory ageing, availability, allocation, and regional distribution.
          </p>
        </div>
      </div>

      {error && (
        <div className="mb-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="mb-6 grid grid-cols-2 gap-3.5 md:grid-cols-4 xl:grid-cols-6">
        <KPICard
          title="Available Vehicles"
          value={formatNumber(availableVehicles)}
          subtext="Ready / available inventory"
          tooltip="Active inventory records currently marked available, in stock, or ready"
          accentColor="emerald"
          loading={loading}
        />
        <KPICard
          title="Vehicles in Inventory"
          value={formatNumber(filteredInventory.length)}
          subtext="Active inventory"
          tooltip="Active vehicle inventory records matching the current filters"
          accentColor="blue"
          loading={loading}
        />
        <KPICard
          title="Average Inventory Age"
          value={`${averageInventoryAge.toFixed(1)}d`}
          subtext="Active inventory"
          tooltip="Average number of days since inventory entry for active vehicle inventory"
          accentColor="amber"
          loading={loading}
        />
        <KPICard
          title="Vehicles Allocated"
          value={formatNumber(vehiclesAllocated)}
          subtext="Allocated inventory"
          tooltip="Active vehicle inventory records with an allocated status"
          accentColor="orange"
          loading={loading}
        />
        <KPICard
          title="Vehicles >120 Days"
          value={formatNumber(
            filteredInventory.filter((row) => row.ageDays > 120).length,
          )}
          subtext="Long-dwell inventory"
          tooltip="Active vehicles with inventory age above 120 days"
          accentColor="red"
          loading={loading}
        />
        <KPICard
          title="Availability Rate"
          value={`${inventoryAvailabilityRate.toFixed(1)}%`}
          subtext="Available / total inventory"
          tooltip="Available vehicles divided by active inventory vehicles"
          accentColor="emerald"
          loading={loading}
        />
      </div>

      <div className="mb-5 grid grid-cols-1 gap-5">
        <ChartCard
          title="Vehicle Inventory Ageing"
          subtitle="Active finished vehicles grouped by time spent in inventory, with status breakdown"
          badge="Stacked"
          height={340}
        >
          <StackedColumnChart
            data={inventoryAgeingStatusData}
            valueFormatter={(value) => formatNumber(value)}
          />
        </ChartCard>
      </div>

      <div className="mb-5 grid grid-cols-1 gap-5">
        <ChartCard
          title="Vehicle Inventory by Region"
          subtitle="Where finished vehicles are currently held across the logistics network • Drilldown: Region → Location → Vehicle Type → Model → Variant"
          badge="Interactive Drill-down"
          action={
            <button
              type="button"
              onClick={() =>
                setRegionDrillPath((current) =>
                  current.length > 0 ? current.slice(0, -1) : current,
                )
              }
              disabled={regionDrillPath.length === 0}
              className="rounded-md border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-600 hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700 disabled:cursor-not-allowed disabled:opacity-40"
            >
              ↖ Back
            </button>
          }
          height={360}
        >
          <InventoryHierarchyChart
            hierarchy={regionHierarchy}
            path={regionDrillPath}
            levels={[
              "Region",
              "Location",
              "Vehicle Type",
              "Model",
              "Variant",
            ]}
            onDrill={(label) =>
              label === "__BACK__"
                ? setRegionDrillPath((current) => current.slice(0, -1))
                : setRegionDrillPath((current) => [...current, label])
            }
          />
        </ChartCard>
      </div>

    </DashboardLayout>
  );
}
