import { useEffect, useMemo, useState } from "react";
import DashboardLayout from "../component/DashboardLayout";
import KPICard from "../component/KpiCard";
import ChartCard from "../component/ChartCard";
import type { DashboardPage } from "../component/Header";
import { useFilters } from "../context/FilterContext";
import { formatNumber } from "../format";

import { loadDatabaseSnapshot } from "../dataService";

import type {
  FactVehicleDispatch,
  FactVehicleMovementHistory,
  DimLocation,
  FactVehicleInventory,
  FactLogisticsVehicleDelivery,
} from "../dataService";

import type { DimVModel, DimVehicle, DimRegion } from "../index";

import ClusteredColumnChart from "../component/charts/ClusteredColumnChart";
import MultiLineTrendChart from "../component/charts/MultiLineTrendChart";
import DrilldownBarChart, {
  buildCountHierarchy,
} from "../component/charts/DrilldownBarChart";
import {
  buildLatestMovementByDispatch,
  MOVEMENT_STATUSES,
  normalizeMovementStatus,
} from "../lib/movementStatus";

const MONTH_ORDER = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

const movementHierarchyLevels = [
  "Status",
  "Region",
  "Location",
  "Vehicle Type",
  "Model",
  "Variant",
];

function dateOnly(value: string | null | undefined): string {
  return value ? value.slice(0, 10) : "";
}

function monthLabel(value: string | null | undefined): string {
  if (!value) return "Unknown";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return new Intl.DateTimeFormat("en-US", { month: "short" }).format(date);
}

function monthDateRange(month: string, year: number): [string, string] | null {
  const monthIndex = MONTH_ORDER.indexOf(month);
  if (monthIndex < 0) return null;

  const monthNumber = String(monthIndex + 1).padStart(2, "0");
  const lastDay = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  return [
    `${year}-${monthNumber}-01`,
    `${year}-${monthNumber}-${String(lastDay).padStart(2, "0")}`,
  ];
}

function hoursBetween(
  start: string | null | undefined,
  end: string | null | undefined,
): number | null {
  if (!start || !end) return null;
  const diff = new Date(end).getTime() - new Date(start).getTime();
  if (!Number.isFinite(diff) || diff < 0) return null;
  return diff / 36e5;
}

type DetailRow = {
  dispatch: FactVehicleDispatch;
  vehicle?: DimVehicle;
  model?: DimVModel;
  origin?: DimLocation;
  destination?: DimLocation;
  region?: DimRegion;
  transporterName: string;
  routeLabel: string;
  status: string;
};

export default function DispatchVehicleMovement({
  activePage,
  onPageChange,
}: {
  activePage: DashboardPage;
  onPageChange: (page: DashboardPage) => void;
}) {
  const { filters, setFilter } = useFilters();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showDispatchDetails, setShowDispatchDetails] = useState(false);
  const [detailSearch, setDetailSearch] = useState("");
  const [statusFilterOpen, setStatusFilterOpen] = useState(false);
  // null = "All" selected (no status filter); otherwise the chosen statuses
  const [selectedStatuses, setSelectedStatuses] = useState<string[] | null>(
    null,
  );

  const [vehicles, setVehicles] = useState<DimVehicle[]>([]);
  const [models, setModels] = useState<DimVModel[]>([]);
  const [regions, setRegions] = useState<DimRegion[]>([]);
  const [locations, setLocations] = useState<DimLocation[]>([]);
  const [dispatches, setDispatches] = useState<FactVehicleDispatch[]>([]);
  const [movements, setMovements] = useState<FactVehicleMovementHistory[]>([]);
  const [inventory, setInventory] = useState<FactVehicleInventory[]>([]);
  const [deliveries, setDeliveries] = useState<FactLogisticsVehicleDelivery[]>(
    [],
  );
  const [transporters, setTransporters] = useState<
    { transporter_id: string; transporter_name: string }[]
  >([]);
  const [routes, setRoutes] = useState<
    {
      route_id: string;
      origin_location_id: string;
      destination_location_id: string;
    }[]
  >([]);

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
        setDispatches(snapshot.dispatches);
        setMovements(snapshot.movements);
        setInventory(snapshot.vehicleInventory);
        setDeliveries(snapshot.deliveries);
        setTransporters(snapshot.transporters);
        setRoutes(snapshot.routes);
      } catch (loadError) {
        console.error(loadError);
        setError("Unable to load Logistics dispatch data from Supabase.");
      } finally {
        setLoading(false);
      }
    }

    void loadData();
  }, []);

  const maps = useMemo(
    () => ({
      vehicle: new Map(vehicles.map((item) => [item.vehicle_id, item])),
      model: new Map(models.map((item) => [item.model_id, item])),
      region: new Map(regions.map((item) => [item.region_id, item])),
      location: new Map(locations.map((item) => [item.location_id, item])),
      transporter: new Map(
        transporters.map((item) => [item.transporter_id, item]),
      ),
      route: new Map(routes.map((item) => [item.route_id, item])),
    }),
    [vehicles, models, regions, locations, transporters, routes],
  );

  const latestMovementByDispatch = useMemo(
    () => buildLatestMovementByDispatch(movements),
    [movements],
  );

  const filteredDispatches = useMemo(() => {
    return dispatches.filter((dispatch) => {
      const vehicle = maps.vehicle.get(dispatch.vehicle_id);
      const model = vehicle ? maps.model.get(vehicle.model_id) : undefined;
      const origin = maps.location.get(dispatch.origin_location_id);
      const destination = maps.location.get(dispatch.destination_location_id);

      if (!vehicle) return false;

      const dispatchDate = dateOnly(dispatch.dispatch_date_time);
      if (filters.startDate && dispatchDate < filters.startDate) return false;
      if (filters.endDate && dispatchDate > filters.endDate) return false;

      if (filters.modelId && vehicle.model_id !== filters.modelId) return false;
      if (filters.variant && model?.variant !== filters.variant) return false;
      if (filters.vehicleType && model?.vehicle_type !== filters.vehicleType) {
        return false;
      }

      if (
        filters.regionId &&
        origin?.region_id !== filters.regionId &&
        destination?.region_id !== filters.regionId
      ) {
        return false;
      }

      if (
        filters.locationId &&
        dispatch.origin_location_id !== filters.locationId &&
        dispatch.destination_location_id !== filters.locationId
      ) {
        return false;
      }

      if (
        filters.transporterId &&
        dispatch.transporter_id !== filters.transporterId
      ) {
        return false;
      }

      if (filters.routeId && dispatch.route_id !== filters.routeId) {
        return false;
      }

      if (filters.inventoryStatus) {
        const hasInventoryStatus = inventory.some(
          (row) =>
            row.vehicle_id === dispatch.vehicle_id &&
            row.inventory_status === filters.inventoryStatus,
        );
        if (!hasInventoryStatus) return false;
      }

      if (filters.deliveryStatus) {
        const hasDeliveryStatus = deliveries.some(
          (row) =>
            row.dispatch_id === dispatch.dispatch_id &&
            row.delivery_status === filters.deliveryStatus,
        );
        if (!hasDeliveryStatus) return false;
      }

      return true;
    });
  }, [dispatches, deliveries, filters, inventory, maps]);

  const latestMovementRows = useMemo(
    () =>
      filteredDispatches.map((dispatch) => ({
        dispatch,
        movement: latestMovementByDispatch.get(dispatch.dispatch_id),
      })),
    [filteredDispatches, latestMovementByDispatch],
  );

  const metrics = useMemo(() => {
    const inTransitStatuses = new Set([
      "in transit",
      "in_transit",
      "transit",
      "on route",
      "on the way",
    ]);

    const vehiclesInTransit = new Set(
      latestMovementRows
        .filter(({ dispatch, movement }) => {
          const status = (
            movement?.status ??
            dispatch.dispatch_status ??
            ""
          ).toLowerCase();
          return inTransitStatuses.has(status);
        })
        .map(({ dispatch }) => dispatch.vehicle_id),
    ).size;

    const dispatchedVehicleSet = new Set(
      filteredDispatches.map((dispatch) => dispatch.vehicle_id),
    );

    const vehiclesAwaitingDispatch = vehicles.filter((vehicle) => {
      if (dispatchedVehicleSet.has(vehicle.vehicle_id)) return false;

      const model = maps.model.get(vehicle.model_id);
      const location = maps.location.get(vehicle.location_id);

      if (filters.modelId && vehicle.model_id !== filters.modelId) return false;
      if (filters.variant && model?.variant !== filters.variant) return false;
      if (filters.vehicleType && model?.vehicle_type !== filters.vehicleType) {
        return false;
      }
      if (filters.locationId && vehicle.location_id !== filters.locationId) {
        return false;
      }
      if (filters.regionId && location?.region_id !== filters.regionId) {
        return false;
      }

      if (filters.inventoryStatus) {
        const hasStatus = inventory.some(
          (row) =>
            row.vehicle_id === vehicle.vehicle_id &&
            row.inventory_status === filters.inventoryStatus,
        );
        if (!hasStatus) return false;
      }

      return true;
    }).length;

    const transitTimes = filteredDispatches
      .map((dispatch) =>
        hoursBetween(dispatch.dispatch_date_time, dispatch.arrival_date_time),
      )
      .filter((value): value is number => value !== null);

    const averageTransitTime =
      transitTimes.length > 0
        ? transitTimes.reduce((sum, value) => sum + value, 0) /
          transitTimes.length
        : 0;

    const monthlyDispatch = new Map<string, number>();
    MONTH_ORDER.forEach((month) => monthlyDispatch.set(month, 0));

    for (const dispatch of filteredDispatches) {
      const month = monthLabel(dispatch.dispatch_date_time);
      if (MONTH_ORDER.includes(month)) {
        monthlyDispatch.set(month, (monthlyDispatch.get(month) ?? 0) + 1);
      }
    }

    const transitBuckets = [
      { label: "0–24 hrs", min: 0, max: 24 },
      { label: "25–48 hrs", min: 25, max: 48 },
      { label: "49–72 hrs", min: 49, max: 72 },
      { label: "73–120 hrs", min: 73, max: 120 },
      { label: "120+ hrs", min: 121, max: Number.POSITIVE_INFINITY },
    ].map((bucket) => ({
      category: bucket.label,
      series: [
        {
          name: "Dispatches",
          value: transitTimes.filter(
            (value) => value >= bucket.min && value <= bucket.max,
          ).length,
          color: "bg-blue-600",
        },
      ],
    }));

    return {
      totalVehiclesDispatched: new Set(
        filteredDispatches.map((item) => item.vehicle_id),
      ).size,
      vehiclesInTransit,
      vehiclesAwaitingDispatch,
      averageTransitTime,
      monthlyDispatch: {
        labels: MONTH_ORDER,
        series: [
          {
            name: "Dispatches",
            color: "#2563eb",
            data: MONTH_ORDER.map((month) => monthlyDispatch.get(month) ?? 0),
          },
        ],
      },
      transitBuckets,
    };
  }, [
    filteredDispatches,
    filters,
    inventory,
    latestMovementRows,
    maps,
    vehicles,
  ]);

  const movementHierarchy = useMemo(() => {
    const rows = latestMovementRows.map(({ dispatch, movement }) => {
      const vehicle = maps.vehicle.get(dispatch.vehicle_id);
      const model = vehicle ? maps.model.get(vehicle.model_id) : undefined;
      const movementLocation = movement
        ? maps.location.get(movement.location_id)
        : maps.location.get(dispatch.origin_location_id);

      const region = movementLocation
        ? maps.region.get(movementLocation.region_id)
        : undefined;

      const status = normalizeMovementStatus(
        movement?.status || dispatch.dispatch_status || "Unknown",
      );

      return [
        status,
        region?.region_name ?? "Unknown",
        movementLocation?.location_name ?? "Unknown",
        model?.vehicle_type ?? "Unknown",
        model?.model_name ?? vehicle?.model_id ?? "Unknown",
        model?.variant ?? "Unknown",
      ];
    });

    return buildCountHierarchy(rows);
  }, [latestMovementRows, maps]);

  const dispatchMatrix = useMemo(() => {
    const regionSet = new Set<string>();
    const rowMap = new Map<
      string,
      {
        vehicleType: string;
        model: string;
        variant: string;
        counts: Map<string, number>;
        total: number;
      }
    >();

    for (const dispatch of filteredDispatches) {
      const vehicle = maps.vehicle.get(dispatch.vehicle_id);
      const model = vehicle ? maps.model.get(vehicle.model_id) : undefined;
      const origin = maps.location.get(dispatch.origin_location_id);
      const region = origin ? maps.region.get(origin.region_id) : undefined;
      const regionName = region?.region_name ?? "Unknown";
      const vehicleType = model?.vehicle_type ?? "Unknown";
      const modelName = model?.model_name ?? vehicle?.model_id ?? "Unknown";
      const variant = model?.variant ?? "Unknown";
      const key = `${vehicleType}|||${modelName}|||${variant}`;

      regionSet.add(regionName);
      const existing = rowMap.get(key);
      if (existing) {
        existing.counts.set(
          regionName,
          (existing.counts.get(regionName) ?? 0) + 1,
        );
        existing.total += 1;
      } else {
        rowMap.set(key, {
          vehicleType,
          model: modelName,
          variant,
          counts: new Map([[regionName, 1]]),
          total: 1,
        });
      }
    }

    const regionNames = Array.from(regionSet).sort((a, b) =>
      a.localeCompare(b),
    );
    const rows = Array.from(rowMap.values()).sort((a, b) =>
      `${a.vehicleType} ${a.model} ${a.variant}`.localeCompare(
        `${b.vehicleType} ${b.model} ${b.variant}`,
      ),
    );

    return { regionNames, rows };
  }, [filteredDispatches, maps]);

  const detailRows = useMemo<DetailRow[]>(() => {
    return filteredDispatches
      .map((dispatch) => {
        const vehicle = maps.vehicle.get(dispatch.vehicle_id);
        const model = vehicle ? maps.model.get(vehicle.model_id) : undefined;
        const origin = maps.location.get(dispatch.origin_location_id);
        const destination = maps.location.get(dispatch.destination_location_id);
        const region = origin ? maps.region.get(origin.region_id) : undefined;
        const transporter = maps.transporter.get(dispatch.transporter_id);
        const route = maps.route.get(dispatch.route_id);
        const movement = latestMovementByDispatch.get(dispatch.dispatch_id);

        return {
          dispatch,
          vehicle,
          model,
          origin,
          destination,
          region,
          transporterName:
            transporter?.transporter_name ?? dispatch.transporter_id,
          routeLabel: route
            ? `${maps.location.get(route.origin_location_id)?.location_name ?? route.origin_location_id} → ${maps.location.get(route.destination_location_id)?.location_name ?? route.destination_location_id}`
            : dispatch.route_id,
          status: normalizeMovementStatus(
            movement?.status ?? dispatch.dispatch_status ?? "Unknown",
          ),
        };
      })
      .sort(
        (a, b) =>
          new Date(b.dispatch.dispatch_date_time).getTime() -
          new Date(a.dispatch.dispatch_date_time).getTime(),
      );
  }, [filteredDispatches, latestMovementByDispatch, maps]);

  const statusOptions = useMemo(() => {
    const preferred = [...MOVEMENT_STATUSES];

    // Append any other statuses present in the data so none become unreachable
    const extras = Array.from(
      new Set(
        detailRows
          .map((row) => row.status)
          .filter(
            (status) =>
              status &&
              !preferred.some(
                (item) => item.toLowerCase() === status.toLowerCase(),
              ),
          ),
      ),
    ).sort((a, b) => a.localeCompare(b));

    return [...preferred, ...extras];
  }, [detailRows]);

  const toggleStatusFilter = (status: string) => {
    setSelectedStatuses((previous) => {
      const current = previous ?? [];
      const next = current.includes(status)
        ? current.filter((item) => item !== status)
        : [...current, status];
      // An empty selection falls back to "All"
      return next.length > 0 ? next : null;
    });
  };

  const visibleDetailRows = useMemo(() => {
    const query = detailSearch.trim().toLowerCase();
    const activeStatuses = selectedStatuses
      ? selectedStatuses.map((status) => status.toLowerCase())
      : null;

    return detailRows.filter((row) => {
      if (
        activeStatuses &&
        !activeStatuses.includes(row.status.toLowerCase())
      ) {
        return false;
      }

      if (!query) return true;

      const values = [
        row.dispatch.vehicle_id,
        row.vehicle?.vin,
        row.origin?.location_name,
        row.destination?.location_name,
        row.transporterName,
        row.routeLabel,
        row.status,
      ];

      return values.some((value) =>
        String(value ?? "")
          .toLowerCase()
          .includes(query),
      );
    });
  }, [detailRows, detailSearch, selectedStatuses]);

  return (
    <DashboardLayout activePage={activePage} onPageChange={onPageChange}>
      {!showDispatchDetails && (
        <>
          <div className="mb-6 flex flex-wrap items-center justify-between gap-4 bg-white p-5 rounded-xl border border-slate-200/90 shadow-xs">
            <div>
              <div className="flex items-center gap-2.5">
                <h1 className="text-xl font-bold tracking-tight text-slate-900">
                  Dispatch &amp; Delivery
                </h1>
                <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-blue-100 text-blue-800">
                  Page 2
                </span>
              </div>
              <p className="mt-1 text-xs text-slate-500">
                Track vehicle dispatches, movement status, transit time, and
                dispatch details across the logistics network.
              </p>
            </div>
          </div>

          {error && (
            <div className="mb-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}

          <div className="mb-6 grid grid-cols-2 gap-3.5 md:grid-cols-4">
            <KPICard
              title="Vehicles Dispatched"
              value={formatNumber(metrics.totalVehiclesDispatched)}
              subtext="Unique vehicles dispatched"
              tooltip="Distinct vehicles with dispatch records in the current filter context"
              accentColor="blue"
              loading={loading}
            />
            <KPICard
              title="Vehicles In Transit"
              value={formatNumber(metrics.vehiclesInTransit)}
              subtext="Currently moving"
              tooltip="Vehicles whose latest movement status indicates they are in transit"
              accentColor="indigo"
              loading={loading}
            />
            <KPICard
              title="Vehicles Awaiting Dispatch"
              value={formatNumber(metrics.vehiclesAwaitingDispatch)}
              subtext="Not yet dispatched"
              tooltip="Vehicles matching the active filters that do not yet have a dispatch record"
              accentColor="amber"
              loading={loading}
            />
            <KPICard
              title="Average Transit Time"
              value={`${(metrics.averageTransitTime / 24).toFixed(1)} days`}
              subtext="Dispatch to arrival"
              tooltip="Average elapsed time from dispatch to recorded arrival, shown in days"
              accentColor="emerald"
              loading={loading}
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-5">
            <ChartCard
              title="Vehicle Movement Status"
              subtitle="Status → Region → Location → Vehicle Type → Model → Variant"
              badge="Interactive Drill-down"
              height={330}
            >
              <DrilldownBarChart
                hierarchy={movementHierarchy}
                levels={movementHierarchyLevels}
                resetKey={JSON.stringify(filters)}
              />
            </ChartCard>

            <ChartCard
              title="Dispatch Volume Trend"
              subtitle="Monthly dispatch volume across the operational calendar"
              height={330}
            >
              <MultiLineTrendChart
                labels={metrics.monthlyDispatch.labels}
                series={metrics.monthlyDispatch.series}
                valueFormatter={(value) => formatNumber(value)}
                height={235}
                onPointClick={(month) => {
                  const matchingYears = filteredDispatches
                    .filter(
                      (dispatch) =>
                        monthLabel(dispatch.dispatch_date_time) === month,
                    )
                    .map((dispatch) =>
                      Number(dateOnly(dispatch.dispatch_date_time).slice(0, 4)),
                    )
                    .filter(Number.isFinite);
                  const availableYears = dispatches
                    .map((dispatch) =>
                      Number(dateOnly(dispatch.dispatch_date_time).slice(0, 4)),
                    )
                    .filter(Number.isFinite);
                  const year = matchingYears.length
                    ? Math.max(...matchingYears)
                    : filters.startDate
                      ? Number(filters.startDate.slice(0, 4))
                      : filters.endDate
                        ? Number(filters.endDate.slice(0, 4))
                        : Math.max(...availableYears, 2025);
                  const range = monthDateRange(month, year);
                  if (range) {
                    setFilter("startDate", range[0]);
                    setFilter("endDate", range[1]);
                  }
                }}
              />
            </ChartCard>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-5">
            <ChartCard
              title="Dispatch Distribution by Vehicle Type & Region"
              subtitle="Compare each vehicle type, model, and variant across all dispatch regions"
              height={330}
            >
              <div className="h-[235px] overflow-auto rounded-lg border border-slate-200 bg-white">
                {dispatchMatrix.rows.length === 0 ? (
                  <div className="flex h-full items-center justify-center text-sm text-slate-500">
                    No dispatch data matches the current filters.
                  </div>
                ) : (
                  <table className="min-w-full border-collapse text-xs">
                    <thead className="sticky top-0 z-10 bg-slate-50">
                      <tr className="border-b border-slate-200 text-slate-600">
                        <th className="sticky left-0 z-20 min-w-[210px] bg-slate-50 px-3 py-2 text-left font-bold">
                          Vehicle Type / Model / Variant
                        </th>
                        {dispatchMatrix.regionNames.map((region) => (
                          <th
                            key={region}
                            className="min-w-[90px] px-3 py-2 text-right font-bold"
                          >
                            {region}
                          </th>
                        ))}
                        <th className="min-w-[80px] px-3 py-2 text-right font-bold">
                          Total
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {dispatchMatrix.rows.map((row) => (
                        <tr
                          key={`${row.vehicleType}-${row.model}-${row.variant}`}
                          className="hover:bg-slate-50"
                        >
                          <td className="sticky left-0 z-10 bg-white px-3 py-2">
                            <div className="font-semibold text-slate-800">
                              {row.vehicleType}
                            </div>
                            <div className="text-[11px] text-slate-500">
                              {row.model} · {row.variant}
                            </div>
                          </td>
                          {dispatchMatrix.regionNames.map((region) => {
                            const value = row.counts.get(region) ?? 0;
                            return (
                              <td
                                key={region}
                                className="px-3 py-2 text-right font-semibold text-slate-700"
                              >
                                {formatNumber(value)}
                              </td>
                            );
                          })}
                          <td className="px-3 py-2 text-right font-bold text-blue-700">
                            {formatNumber(row.total)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </ChartCard>

            <ChartCard
              title="Transit Time Distribution"
              subtitle="Dispatch-to-arrival time across completed movements"
              height={330}
            >
              <ClusteredColumnChart
                data={metrics.transitBuckets}
                valueFormatter={(value) => formatNumber(value)}
                height={235}
                showLegend={false}
              />
            </ChartCard>
          </div>

          <ChartCard
            title="Dispatch & Movement Details"
            action={
              <button
                type="button"
                onClick={() => {
                  setShowDispatchDetails(true);
                  setDetailSearch("");
                  setSelectedStatuses(null);
                  setStatusFilterOpen(false);
                }}
                aria-label="Open dispatch and movement details"
                className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-lg font-semibold text-slate-700 transition hover:bg-blue-50 hover:text-blue-700"
              >
                →
              </button>
            }
          >
            {null}
          </ChartCard>
        </>
      )}

      {showDispatchDetails && (
        <div className="mt-5">
          <div className="mb-5 rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <div className="flex items-center gap-2.5">
                  <button
                    type="button"
                    onClick={() => setShowDispatchDetails(false)}
                    className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                  >
                    ← Back to Overview
                  </button>
                  <span className="h-5 w-px bg-slate-200" />
                  <h2 className="text-xl font-bold tracking-tight text-slate-900">
                    Dispatch &amp; Movement Details
                  </h2>
                  <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-800">
                    Operational Details
                  </span>
                </div>
                <p className="mt-2 text-xs text-slate-500">
                  Detailed vehicle-level records based on the global filters
                  selected in the left panel.
                </p>
              </div>

              <span className="rounded-full border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700">
                {formatNumber(visibleDetailRows.length)} Matching Records
              </span>
            </div>
          </div>

          <ChartCard
            title="Dispatch Records"
            subtitle="Use search and status filter to narrow the operational record list"
          >
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <input
                type="search"
                value={detailSearch}
                onChange={(event) => setDetailSearch(event.target.value)}
                placeholder="Search Vehicle ID, VIN, Origin, Transporter..."
                className="w-full max-w-md rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
              />
              <span className="text-xs text-slate-500">
                Showing {formatNumber(Math.min(visibleDetailRows.length, 100))}{" "}
                of {formatNumber(visibleDetailRows.length)} records
              </span>
            </div>

            <div className="overflow-x-auto rounded-lg border border-slate-200">
              <table className="w-full min-w-[1100px] text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-slate-700">
                    <th className="px-4 py-3 font-bold uppercase text-[11px]">
                      Vehicle ID
                    </th>
                    <th className="px-4 py-3 font-bold uppercase text-[11px]">
                      VIN
                    </th>
                    <th className="px-4 py-3 font-bold uppercase text-[11px]">
                      Origin
                    </th>
                    <th className="px-4 py-3 font-bold uppercase text-[11px]">
                      Destination
                    </th>
                    <th className="px-4 py-3 font-bold uppercase text-[11px]">
                      Transporter
                    </th>
                    <th className="px-4 py-3 font-bold uppercase text-[11px]">
                      Route
                    </th>
                    <th className="px-4 py-3 font-bold uppercase text-[11px]">
                      Dispatch Date
                    </th>
                    <th className="px-4 py-3 font-bold uppercase text-[11px]">
                      Planned Delivery
                    </th>
                    <th className="px-4 py-3 font-bold uppercase text-[11px]">
                      <div className="relative flex items-center gap-1.5">
                        <span>Status</span>
                        <button
                          type="button"
                          onClick={() => setStatusFilterOpen((open) => !open)}
                          aria-label="Filter by status"
                          title="Filter by status"
                          className={`flex h-5 w-5 items-center justify-center rounded text-[10px] leading-none transition ${
                            selectedStatuses
                              ? "bg-blue-600 text-white shadow-xs"
                              : "text-slate-400 hover:bg-slate-200 hover:text-slate-700"
                          }`}
                        >
                          ▾
                        </button>

                        {statusFilterOpen && (
                          <>
                            <div
                              className="fixed inset-0 z-20"
                              onClick={() => setStatusFilterOpen(false)}
                            />
                            <div className="absolute right-0 top-full z-30 mt-1 w-44 rounded-lg border border-slate-200 bg-white p-2 shadow-lg">
                              <div className="px-2 pb-1 pt-1 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                                Status
                              </div>
                              <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50">
                                <input
                                  type="checkbox"
                                  checked={selectedStatuses === null}
                                  onChange={() => setSelectedStatuses(null)}
                                  className="h-3.5 w-3.5 accent-blue-600"
                                />
                                All
                              </label>
                              {statusOptions.map((status) => (
                                <label
                                  key={status}
                                  className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                                >
                                  <input
                                    type="checkbox"
                                    checked={
                                      selectedStatuses?.some(
                                        (item) =>
                                          item.toLowerCase() ===
                                          status.toLowerCase(),
                                      ) ?? false
                                    }
                                    onChange={() => toggleStatusFilter(status)}
                                    className="h-3.5 w-3.5 accent-blue-600"
                                  />
                                  {status}
                                </label>
                              ))}
                            </div>
                          </>
                        )}
                      </div>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {visibleDetailRows.slice(0, 100).map((row) => (
                    <tr
                      key={row.dispatch.dispatch_id}
                      className="transition-colors hover:bg-slate-50/60"
                    >
                      <td className="px-4 py-3 font-semibold text-slate-800">
                        {row.dispatch.vehicle_id}
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        {row.vehicle?.vin ?? "—"}
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        {row.origin?.location_name ??
                          row.dispatch.origin_location_id}
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        {row.destination?.location_name ??
                          row.dispatch.destination_location_id}
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        {row.transporterName}
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        {row.routeLabel}
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        {dateOnly(row.dispatch.dispatch_date_time)}
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        {dateOnly(row.dispatch.planned_delivery_date) || "—"}
                      </td>
                      <td className="px-4 py-3">
                        <span className="rounded-full bg-blue-50 px-2 py-1 text-[11px] font-semibold text-blue-700">
                          {row.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {visibleDetailRows.length === 0 && (
                <div className="py-10 text-center text-sm text-slate-500">
                  No dispatch records match the current filters/search.
                </div>
              )}

              {visibleDetailRows.length > 100 && (
                <div className="border-t border-slate-200 bg-slate-50 px-4 py-2 text-[11px] text-slate-500">
                  Showing the first 100 matching records. Use the global filters
                  or search to narrow the operational detail set.
                </div>
              )}
            </div>
          </ChartCard>
        </div>
      )}
    </DashboardLayout>
  );
}
