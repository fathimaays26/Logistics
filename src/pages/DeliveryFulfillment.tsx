import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
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
  type DimRoute,
  type DimVModel,
  type DimVehicle,
  type FactLogisticsException,
  type FactLogisticsVehicleDelivery,
  type FactTransportationCost,
  type FactTransporter,
  type FactVehicleMovementHistory,
  type FactVehicleDispatch,
} from "../dataService";
import HorizontalBarChart from "../component/charts/HorizontalBarChart";
import ClusteredColumnChart from "../component/charts/ClusteredColumnChart";
import {
  buildLatestMovementByDispatch,
  resolveDispatchMovementStatus,
} from "../lib/movementStatus";
import MetricDrilldownChart, {
  buildMetricHierarchy,
  type MetricDrillRow,
} from "../component/charts/MetricDrilldownChart";

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

const TRANSPORTER_LEVELS = ["Transporter", "Region", "Route"] as const;

type EnrichedDispatch = FactVehicleDispatch & {
  vehicle?: DimVehicle;
  model?: DimVModel;
  origin?: DimLocation;
  destination?: DimLocation;
  region?: DimRegion;
  transporter?: FactTransporter;
  route?: DimRoute;
  delivery?: FactLogisticsVehicleDelivery;
  transitDays: number | null;
  isOnTime: boolean | null;
  movementStatus: string;
  isDelayed: boolean;
  cost: number;
};

function routeLabelFor(row: EnrichedDispatch): string {
  return row.route
    ? `${row.origin?.location_name ?? row.route.origin_location_id} → ${
        row.destination?.location_name ?? row.route.destination_location_id
      }`
    : row.route_id;
}

function dateOnly(value: string | null | undefined): string {
  return value ? value.slice(0, 10) : "";
}

function monthLabel(value: string | null | undefined): string {
  if (!value) return "Unknown";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return new Intl.DateTimeFormat("en-US", { month: "short" }).format(date);
}

function daysBetween(
  start: string | null | undefined,
  end: string | null | undefined,
): number | null {
  if (!start || !end) return null;

  const startMs = new Date(start).getTime();
  const endMs = new Date(end).getTime();

  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return null;

  const diff = (endMs - startMs) / (1000 * 60 * 60 * 24);
  return diff >= 0 ? diff : null;
}

/**
 * Column-level multi-select filter for the detail table.
 *
 * Rendered in a fixed-position panel so it is never clipped by the table's
 * scroll container. `selected === null` means "no filter on this column".
 */
function ColumnFilterMenu({
  label,
  options,
  selected,
  onChange,
}: {
  label: string;
  options: string[];
  selected: string[] | null;
  onChange: (next: string[] | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(
    null,
  );
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  function reposition() {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    setCoords({
      top: rect.bottom + 4,
      left: Math.max(8, Math.min(rect.left, window.innerWidth - 250)),
    });
  }

  useEffect(() => {
    if (!open) return;

    // A click is "outside" only when it lands in neither the trigger nor the
    // panel. Checking the panel matters because it is portalled to <body>.
    function handlePointerDown(event: MouseEvent) {
      const target = event.target as Node;
      if (
        !buttonRef.current?.contains(target) &&
        !panelRef.current?.contains(target)
      ) {
        setOpen(false);
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [open]);

  function toggleMenu() {
    if (open) {
      setOpen(false);
      return;
    }
    reposition();
    setOpen(true);
  }

  function toggleOption(option: string) {
    const current = selected ?? [];
    const next = current.includes(option)
      ? current.filter((item) => item !== option)
      : [...current, option];
    onChange(next.length === 0 ? null : next);
  }

  const isActive = selected !== null;

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={toggleMenu}
        aria-expanded={open}
        aria-label={`Filter by ${label}`}
        title={`Filter by ${label}`}
        className={`ml-1 inline-flex h-5 min-w-5 items-center justify-center gap-0.5 rounded align-middle transition-colors ${
          isActive
            ? "bg-blue-600 px-1 text-white"
            : "bg-slate-200/70 px-1 text-slate-600 hover:bg-blue-600 hover:text-white"
        }`}
      >
        <span aria-hidden className="text-[10px] leading-none">
          ▾
        </span>
        {isActive && (
          <span className="text-[9px] font-bold leading-none tabular-nums">
            {selected?.length}
          </span>
        )}
      </button>

      {open &&
        coords &&
        createPortal(
          <div
            ref={panelRef}
            style={{ top: coords.top, left: coords.left }}
            className="fixed z-[1000] w-56 rounded-lg border border-slate-200 bg-white p-2 shadow-xl"
          >
            <div className="mb-1 flex items-center justify-between border-b border-slate-100 pb-1.5">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                {label}
              </span>
              <div className="flex gap-1">
                <button
                  type="button"
                  onClick={() => onChange(options.length ? [...options] : null)}
                  className="rounded px-1.5 py-0.5 text-[10px] font-semibold text-blue-700 hover:bg-blue-50"
                >
                  All
                </button>
                <button
                  type="button"
                  onClick={() => onChange(null)}
                  className="rounded px-1.5 py-0.5 text-[10px] font-semibold text-slate-500 hover:bg-slate-100"
                >
                  Clear
                </button>
              </div>
            </div>

            <div className="max-h-56 overflow-y-auto">
              {options.length === 0 ? (
                <div className="px-2 py-3 text-center text-[11px] text-slate-400">
                  No options
                </div>
              ) : (
                options.map((option) => (
                  <label
                    key={option}
                    className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 hover:bg-slate-50"
                  >
                    <input
                      type="checkbox"
                      checked={selected?.includes(option) ?? false}
                      onChange={() => toggleOption(option)}
                      className="h-3.5 w-3.5 shrink-0 rounded border-slate-300 accent-blue-600"
                    />
                    <span className="truncate text-[11px] text-slate-700">
                      {option}
                    </span>
                  </label>
                ))
              )}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}

export default function DeliveryFulfillment({
  activePage,
  onPageChange,
}: {
  activePage: DashboardPage;
  onPageChange: (page: DashboardPage) => void;
}) {
  const { filters, matchingModelIds } = useFilters();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [vehicles, setVehicles] = useState<DimVehicle[]>([]);
  const [models, setModels] = useState<DimVModel[]>([]);
  const [regions, setRegions] = useState<DimRegion[]>([]);
  const [locations, setLocations] = useState<DimLocation[]>([]);
  const [routes, setRoutes] = useState<DimRoute[]>([]);
  const [dispatches, setDispatches] = useState<FactVehicleDispatch[]>([]);
  const [deliveries, setDeliveries] = useState<FactLogisticsVehicleDelivery[]>([]);
  const [transporters, setTransporters] = useState<FactTransporter[]>([]);
  const [transportationCosts, setTransportationCosts] = useState<
    FactTransportationCost[]
  >([]);
  const [exceptions, setExceptions] = useState<FactLogisticsException[]>([]);
  const [movements, setMovements] = useState<FactVehicleMovementHistory[]>([]);
  const [showDetails, setShowDetails] = useState(false);
  const [detailSearch, setDetailSearch] = useState("");
  const [columnFilters, setColumnFilters] = useState<{
    transporter: string[] | null;
    movementStatus: string[] | null;
    delivery: string[] | null;
  }>({ transporter: null, movementStatus: null, delivery: null });

  const DETAIL_PAGE_SIZE = 500;

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
        setRoutes(snapshot.routes);
        setDispatches(snapshot.dispatches);
        setDeliveries(snapshot.deliveries);
        setTransporters(snapshot.transporters);
        setTransportationCosts(snapshot.transportationCosts);
        setExceptions(snapshot.exceptions);
        setMovements(snapshot.movements);
      } catch (loadError) {
        console.error(loadError);
        setError(
          "Unable to load Logistics transportation data from Supabase.",
        );
      } finally {
        setLoading(false);
      }
    }

    void loadData();
  }, []);

  const maps = useMemo(
    () => ({
      vehicle: new Map(
        vehicles.map((vehicle) => [vehicle.vehicle_id, vehicle]),
      ),
      model: new Map(models.map((model) => [model.model_id, model])),
      region: new Map(regions.map((region) => [region.region_id, region])),
      location: new Map(
        locations.map((location) => [location.location_id, location]),
      ),
      route: new Map(routes.map((route) => [route.route_id, route])),
      transporter: new Map(
        transporters.map((transporter) => [
          transporter.transporter_id,
          transporter,
        ]),
      ),
      delivery: new Map(
        deliveries.map((delivery) => [delivery.dispatch_id, delivery]),
      ),
    }),
    [vehicles, models, regions, locations, routes, transporters, deliveries],
  );

  const costByDispatch = useMemo(() => {
    const map = new Map<string, number>();

    for (const row of transportationCosts) {
      map.set(
        row.dispatch_id,
        (map.get(row.dispatch_id) ?? 0) +
          Number(row.transportation_cost || 0),
      );
    }

    return map;
  }, [transportationCosts]);

  const latestMovementByDispatch = useMemo(
    () => buildLatestMovementByDispatch(movements),
    [movements],
  );

  const enrichedDispatches = useMemo<EnrichedDispatch[]>(() => {
    return dispatches.map((dispatch) => {
      const vehicle = maps.vehicle.get(dispatch.vehicle_id);
      const model = vehicle
        ? maps.model.get(vehicle.model_id)
        : undefined;
      const origin = maps.location.get(dispatch.origin_location_id);
      const destination = maps.location.get(dispatch.destination_location_id);
      const region = destination
        ? maps.region.get(destination.region_id)
        : undefined;
      const transporter = maps.transporter.get(dispatch.transporter_id);
      const route = maps.route.get(dispatch.route_id);
      const delivery = maps.delivery.get(dispatch.dispatch_id);

      const transitDays = daysBetween(
        dispatch.dispatch_date_time,
        dispatch.arrival_date_time ?? delivery?.actual_delivery_date ?? null,
      );

      const isOnTime =
        delivery?.actual_delivery_date && delivery.planned_delivery_date
          ? dateOnly(delivery.actual_delivery_date) <=
            dateOnly(delivery.planned_delivery_date)
          : null;

      // "Delayed" uses the exact same definition as Page 2: the latest movement
      // record for this dispatch carries a Delayed status. It is NOT the same
      // as a late delivery, which is the separate isOnTime SLA measure.
      const movementStatus = resolveDispatchMovementStatus(
        dispatch.dispatch_id,
        dispatch.dispatch_status,
        latestMovementByDispatch,
      );

      const isDelayed = movementStatus === "Delayed";

      return {
        ...dispatch,
        vehicle,
        model,
        origin,
        destination,
        region,
        transporter,
        route,
        delivery,
        transitDays,
        isOnTime,
        movementStatus,
        isDelayed,
        cost: costByDispatch.get(dispatch.dispatch_id) ?? 0,
      };
    });
  }, [dispatches, maps, costByDispatch, latestMovementByDispatch]);

  const filteredDispatches = useMemo(() => {
    return enrichedDispatches.filter((row) => {
      if (!row.vehicle) return false;

      if (
        filters.startDate &&
        dateOnly(row.dispatch_date_time) < filters.startDate
      ) {
        return false;
      }

      if (
        filters.endDate &&
        dateOnly(row.dispatch_date_time) > filters.endDate
      ) {
        return false;
      }

      // Match Page 2: a dispatch belongs to a region when either its origin or
      // its destination sits there, so both pages filter the same population.
      if (
        filters.regionId &&
        row.origin?.region_id !== filters.regionId &&
        row.destination?.region_id !== filters.regionId
      ) {
        return false;
      }

      if (filters.modelId && row.model?.model_id !== filters.modelId) {
        return false;
      }

      if (
        matchingModelIds &&
        !matchingModelIds.includes(row.model?.model_id ?? "")
      ) {
        return false;
      }

      if (filters.variant && row.model?.variant !== filters.variant) {
        return false;
      }

      if (
        filters.vehicleType &&
        row.model?.vehicle_type !== filters.vehicleType
      ) {
        return false;
      }

      if (
        filters.locationId &&
        row.origin?.location_id !== filters.locationId &&
        row.destination?.location_id !== filters.locationId
      ) {
        return false;
      }

      if (
        filters.transporterId &&
        row.transporter_id !== filters.transporterId
      ) {
        return false;
      }

      if (filters.routeId && row.route_id !== filters.routeId) {
        return false;
      }

      return true;
    });
  }, [enrichedDispatches, filters, matchingModelIds]);

  const totalVehicles = useMemo(
    () => new Set(filteredDispatches.map((row) => row.vehicle_id)).size,
    [filteredDispatches],
  );

  const activeTransporters = useMemo(
    () =>
      new Set(
        filteredDispatches
          .filter(
            (row) =>
              (row.transporter?.status ?? "").toLowerCase() === "active",
          )
          .map((row) => row.transporter_id),
      ).size,
    [filteredDispatches],
  );

  const avgTransitDays = useMemo(() => {
    const values = filteredDispatches
      .map((row) => row.transitDays)
      .filter((value): value is number => value !== null && value >= 0);

    return values.length
      ? values.reduce((sum, value) => sum + value, 0) / values.length
      : 0;
  }, [filteredDispatches]);

  const transportationCost = useMemo(
    () =>
      filteredDispatches.reduce((sum, row) => sum + row.cost, 0),
    [filteredDispatches],
  );

  const transportationCostPerVehicle =
    totalVehicles > 0 ? transportationCost / totalVehicles : 0;

  const totalRouteKm = useMemo(
    () =>
      filteredDispatches.reduce(
        (sum, row) => sum + Number(row.route?.distance_km || 0),
        0,
      ),
    [filteredDispatches],
  );

  const avgRouteDistance =
    filteredDispatches.length > 0
      ? totalRouteKm / filteredDispatches.length
      : 0;

  const transportationCostPerKm =
    totalRouteKm > 0 ? transportationCost / totalRouteKm : 0;

  const delayedMovements = useMemo(
    () => filteredDispatches.filter((row) => row.isDelayed).length,
    [filteredDispatches],
  );

  const openExceptions = useMemo(() => {
    const dispatchIds = new Set(
      filteredDispatches.map((row) => row.dispatch_id),
    );

    return exceptions.filter((exception) => {
      if (!dispatchIds.has(exception.dispatch_id)) return false;
      if (filters.locationId && exception.location_id !== filters.locationId) {
        return false;
      }
      if (exception.status.toLowerCase() === "resolved") return false;
      return true;
    }).length;
  }, [filteredDispatches, exceptions, filters.locationId]);

  // Every filtered dispatch contributes one raw metric row to each drill-down
  // tree; the axis labels are attached per hierarchy below.
  const drillRows = useMemo<Omit<MetricDrillRow, "labels">[]>(
    () =>
      filteredDispatches.map((row) => ({
        vehicles: 1,
        onTimeCount: row.isOnTime === true ? 1 : 0,
        onTimeEvaluated: row.isOnTime === null ? 0 : 1,
        transitTotal: row.transitDays ?? 0,
        transitCount: row.transitDays === null ? 0 : 1,
        delayCount: row.isDelayed ? 1 : 0,
        cost: row.cost,
        km: Number(row.route?.distance_km || 0),
      })),
    [filteredDispatches],
  );

  // Transporter → Region → Route
  const transporterHierarchy = useMemo(
    () =>
      buildMetricHierarchy(
        filteredDispatches.map((row, index) => ({
          ...drillRows[index],
          labels: [
            row.transporter?.transporter_name ??
              row.transporter_id ??
              "Unknown Transporter",
            row.region?.region_name ?? "Unknown Region",
            routeLabelFor(row),
          ],
        })),
      ),
    [filteredDispatches, drillRows],
  );

  const drillResetKey = JSON.stringify(filters);

  const monthlyCostData = useMemo(() => {
    const monthly = new Map<string, number>();
    MONTH_ORDER.forEach((month) => monthly.set(month, 0));

    const filteredDispatchIds = new Set(
      filteredDispatches.map((row) => row.dispatch_id),
    );

    for (const row of transportationCosts) {
      if (!filteredDispatchIds.has(row.dispatch_id)) continue;

      const month = monthLabel(row.cost_date);
      if (monthly.has(month)) {
        monthly.set(
          month,
          (monthly.get(month) ?? 0) +
            Number(row.transportation_cost || 0),
        );
      }
    }

    // Always render the full Jan-Dec axis. Months with no recorded spend show
    // as zero rather than being dropped from the domain.
    return MONTH_ORDER.map(
      (month) => ({
        category: month,
        series: [
          {
            name: "Transportation Cost",
            value: monthly.get(month) ?? 0,
          },
        ],
      }),
    );
  }, [filteredDispatches, transportationCosts]);

  // Financial view of the transporter drill-down: cost per transporter.
  const transporterCostComparison = useMemo(() => {
    const grouped = new Map<
      string,
      { vehicles: number; cost: number; km: number }
    >();

    for (const row of filteredDispatches) {
      const label =
        row.transporter?.transporter_name ?? row.transporter_id ?? "Unknown";
      const current = grouped.get(label) ?? { vehicles: 0, cost: 0, km: 0 };
      current.vehicles += 1;
      current.cost += row.cost;
      current.km += Number(row.route?.distance_km || 0);
      grouped.set(label, current);
    }

    return [...grouped.entries()]
      .map(([label, item]) => ({
        label,
        value: item.cost,
        secondaryLabel:
          item.vehicles > 0
            ? `₹${formatNumber(Math.round(item.cost / item.vehicles))}/vehicle • ${
                item.km > 0 ? `₹${(item.cost / item.km).toFixed(2)}` : "—"
              }/km`
            : undefined,
      }))
      .sort((a, b) => b.value - a.value);
  }, [filteredDispatches]);

  const detailRows = useMemo(
    () =>
      filteredDispatches
        .map((row) => ({
          id: row.dispatch_id,
          transporter:
            row.transporter?.transporter_name ?? row.transporter_id,
          region: row.region?.region_name ?? "Unknown",
          route: row.route
            ? `${row.origin?.location_name ?? row.route.origin_location_id} → ${
                row.destination?.location_name ??
                row.route.destination_location_id
              }`
            : row.route_id,
          vehicles: 1,
          avgTransit: row.transitDays,
          movementStatus: row.movementStatus,
          lateDelivery: row.isOnTime === false,
          delivery:
            row.isOnTime === false
              ? "Delivered Late"
              : row.isOnTime === true
                ? "On-time"
                : "Not completed",
          cost: row.cost,
          costPerKm:
            Number(row.route?.distance_km || 0) > 0
              ? row.cost / Number(row.route?.distance_km)
              : null,
        }))
        .sort((a, b) => b.cost - a.cost),
    [filteredDispatches],
  );

  // Filter options come from the globally-filtered rows so every available
  // value stays reachable regardless of the other column filters.
  const detailOptions = useMemo(
    () => ({
      transporter: [...new Set(detailRows.map((row) => row.transporter))].sort(
        (a, b) => a.localeCompare(b),
      ),
      movementStatus: [
        ...new Set(detailRows.map((row) => row.movementStatus)),
      ].sort((a, b) => a.localeCompare(b)),
      delivery: [...new Set(detailRows.map((row) => row.delivery))].sort(
        (a, b) => a.localeCompare(b),
      ),
    }),
    [detailRows],
  );

  // Order: global filters (already applied in detailRows) -> column filters ->
  // search box. The page limit is applied last, after everything above.
  const columnFilteredRows = useMemo(() => {
    const matches = (values: string[] | null, value: string) =>
      values === null || values.includes(value);

    return detailRows.filter(
      (row) =>
        matches(columnFilters.transporter, row.transporter) &&
        matches(columnFilters.movementStatus, row.movementStatus) &&
        matches(columnFilters.delivery, row.delivery),
    );
  }, [detailRows, columnFilters]);

  const visibleDetailRows = useMemo(() => {
    const query = detailSearch.trim().toLowerCase();
    if (!query) return columnFilteredRows;
    return columnFilteredRows.filter((row) =>
      [
        row.transporter,
        row.region,
        row.route,
        row.movementStatus,
        row.delivery,
      ]
        .join(" ")
        .toLowerCase()
        .includes(query),
    );
  }, [columnFilteredRows, detailSearch]);

  const totalDetailPages = Math.max(
    1,
    Math.ceil(visibleDetailRows.length / DETAIL_PAGE_SIZE),
  );

  // Narrowing the result set returns to page 1. Adjusting state during render
  // avoids the cascading re-render an effect would cause.
  const pageResetKey = JSON.stringify([columnFilters, detailSearch]);
  const [pageState, setPageState] = useState<{ key: string; page: number }>({
    key: pageResetKey,
    page: 1,
  });
  if (pageState.key !== pageResetKey) {
    setPageState({ key: pageResetKey, page: 1 });
  }

  const safeDetailPage = Math.min(
    pageState.key === pageResetKey ? pageState.page : 1,
    totalDetailPages,
  );

  const setDetailPage = (updater: (page: number) => number): void =>
    setPageState((current) => ({
      ...current,
      page: Math.max(1, Math.min(totalDetailPages, updater(current.page))),
    }));

  const paginatedDetailRows = useMemo(
    () =>
      visibleDetailRows.slice(
        (safeDetailPage - 1) * DETAIL_PAGE_SIZE,
        safeDetailPage * DETAIL_PAGE_SIZE,
      ),
    [visibleDetailRows, safeDetailPage],
  );

  const activeColumnFilterCount =
    (columnFilters.transporter?.length ? 1 : 0) +
    (columnFilters.movementStatus?.length ? 1 : 0) +
    (columnFilters.delivery?.length ? 1 : 0);

  return (
    <DashboardLayout activePage={activePage} onPageChange={onPageChange}>
      {!showDetails && (
        <>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-200/90 bg-white p-5 shadow-xs">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-xl font-bold tracking-tight text-slate-900">
              Transportation &amp; Movement
            </h1>
            <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-800">
              Page 3
            </span>
          </div>

          <p className="mt-1 text-xs text-slate-500">
            Monitor transporter performance, route efficiency, transportation
            spend, transit time, and movement performance across the logistics
            network.
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
          title="Active Transporters"
          value={formatNumber(activeTransporters)}
          subtext="Active partners in filtered movements"
          tooltip="Distinct active transporters associated with filtered dispatches"
          accentColor="indigo"
          loading={loading}
        />
        <KPICard
          title="Average Transit Time"
          value={`${avgTransitDays.toFixed(1)}d`}
          subtext="Dispatch to arrival / delivery"
          tooltip="Average elapsed time from dispatch to arrival or actual delivery"
          accentColor="blue"
          loading={loading}
        />
        <KPICard
          title="Transportation Cost"
          value={`₹${formatNumber(Math.round(transportationCost))}`}
          subtext="Filtered transportation spend"
          tooltip="Sum of transportation cost linked to the filtered dispatches"
          accentColor="emerald"
          loading={loading}
        />
        <KPICard
          title="Cost per Vehicle"
          value={`₹${formatNumber(Math.round(transportationCostPerVehicle))}`}
          subtext="Cost / distinct vehicle"
          tooltip="Transportation cost divided by distinct vehicles transported"
          accentColor="amber"
          loading={loading}
        />
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3.5 md:grid-cols-4">
        <KPICard
          title="Cost per KM"
          value={`₹${transportationCostPerKm.toFixed(2)}`}
          subtext="Cost / route KM"
          tooltip="Transportation cost divided by the route distance across filtered dispatches"
          accentColor="violet"
          loading={loading}
        />
        <KPICard
          title="Avg Route Distance"
          value={`${avgRouteDistance.toFixed(0)} km`}
          subtext="Per dispatch"
          tooltip="Average planned route distance across filtered dispatches"
          accentColor="cyan"
          loading={loading}
        />
        <KPICard
          title="Delayed Movements"
          value={formatNumber(delayedMovements)}
          subtext={`of ${formatNumber(filteredDispatches.length)} dispatches`}
          tooltip="Filtered dispatches whose latest movement record carries a Delayed status. Identical definition and population to the Delayed count on the Dispatch & Delivery page."
          accentColor="rose"
          loading={loading}
        />
        <KPICard
          title="Open Operational Issues"
          value={formatNumber(openExceptions)}
          subtext="Unresolved dispatch exceptions"
          tooltip="Exceptions linked to the filtered dispatches whose status is not Resolved"
          accentColor="amber"
          loading={loading}
        />
      </div>

      {/* Row 1: Transporter Performance + Transportation Cost Comparison (entry to details) */}
      <div className="mb-5 grid grid-cols-1 items-stretch gap-5 xl:grid-cols-2">
        <ChartCard
          title="Transporter Performance"
          subtitle="Transporter → Region → Route • Vehicles, On-Time %, Avg Transit, Delayed %, Cost"
          badge="Interactive Drill-down"
          height={385}
        >
          <MetricDrilldownChart
            hierarchy={transporterHierarchy}
            levels={TRANSPORTER_LEVELS}
            resetKey={drillResetKey}
            barClassName="bg-indigo-500"
          />
        </ChartCard>

        <ChartCard
          title="Transportation Cost Comparison"
          subtitle="Total spend, cost per vehicle, and cost per km by transporter"
          height={385}
          action={
            <button
              type="button"
              onClick={() => {
                setShowDetails(true);
                setDetailSearch("");
                setDetailPage(() => 1);
              }}
              aria-label="Open transportation details"
              title="Open transportation details"
              className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-lg font-semibold text-slate-700 transition hover:bg-blue-50 hover:text-blue-700"
            >
              →
            </button>
          }
        >
          <div className="h-[310px] overflow-y-auto pr-1">
            {transporterCostComparison.length === 0 ? (
              <div className="flex h-full items-center justify-center text-xs text-slate-400">
                No transporter cost data matches the current filters.
              </div>
            ) : (
              <HorizontalBarChart
                data={transporterCostComparison}
                valueFormatter={(value) => `₹${formatNumber(Math.round(value))}`}
                showRank={false}
                barColor="bg-indigo-500"
              />
            )}
          </div>
        </ChartCard>
      </div>

      {/* Row 2: full-width Transportation Cost Trend */}
      <div className="grid grid-cols-1 gap-5">
        <ChartCard
          title="Transportation Cost Trend"
          subtitle="Monthly transportation spend for the filtered movement set, Jan to Dec"
          height={320}
        >
          <ClusteredColumnChart
            data={monthlyCostData}
            valueFormatter={(value) => `₹${formatNumber(Math.round(value))}`}
            height={245}
            showLegend={false}
          />
        </ChartCard>
      </div>
    </>
      )}

      {showDetails && (
        <div>
          <div className="mb-5 rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <div className="flex items-center gap-2.5">
                  <button
                    type="button"
                    onClick={() => setShowDetails(false)}
                    className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                  >
                    ← Back to Overview
                  </button>
                  <span className="h-5 w-px bg-slate-200" />
                  <h2 className="text-xl font-bold tracking-tight text-slate-900">
                    Transportation Details
                  </h2>
                  <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-800">
                    Operational Details
                  </span>
                </div>
                <p className="mt-2 text-xs text-slate-500">
                  Record-level transportation data based on the global filters
                  selected in the left panel.
                </p>
              </div>

              <span className="rounded-full border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700">
                {formatNumber(visibleDetailRows.length)} Matching Records
              </span>
            </div>
          </div>

          <ChartCard
            title="Transportation Records"
            subtitle="Use search to narrow the operational record list"
          >
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <input
                type="search"
                value={detailSearch}
                onChange={(event) => setDetailSearch(event.target.value)}
                placeholder="Search Transporter, Region, Route, Status..."
                className="w-full max-w-md rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
              />
              <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
                <span>
                  Showing{" "}
                  <span className="font-semibold tabular-nums text-slate-800">
                    {visibleDetailRows.length === 0
                      ? 0
                      : (safeDetailPage - 1) * DETAIL_PAGE_SIZE + 1}
                  </span>{" "}
                  to{" "}
                  <span className="font-semibold tabular-nums text-slate-800">
                    {Math.min(
                      safeDetailPage * DETAIL_PAGE_SIZE,
                      visibleDetailRows.length,
                    )}
                  </span>{" "}
                  of{" "}
                  <span className="font-semibold tabular-nums text-slate-800">
                    {formatNumber(visibleDetailRows.length)}
                  </span>{" "}
                  matching records
                </span>

                {activeColumnFilterCount > 0 && (
                  <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-blue-700">
                    {activeColumnFilterCount} column filter
                    {activeColumnFilterCount > 1 ? "s" : ""} active
                  </span>
                )}

                {totalDetailPages > 1 && (
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() =>
                        setDetailPage((page) => Math.max(1, page - 1))
                      }
                      disabled={safeDetailPage <= 1}
                      className="rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 shadow-2xs transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Previous
                    </button>
                    <span className="px-2 text-xs font-semibold text-slate-700">
                      Page {safeDetailPage} of {totalDetailPages}
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        setDetailPage((page) =>
                          Math.min(totalDetailPages, page + 1),
                        )
                      }
                      disabled={safeDetailPage >= totalDetailPages}
                      className="rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 shadow-2xs transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Next
                    </button>
                  </div>
                )}
              </div>
            </div>

            <div className="max-h-[520px] overflow-auto rounded-lg border border-slate-200">
              <table className="w-full min-w-[1120px] text-left text-xs">
                <thead className="sticky top-0 bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-3 py-3">
                      <span className="whitespace-nowrap">
                        Transporter
                        <ColumnFilterMenu
                          label="Transporter"
                          options={detailOptions.transporter}
                          selected={columnFilters.transporter}
                          onChange={(next) =>
                            setColumnFilters((current) => ({
                              ...current,
                              transporter: next,
                            }))
                          }
                        />
                      </span>
                    </th>
                    <th className="px-3 py-3">Region</th>
                    <th className="px-3 py-3">Route</th>
                    <th className="px-3 py-3">Vehicles</th>
                    <th className="px-3 py-3">Transit</th>
                    <th className="px-3 py-3">
                      <span className="whitespace-nowrap">
                        Movement Status
                        <ColumnFilterMenu
                          label="Movement Status"
                          options={detailOptions.movementStatus}
                          selected={columnFilters.movementStatus}
                          onChange={(next) =>
                            setColumnFilters((current) => ({
                              ...current,
                              movementStatus: next,
                            }))
                          }
                        />
                      </span>
                    </th>
                    <th className="px-3 py-3">
                      <span className="whitespace-nowrap">
                        Delivery
                        <ColumnFilterMenu
                          label="Delivery"
                          options={detailOptions.delivery}
                          selected={columnFilters.delivery}
                          onChange={(next) =>
                            setColumnFilters((current) => ({
                              ...current,
                              delivery: next,
                            }))
                          }
                        />
                      </span>
                    </th>
                    <th className="px-3 py-3">Cost</th>
                    <th className="px-3 py-3">Cost / KM</th>
                  </tr>
                </thead>

                <tbody className="divide-y divide-slate-100">
                  {visibleDetailRows.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="py-12 text-center text-xs text-slate-400">
                        No dispatch records match the current search.
                      </td>
                    </tr>
                  ) : (
                    paginatedDetailRows.map((row) => (
                      <tr key={row.id} className="hover:bg-slate-50">
                        <td className="px-3 py-2 font-medium text-slate-700">
                          {row.transporter}
                        </td>
                        <td className="px-3 py-2 text-slate-600">{row.region}</td>
                        <td
                          className="max-w-[260px] truncate px-3 py-2 text-slate-600"
                          title={row.route}
                        >
                          {row.route}
                        </td>
                        <td className="px-3 py-2 text-slate-600">{row.vehicles}</td>
                        <td className="px-3 py-2 text-slate-600">
                          {row.avgTransit === null ? "—" : `${row.avgTransit.toFixed(1)}d`}
                        </td>
                        <td className="px-3 py-2 text-slate-600">
                          {row.movementStatus}
                        </td>
                        <td className="px-3 py-2 text-slate-600">{row.delivery}</td>
                        <td className="px-3 py-2 text-slate-600">
                          ₹{formatNumber(Math.round(row.cost))}
                        </td>
                        <td className="px-3 py-2 text-slate-600">
                          {row.costPerKm === null ? "—" : `₹${row.costPerKm.toFixed(2)}`}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </ChartCard>
        </div>
      )}
    </DashboardLayout>
  );
}
