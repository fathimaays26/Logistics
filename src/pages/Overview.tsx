import { useEffect, useMemo, useState } from "react";
import DashboardLayout from "../component/DashboardLayout";
import KPICard from "../component/KpiCard";
import ChartCard from "../component/ChartCard";
import type { DashboardPage } from "../component/Header";
import { useFilters } from "../context/FilterContext";
import { formatNumber, formatPercent, formatCurrency } from "../format";
import { loadDatabaseSnapshot } from "../dataService";
import ClusteredColumnChart from "../component/charts/ClusteredColumnChart";
import CrossDimensionMatrixChart, {
  type CrossDimensionFact,
} from "../component/charts/CrossDimensionMatrixChart";
import type {
  DatabaseSnapshot,
  FactLogisticsVehicleDelivery,
} from "../dataService";

const HOURS_PER_DAY = 24;

// Vehicle movement statuses are standardized for display only. The underlying
// fact_vehicle_movement_history.status values are left untouched.
const MOVEMENT_STATUS_LABELS: Record<string, string> = {
  arrived: "Delivered",
  departed: "Dispatched",
  delayed: "Delayed",
};

const MOVEMENT_STATUS_COLORS: Record<string, string> = {
  Delivered: "bg-emerald-500",
  Dispatched: "bg-blue-600",
  Delayed: "bg-rose-500",
};

const MOVEMENT_STATUS_ORDER: Record<string, number> = {
  Delivered: 0,
  Dispatched: 1,
  Delayed: 2,
};

function movementStatusLabel(status: string): string {
  const key = (status ?? "").trim();
  return MOVEMENT_STATUS_LABELS[key.toLowerCase()] ?? key ?? "Unknown";
}

function toNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function dateOnly(value: string | null | undefined): string {
  return value ? value.slice(0, 10) : "";
}

function formatDisplayDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "—";
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return dateStr.slice(0, 10) || "—";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(d);
}

export type DelayStatusCategory =
  | "On-time"
  | "Delivered Late"
  | "Currently Delayed"
  | "Pending";

export function classifyDelivery(delivery: FactLogisticsVehicleDelivery): {
  category: DelayStatusCategory;
  delayDays: number | null;
  delayText: string;
} {
  // Date-based classification (frontend only; delivery_status is NOT trusted):
  // - Currently Delayed: actual IS NULL AND planned < today
  // - Delivered Late:    actual IS NOT NULL AND actual > planned
  // - Pending:           actual IS NULL AND planned >= today
  // - On-Time:           actual IS NOT NULL AND actual <= planned
  const actualDate = dateOnly(delivery.actual_delivery_date);
  const plannedDate = dateOnly(delivery.planned_delivery_date);

  const now = new Date();
  const todayDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

  const dayMs = 1000 * 60 * 60 * 24;

  // Delivered: actual_delivery_date IS NOT NULL
  if (actualDate) {
    if (plannedDate && actualDate > plannedDate) {
      // Delivered Late: actual_delivery_date > planned_delivery_date
      const days = Math.max(
        1,
        Math.round(
          (new Date(actualDate).getTime() - new Date(plannedDate).getTime()) /
            dayMs,
        ),
      );
      return {
        category: "Delivered Late",
        delayDays: days,
        delayText: `${days} d`,
      };
    }

    // On-Time: actual <= planned (or no planned date to breach)
    return {
      category: "On-time",
      delayDays: 0,
      delayText: "0 d",
    };
  }

  // Not delivered: actual_delivery_date IS NULL
  if (plannedDate && plannedDate < todayDate) {
    // Currently Delayed: planned_delivery_date < today
    const days = Math.max(
      1,
      Math.round(
        (new Date(todayDate).getTime() - new Date(plannedDate).getTime()) /
          dayMs,
      ),
    );
    return {
      category: "Currently Delayed",
      delayDays: days,
      delayText: `${days} d`,
    };
  }

  // Pending: planned_delivery_date >= today (or no planned date yet)
  return {
    category: "Pending",
    delayDays: null,
    delayText: "—",
  };
}

/**
 * A vehicle can appear in several delivery records (re-dispatches, partial
 * consignments, corrections). Every delivery metric on Page 1 is therefore
 * resolved to exactly one "final" record per vehicle so that the KPIs, the
 * delay chart, the cross-dimensional matrix and the detail table all share the
 * same grain and reconcile with each other.
 *
 * Resolution rules:
 * - A vehicle with at least one completed delivery is represented by its LATEST
 *   COMPLETED delivery. That record is classified On-time or Delivered Late, so
 *   `onTime + deliveredLate === vehiclesDelivered` always holds.
 * - A vehicle with no completed delivery is represented by its LATEST record and
 *   classified Currently Delayed or Pending.
 * The four buckets are mutually exclusive and cover every vehicle that has a
 * delivery record under the active filters.
 */
type VehicleDeliveryOutcome = {
  vehicleId: string;
  delivery: FactLogisticsVehicleDelivery;
  category: DelayStatusCategory;
  delayDays: number | null;
  delayText: string;
  isDelivered: boolean;
  tatHours: number | null;
};

function deliverySortKey(delivery: FactLogisticsVehicleDelivery): string {
  return (
    dateOnly(delivery.actual_delivery_date) ||
    dateOnly(delivery.planned_delivery_date) ||
    ""
  );
}

export default function Overview({
  activePage,
  onPageChange,
}: {
  activePage: DashboardPage;
  onPageChange: (page: DashboardPage) => void;
}) {
  const [loading, setLoading] = useState(true);
  const [snapshot, setSnapshot] = useState<DatabaseSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);

  // View state: inline drill down for Delay Overview
  const [viewMode, setViewMode] = useState<"overview" | "delayDetails">(
    "overview",
  );
  const [detailStatus, setDetailStatus] = useState<
    "All" | "Currently Delayed" | "Delivered Late" | "Pending"
  >("Currently Delayed");
  const [searchQuery, setSearchQuery] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 50;

  const { filters } = useFilters();

  useEffect(() => {
    async function loadData() {
      setLoading(true);
      setError(null);

      try {
        const data = await loadDatabaseSnapshot();
        setSnapshot(data);
      } catch (loadError) {
        console.error(loadError);
        setError("Unable to load Logistics data from Supabase.");
      } finally {
        setLoading(false);
      }
    }

    void loadData();
  }, []);

  const vehicles = snapshot?.vehicles ?? [];
  const models = snapshot?.models ?? [];
  const regions = snapshot?.regions ?? [];
  const locations = snapshot?.locations ?? [];
  const dispatches = snapshot?.dispatches ?? [];
  const deliveries = snapshot?.deliveries ?? [];
  const movements = snapshot?.movements ?? [];
  const transporters = snapshot?.transporters ?? [];
  const exceptions = snapshot?.exceptions ?? [];
  const inventory = snapshot?.vehicleInventory ?? [];
  const costs = snapshot?.transportationCosts ?? [];
  const routes = snapshot?.routes ?? [];

  const filtered = useMemo(() => {
    const modelMap = new Map(models.map((item) => [item.model_id, item]));
    const vehicleMap = new Map(vehicles.map((item) => [item.vehicle_id, item]));
    const locationMap = new Map(
      locations.map((item) => [item.location_id, item]),
    );
    const transporterMap = new Map(
      transporters.map((item) => [item.transporter_id, item]),
    );
    const routeMap = new Map(routes.map((item) => [item.route_id, item]));
    const dispatchMap = new Map(
      dispatches.map((item) => [item.dispatch_id, item]),
    );

    const dateInRange = (value: string | null | undefined) => {
      const date = dateOnly(value);
      if (!date) return true;
      if (filters.startDate && date < filters.startDate) return false;
      if (filters.endDate && date > filters.endDate) return false;
      return true;
    };

    const allowedVehicle = (vehicleId: string) => {
      const vehicle = vehicleMap.get(vehicleId);
      if (!vehicle) return false;

      const model = modelMap.get(vehicle.model_id);
      const location = locationMap.get(vehicle.location_id);

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

      return true;
    };

    let filteredDispatches = dispatches.filter((dispatch) => {
      if (!dateInRange(dispatch.dispatch_date_time)) return false;
      if (!allowedVehicle(dispatch.vehicle_id)) return false;

      if (
        filters.transporterId &&
        dispatch.transporter_id !== filters.transporterId
      ) {
        return false;
      }

      if (filters.routeId && dispatch.route_id !== filters.routeId) {
        return false;
      }

      const originRegion = locationMap.get(
        dispatch.origin_location_id,
      )?.region_id;
      const destinationRegion = locationMap.get(
        dispatch.destination_location_id,
      )?.region_id;

      if (
        filters.regionId &&
        originRegion !== filters.regionId &&
        destinationRegion !== filters.regionId
      ) {
        return false;
      }

      return true;
    });

    if (filters.inventoryStatus) {
      const allowedInventoryVehicleIds = new Set(
        inventory
          .filter((row) => row.inventory_status === filters.inventoryStatus)
          .map((row) => row.vehicle_id),
      );

      filteredDispatches = filteredDispatches.filter((dispatch) =>
        allowedInventoryVehicleIds.has(dispatch.vehicle_id),
      );
    }

    const dispatchIds = new Set(
      filteredDispatches.map((item) => item.dispatch_id),
    );
    const vehicleIds = new Set(
      filteredDispatches.map((item) => item.vehicle_id),
    );

    let filteredDeliveries = deliveries.filter((delivery) => {
      if (!dispatchIds.has(delivery.dispatch_id)) return false;

      if (
        filters.deliveryStatus &&
        delivery.delivery_status !== filters.deliveryStatus
      ) {
        return false;
      }

      return true;
    });

    // If a delivery-status filter is active, retain only dispatches connected
    // to deliveries having that status.
    if (filters.deliveryStatus) {
      const allowedDispatchIds = new Set(
        filteredDeliveries.map((delivery) => delivery.dispatch_id),
      );
      filteredDispatches = filteredDispatches.filter((dispatch) =>
        allowedDispatchIds.has(dispatch.dispatch_id),
      );
    }

    const filteredDispatchIdSet = new Set(
      filteredDispatches.map((item) => item.dispatch_id),
    );

    filteredDeliveries = filteredDeliveries.filter((delivery) =>
      filteredDispatchIdSet.has(delivery.dispatch_id),
    );

    let filteredMovements = movements.filter((movement) => {
      if (!vehicleIds.has(movement.vehicle_id)) return false;
      if (!filteredDispatchIdSet.has(movement.dispatch_id)) return false;
      if (!dateInRange(movement.status_date_time)) return false;

      if (filters.locationId && movement.location_id !== filters.locationId) {
        return false;
      }

      return true;
    });

    if (filters.locationId) {
      const locationVehicleIds = new Set(
        filteredMovements.map((movement) => movement.vehicle_id),
      );
      filteredDispatches = filteredDispatches.filter((dispatch) =>
        locationVehicleIds.has(dispatch.vehicle_id),
      );
    }

    const filteredVehicleIds = new Set(
      filteredDispatches.map((dispatch) => dispatch.vehicle_id),
    );

    filteredMovements = filteredMovements.filter((movement) =>
      filteredVehicleIds.has(movement.vehicle_id),
    );

    const filteredExceptions = exceptions.filter((exception) => {
      if (!filteredVehicleIds.has(exception.vehicle_id)) return false;
      if (!dateInRange(exception.exception_date)) return false;

      if (filters.locationId && exception.location_id !== filters.locationId) {
        return false;
      }

      if (
        filters.transporterId &&
        !filteredDispatchIdSet.has(exception.dispatch_id)
      ) {
        return false;
      }

      return true;
    });

    return {
      dispatches: filteredDispatches,
      deliveries: filteredDeliveries,
      movements: filteredMovements,
      exceptions: filteredExceptions,
      modelMap,
      vehicleMap,
      locationMap,
      transporterMap,
      routeMap,
      dispatchMap,
    };
  }, [
    dispatches,
    deliveries,
    movements,
    exceptions,
    vehicles,
    models,
    locations,
    transporters,
    routes,
    inventory,
    filters,
  ]);

  // One outcome per unique vehicle: the latest completed delivery when the
  // vehicle has one, otherwise its latest open record.
  const vehicleOutcomes = useMemo<VehicleDeliveryOutcome[]>(() => {
    const byVehicle = new Map<
      string,
      FactLogisticsVehicleDelivery[]
    >();

    for (const delivery of filtered.deliveries) {
      const records = byVehicle.get(delivery.vehicle_id);
      if (records) records.push(delivery);
      else byVehicle.set(delivery.vehicle_id, [delivery]);
    }

    const latestFirst = (
      a: FactLogisticsVehicleDelivery,
      b: FactLogisticsVehicleDelivery,
    ) => {
      const keyA = deliverySortKey(a);
      const keyB = deliverySortKey(b);
      if (keyA !== keyB) return keyA < keyB ? 1 : -1;
      // Stable, deterministic tie-break when two records share a date.
      return a.delivery_id < b.delivery_id ? 1 : -1;
    };

    const outcomes: VehicleDeliveryOutcome[] = [];

    for (const [vehicleId, records] of byVehicle) {
      const completed = records.filter(
        (record) => Boolean(record.actual_delivery_date),
      );
      const source = completed.length > 0 ? completed : records;
      const delivery = [...source].sort(latestFirst)[0];

      const classified = classifyDelivery(delivery);
      const dispatch = filtered.dispatchMap.get(delivery.dispatch_id);

      let tatHours: number | null = null;
      if (dispatch?.dispatch_date_time && delivery.actual_delivery_date) {
        const start = new Date(dispatch.dispatch_date_time).getTime();
        const end = new Date(delivery.actual_delivery_date).getTime();
        if (
          Number.isFinite(start) &&
          Number.isFinite(end) &&
          end >= start
        ) {
          tatHours = (end - start) / 36e5;
        }
      }

      outcomes.push({
        vehicleId,
        delivery,
        category: classified.category,
        delayDays: classified.delayDays,
        delayText: classified.delayText,
        isDelivered: classified.category === "On-time" ||
          classified.category === "Delivered Late",
        tatHours,
      });
    }

    return outcomes;
  }, [filtered]);

  const metrics = useMemo(() => {
    const { dispatches: filteredDispatches, deliveries: filteredDeliveries } =
      filtered;

    const totalVehiclesDispatched = new Set(
      filteredDispatches.map((item) => item.vehicle_id),
    ).size;

    // Classify unique vehicles by their final delivery outcome.
    const onTimeCount = vehicleOutcomes.filter(
      (outcome) => outcome.category === "On-time",
    ).length;
    const deliveredLateCount = vehicleOutcomes.filter(
      (outcome) => outcome.category === "Delivered Late",
    ).length;
    const currentlyDelayedCount = vehicleOutcomes.filter(
      (outcome) => outcome.category === "Currently Delayed",
    ).length;
    const pendingCount = vehicleOutcomes.filter(
      (outcome) => outcome.category === "Pending",
    ).length;

    // Vehicles Delivered counts unique vehicles whose final delivery completed,
    // which is exactly onTimeCount + deliveredLateCount.
    const vehiclesDelivered = onTimeCount + deliveredLateCount;

    const onTimeRate =
      vehiclesDelivered > 0 ? (onTimeCount / vehiclesDelivered) * 100 : 0;

    // Delivery TAT: actual delivery timestamp - dispatch timestamp (in hours),
    // measured on the same final delivery used for the on-time classification.
    const deliveryTatValues = vehicleOutcomes
      .map((outcome) => outcome.tatHours)
      .filter((value): value is number => value !== null);

    const avgDeliveryTat =
      deliveryTatValues.length > 0
        ? deliveryTatValues.reduce((sum, value) => sum + value, 0) /
          deliveryTatValues.length
        : 0;

    const filteredDispatchIds = new Set(
      filteredDispatches.map((dispatch) => dispatch.dispatch_id),
    );

    const transportationCost = costs
      .filter((row) => filteredDispatchIds.has(row.dispatch_id))
      .filter((row) => {
        const date = dateOnly(row.cost_date);
        if (filters.startDate && date < filters.startDate) return false;
        if (filters.endDate && date > filters.endDate) return false;
        return true;
      })
      .reduce((sum, row) => sum + toNumber(row.transportation_cost), 0);

    const openExceptions = filtered.exceptions.filter(
      (item) => item.status.toLowerCase() !== "resolved",
    ).length;

    const movementMap = new Map<string, number>();
    for (const movement of filtered.movements) {
      const status = movementStatusLabel(movement.status || "Unknown");
      movementMap.set(status, (movementMap.get(status) ?? 0) + 1);
    }

    const movementData = [...movementMap.entries()]
      .sort((a, b) => {
        const orderA = MOVEMENT_STATUS_ORDER[a[0]] ?? 99;
        const orderB = MOVEMENT_STATUS_ORDER[b[0]] ?? 99;
        if (orderA !== orderB) return orderA - orderB;
        return b[1] - a[1];
      })
      .map(([label, value]) => ({
        label,
        value,
        secondaryLabel: `${((value / Math.max(filtered.movements.length, 1)) * 100).toFixed(1)}%`,
        color: MOVEMENT_STATUS_COLORS[label] ?? "bg-slate-500",
      }));

    // Updated 4-bucket Delay Overview Chart
    const delayData = [
      {
        category: "On-time",
        series: [
          { name: "Vehicles", value: onTimeCount, color: "bg-emerald-500" },
        ],
      },
      {
        category: "Delivered Late",
        series: [
          {
            name: "Vehicles",
            value: deliveredLateCount,
            color: "bg-amber-500",
          },
        ],
      },
      {
        category: "Currently Delayed",
        series: [
          {
            name: "Vehicles",
            value: currentlyDelayedCount,
            color: "bg-rose-500",
          },
        ],
      },
      {
        category: "Pending",
        series: [
          { name: "Vehicles", value: pendingCount, color: "bg-slate-400" },
        ],
      },
    ];

    return {
      totalVehiclesDispatched,
      vehiclesDelivered,
      onTimeRate,
      avgDeliveryTat,
      avgDeliveryTatDays: avgDeliveryTat / HOURS_PER_DAY,
      pendingDeliveries: pendingCount,
      currentlyDelayed: currentlyDelayedCount,
      deliveredLateCount,
      onTimeCount,
      allVehiclesWithDeliveries: vehicleOutcomes.length,
      deliveryRecordsCount: filteredDeliveries.length,
      transportationCost,
      openExceptions,
      movementData,
      delayData,
    };
  }, [filtered, costs, filters, vehicleOutcomes]);

  // Cross-dimensional delivery facts: one row per unique vehicle, on the same
  // final delivery used by the KPIs and the delay chart, resolved against the
  // existing dimensions so any dimension can be compared against any other.
  const deliveryFacts = useMemo<CrossDimensionFact[]>(() => {
    const regionMap = new Map(regions.map((item) => [item.region_id, item]));

    return vehicleOutcomes.map((outcome) => {
      const delivery = outcome.delivery;
      const vehicle = filtered.vehicleMap.get(delivery.vehicle_id);
      const model = vehicle
        ? filtered.modelMap.get(vehicle.model_id)
        : undefined;
      const dispatch = filtered.dispatchMap.get(delivery.dispatch_id);

      const destLoc = dispatch
        ? filtered.locationMap.get(dispatch.destination_location_id)
        : undefined;
      const origLoc = dispatch
        ? filtered.locationMap.get(dispatch.origin_location_id)
        : undefined;
      const vehLoc = vehicle
        ? filtered.locationMap.get(vehicle.location_id)
        : undefined;
      const loc = destLoc ?? origLoc ?? vehLoc;
      const region = loc ? regionMap.get(loc.region_id) : undefined;

      let tatDays: number | null = null;
      if (dispatch?.dispatch_date_time && delivery.actual_delivery_date) {
        const start = new Date(dispatch.dispatch_date_time).getTime();
        const end = new Date(delivery.actual_delivery_date).getTime();
        if (Number.isFinite(start) && Number.isFinite(end) && end >= start) {
          tatDays = (end - start) / 86_400_000;
        }
      }

      return {
        region: region?.region_name ?? loc?.region_id ?? "Unknown",
        vehicleType: model?.vehicle_type ?? "Unknown",
        model: model?.model_name ?? vehicle?.model_id ?? "Unknown",
        variant: model?.variant ?? "Unknown",
        delivered: outcome.isDelivered,
        onTime: outcome.category === "On-time",
        tatDays,
      };
    });
  }, [vehicleOutcomes, filtered, regions]);

  const regionNames = useMemo(
    () => regions.map((item) => item.region_name),
    [regions],
  );

  // Delay detail rows for the inline "Delivery Delay Details" view
  const delayDetailRows = useMemo(() => {
    const {
      vehicleMap,
      modelMap,
      locationMap,
      dispatchMap,
    } = filtered;
    const transporterMap = new Map(
      transporters.map((item) => [item.transporter_id, item]),
    );
    const routeMap = new Map(routes.map((item) => [item.route_id, item]));
    const regionMap = new Map(regions.map((item) => [item.region_id, item]));

    const rows = vehicleOutcomes.map((outcome) => {
      const delivery = outcome.delivery;
      const vehicle = vehicleMap.get(delivery.vehicle_id);
      const model = vehicle ? modelMap.get(vehicle.model_id) : undefined;
      const dispatch = dispatchMap.get(delivery.dispatch_id);
      const transporter = dispatch
        ? transporterMap.get(dispatch.transporter_id)
        : undefined;
      const route = dispatch ? routeMap.get(dispatch.route_id) : undefined;

      const destLoc = dispatch
        ? locationMap.get(dispatch.destination_location_id)
        : undefined;
      const origLoc = dispatch
        ? locationMap.get(dispatch.origin_location_id)
        : undefined;
      const vehLoc = vehicle ? locationMap.get(vehicle.location_id) : undefined;
      const loc = destLoc ?? origLoc ?? vehLoc;
      const region = loc ? regionMap.get(loc.region_id) : undefined;

      const classification = {
        category: outcome.category,
        delayDays: outcome.delayDays,
        delayText: outcome.delayText,
      };

      const routeLabel = route
        ? `${locationMap.get(route.origin_location_id)?.location_name ?? route.origin_location_id} → ${locationMap.get(route.destination_location_id)?.location_name ?? route.destination_location_id}`
        : dispatch
          ? `${locationMap.get(dispatch.origin_location_id)?.location_name ?? dispatch.origin_location_id} → ${locationMap.get(dispatch.destination_location_id)?.location_name ?? dispatch.destination_location_id}`
          : "—";

      let statusBadgeClass = "bg-slate-100 text-slate-700 border-slate-200";
      let statusBadgeLabel: string = classification.category;

      if (classification.category === "Currently Delayed") {
        statusBadgeClass = "bg-rose-50 text-rose-700 border-rose-200";
      } else if (classification.category === "Delivered Late") {
        statusBadgeClass = "bg-amber-50 text-amber-700 border-amber-200";
      } else if (classification.category === "On-time") {
        statusBadgeClass = "bg-emerald-50 text-emerald-700 border-emerald-200";
      } else if (classification.category === "Pending") {
        statusBadgeClass = "bg-blue-50 text-blue-700 border-blue-200";
        statusBadgeLabel = "In Transit";
      }

      return {
        deliveryId: delivery.delivery_id,
        vehicleId: outcome.vehicleId,
        vin: vehicle?.vin || "—",
        region: region?.region_name ?? loc?.region_id ?? "Unknown",
        model: model?.model_name ?? vehicle?.model_id ?? "—",
        variant: model?.variant ?? "—",
        vehicleType: model?.vehicle_type ?? "—",
        transporter:
          transporter?.transporter_name ?? dispatch?.transporter_id ?? "—",
        route: routeLabel,
        plannedDelivery: delivery.planned_delivery_date,
        actualDelivery: delivery.actual_delivery_date,
        plannedDeliveryFormatted: formatDisplayDate(
          delivery.planned_delivery_date,
        ),
        actualDeliveryFormatted: formatDisplayDate(
          delivery.actual_delivery_date,
        ),
        delayDaysNumeric: classification.delayDays,
        delayText: classification.delayText,
        statusCategory: classification.category,
        statusBadgeClass,
        statusBadgeLabel,
      };
    });

    let result = rows;
    if (detailStatus !== "All") {
      result = result.filter((row) => row.statusCategory === detailStatus);
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      result = result.filter(
        (r) =>
          r.vehicleId.toLowerCase().includes(q) ||
          r.vin.toLowerCase().includes(q) ||
          r.model.toLowerCase().includes(q) ||
          r.transporter.toLowerCase().includes(q) ||
          r.route.toLowerCase().includes(q),
      );
    }

    // Sort currently delayed records by highest Delay Days first
    return result.sort((a, b) => {
      const aDelay = a.delayDaysNumeric ?? -1;
      const bDelay = b.delayDaysNumeric ?? -1;
      if (bDelay !== aDelay) {
        return bDelay - aDelay;
      }
      return (b.plannedDelivery || "").localeCompare(a.plannedDelivery || "");
    });
  }, [filtered, vehicleOutcomes, transporters, routes, regions, detailStatus, searchQuery]);

  const totalDetailRecords = delayDetailRows.length;
  const totalPages = Math.max(1, Math.ceil(totalDetailRecords / pageSize));
  const paginatedDetailRows = useMemo(() => {
    const startIndex = (currentPage - 1) * pageSize;
    return delayDetailRows.slice(startIndex, startIndex + pageSize);
  }, [delayDetailRows, currentPage, pageSize]);

  return (
    <DashboardLayout activePage={activePage} onPageChange={onPageChange}>
      {viewMode === "delayDetails" ? (
        /* ==================================================================== */
        /* INLINE DETAIL VIEW: Delivery Delay Details                           */
        /* ==================================================================== */
        <div className="space-y-5">
          {/* Header Bar */}
          <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-200/90 bg-white p-5 shadow-xs">
            <div className="flex items-center gap-4">
              <button
                type="button"
                onClick={() => {
                  setViewMode("overview");
                  setSearchQuery("");
                }}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-xs transition-colors hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700"
              >
                <span className="text-sm leading-none">←</span>
                <span>Back to Overview</span>
              </button>
              <div className="h-5 w-px bg-slate-200" />
              <div>
                <div className="flex items-center gap-2.5">
                  <h1 className="text-xl font-bold tracking-tight text-slate-900">
                    Delivery Delay Details
                  </h1>
                </div>
                <p className="mt-0.5 text-xs text-slate-500">
                  Granular vehicle tracking, planned vs. actual delivery
                  variance, and operational delays.
                </p>
              </div>
            </div>
          </div>

          {/* Status Tabs and Quick Search */}
          <div className="rounded-xl border border-slate-200/90 bg-white p-4 shadow-xs">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              {/* Status Buttons */}
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="mr-2 text-xs font-bold uppercase tracking-wider text-slate-500">
                  Status:
                </span>
                {(
                  [
                    "All",
                    "Currently Delayed",
                    "Delivered Late",
                    "Pending",
                  ] as const
                ).map((tab) => {
                  const isActive = detailStatus === tab;
                  let count = 0;
                  if (tab === "All") count = metrics.allVehiclesWithDeliveries;
                  else if (tab === "Currently Delayed")
                    count = metrics.currentlyDelayed;
                  else if (tab === "Delivered Late")
                    count = metrics.deliveredLateCount;
                  else if (tab === "Pending") count = metrics.pendingDeliveries;

                  return (
                    <button
                      key={tab}
                      type="button"
                      onClick={() => {
                        setDetailStatus(tab);
                        setCurrentPage(1);
                      }}
                      className={`inline-flex items-center gap-2 rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-all ${
                        isActive
                          ? tab === "Currently Delayed"
                            ? "bg-rose-600 text-white shadow-xs"
                            : tab === "Delivered Late"
                              ? "bg-amber-500 text-white shadow-xs"
                              : tab === "Pending"
                                ? "bg-slate-700 text-white shadow-xs"
                                : "bg-blue-600 text-white shadow-xs"
                          : "bg-slate-100 text-slate-600 hover:bg-slate-200/80 hover:text-slate-900"
                      }`}
                    >
                      <span>{tab}</span>
                      <span
                        className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
                          isActive
                            ? "bg-white/20 text-white"
                            : "bg-slate-200 text-slate-700"
                        }`}
                      >
                        {formatNumber(count)}
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* Quick Search */}
              <div className="relative min-w-[260px]">
                <input
                  type="text"
                  placeholder="Search Vehicle ID, VIN, Model, Transporter..."
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value);
                    setCurrentPage(1);
                  }}
                  className="w-full rounded-lg border border-slate-200 bg-slate-50/70 px-3 py-1.5 pr-8 text-xs text-slate-700 placeholder-slate-400 focus:border-blue-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery("")}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400 hover:text-slate-600"
                  >
                    ✕
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Operational Details Table */}
          <div className="overflow-hidden rounded-xl border border-slate-200/90 bg-white shadow-xs">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1100px] text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-slate-700">
                    <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-wider">
                      Vehicle ID
                    </th>
                    <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-wider">
                      VIN
                    </th>
                    <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-wider">
                      Region
                    </th>
                    <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-wider">
                      Model
                    </th>
                    <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-wider">
                      Variant
                    </th>
                    <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-wider">
                      Transporter
                    </th>
                    <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-wider">
                      Route
                    </th>
                    <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-wider">
                      Planned Delivery
                    </th>
                    <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-wider">
                      Actual Delivery
                    </th>
                    <th className="px-4 py-3 text-right text-[11px] font-bold uppercase tracking-wider">
                      Delay Days
                    </th>
                    <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-wider">
                      Status
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {paginatedDetailRows.length === 0 ? (
                    <tr>
                      <td
                        colSpan={11}
                        className="py-12 text-center text-xs text-slate-400"
                      >
                        No delivery records found matching the active filters
                        and status.
                      </td>
                    </tr>
                  ) : (
                    paginatedDetailRows.map((row) => (
                      <tr
                        key={row.deliveryId}
                        className="transition-colors hover:bg-slate-50/70"
                      >
                        <td className="px-4 py-3 font-semibold text-slate-900">
                          {row.vehicleId}
                        </td>
                        <td className="px-4 py-3 font-mono text-[11px] text-slate-600">
                          {row.vin}
                        </td>
                        <td className="px-4 py-3 text-slate-700">
                          {row.region}
                        </td>
                        <td className="px-4 py-3 font-medium text-slate-800">
                          {row.model}
                        </td>
                        <td className="px-4 py-3 text-slate-600">
                          {row.variant}
                        </td>
                        <td className="px-4 py-3 text-slate-600">
                          {row.transporter}
                        </td>
                        <td
                          className="max-w-[200px] truncate px-4 py-3 text-slate-600"
                          title={row.route}
                        >
                          {row.route}
                        </td>
                        <td className="px-4 py-3 text-slate-600">
                          {row.plannedDeliveryFormatted}
                        </td>
                        <td className="px-4 py-3 text-slate-600">
                          {row.actualDeliveryFormatted}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <span
                            className={`font-bold ${
                              row.statusCategory === "Currently Delayed"
                                ? "text-rose-600 font-semibold"
                                : row.statusCategory === "Delivered Late"
                                  ? "text-amber-600 font-semibold"
                                  : "text-slate-400"
                            }`}
                          >
                            {row.delayText}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${row.statusBadgeClass}`}
                          >
                            {row.statusBadgeLabel}
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {/* Pagination Controls */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-slate-50/60 px-4 py-3 text-xs text-slate-600">
              <div>
                Showing{" "}
                <span className="font-semibold text-slate-900">
                  {totalDetailRecords === 0
                    ? 0
                    : (currentPage - 1) * pageSize + 1}
                </span>{" "}
                to{" "}
                <span className="font-semibold text-slate-900">
                  {Math.min(currentPage * pageSize, totalDetailRecords)}
                </span>{" "}
                of{" "}
                <span className="font-semibold text-slate-900">
                  {formatNumber(totalDetailRecords)}
                </span>{" "}
                vehicles
              </div>

              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  disabled={currentPage <= 1}
                  className="rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 shadow-2xs transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Previous
                </button>
                <span className="px-2 text-xs font-semibold text-slate-700">
                  Page {currentPage} of {totalPages}
                </span>
                <button
                  type="button"
                  onClick={() =>
                    setCurrentPage((p) => Math.min(totalPages, p + 1))
                  }
                  disabled={currentPage >= totalPages}
                  className="rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 shadow-2xs transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Next
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : (
        /* ==================================================================== */
        /* STANDARD OVERVIEW VIEW: Page 1 Executive Summary                     */
        /* ==================================================================== */
        <>
          <div className="mb-6 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-200/90 bg-white p-5 shadow-xs">
            <div>
              <div className="flex items-center gap-2.5">
                <h1 className="text-xl font-bold tracking-tight text-slate-900">
                  Logistics Overview
                </h1>
                <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-800">
                  Page 1
                </span>
              </div>
              <p className="mt-1 text-xs text-slate-500">
                Executive summary of vehicle dispatch, delivery, movement, and
                logistics exceptions.
              </p>
            </div>
          </div>

          {error && (
            <div className="mb-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}

          {/* KPI Cards: 8 Cards */}
          <div className="mb-6 grid grid-cols-2 gap-3.5 sm:grid-cols-3 md:grid-cols-4 2xl:grid-cols-8">
            <KPICard
              title="Vehicles Dispatched"
              value={formatNumber(metrics.totalVehiclesDispatched)}
              subtext="Unique vehicles dispatched"
              tooltip="Distinct vehicles with logistics dispatch records"
              accentColor="blue"
              loading={loading}
            />
            <KPICard
              title="Vehicles Delivered"
              value={formatNumber(metrics.vehiclesDelivered)}
              subtext="Completed deliveries"
              tooltip="Distinct vehicles whose latest completed delivery is on time or late; equals On-time + Delivered Late"
              accentColor="emerald"
              loading={loading}
            />
            <KPICard
              title="On-Time Delivery"
              value={formatPercent(metrics.onTimeRate)}
              subtext="Of delivered vehicles"
              tooltip="Vehicles whose final completed delivery landed on or before the planned delivery date"
              accentColor="indigo"
              loading={loading}
            />
            <KPICard
              title="Avg Delivery TAT"
              value={
                metrics.avgDeliveryTat > 0
                  ? `${metrics.avgDeliveryTatDays.toFixed(1)}d`
                  : "—"
              }
              subtext="Dispatch to delivery"
              tooltip="Average elapsed time from dispatch to actual delivery on each vehicle's final completed delivery, expressed in days"
              accentColor="blue"
              loading={loading}
            />
            <KPICard
              title="Pending Deliveries"
              value={formatNumber(metrics.pendingDeliveries)}
              subtext="Not yet completed"
              tooltip="Vehicles with no completed delivery whose latest planned date is still in the future"
              accentColor="amber"
              loading={loading}
            />
            <KPICard
              title="Currently Delayed"
              value={formatNumber(metrics.currentlyDelayed)}
              subtext="Past planned date and not completed"
              tooltip="Vehicles with no completed delivery whose latest planned delivery date has already passed"
              accentColor="amber"
              loading={loading}
            />
            <KPICard
              title="Transportation Cost"
              value={
                metrics.transportationCost
                  ? formatCurrency(metrics.transportationCost)
                  : "—"
              }
              subtext="Dispatch transportation cost"
              tooltip="Total transportation cost for the filtered dispatches"
              accentColor="indigo"
              loading={loading}
            />
            <KPICard
              title="Open Exceptions"
              value={formatNumber(metrics.openExceptions)}
              subtext="Unresolved logistics issues"
              tooltip="Logistics exceptions whose status is not Resolved"
              accentColor="amber"
              loading={loading}
            />
          </div>

          {/* Row 1: Logistics Delay Overview */}
          <div className="mb-5 grid grid-cols-1 gap-5">
            <ChartCard
              title="Logistics Delay Overview"
              subtitle="Unique vehicles by final delivery outcome: on-time, delivered late, currently delayed, and pending"
              height={280}
              action={
                <button
                  type="button"
                  onClick={() => {
                    setDetailStatus("Currently Delayed");
                    setCurrentPage(1);
                    setViewMode("delayDetails");
                  }}
                  title="View Delivery Delay Details"
                  className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-slate-100 text-slate-600 shadow-2xs transition-all hover:bg-blue-600 hover:text-white"
                >
                  <svg
                    className="h-3.5 w-3.5"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2.5}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3"
                    />
                  </svg>
                </button>
              }
            >
              <ClusteredColumnChart
                data={metrics.delayData}
                valueFormatter={(value) => formatNumber(value)}
                height={230}
                showLegend={false}
              />
            </ChartCard>
          </div>

          {/* Row 2: Cross-dimensional delivery performance */}
          <div className="grid grid-cols-1 gap-5">
            <ChartCard
              title="Delivery Performance Analysis"
              subtitle="Compare any dimension across any other dimension, for example every vehicle type across all regions"
              height={420}
            >
              <CrossDimensionMatrixChart
                facts={deliveryFacts}
                allRegions={regionNames}
                height={360}
              />
            </ChartCard>
          </div>
        </>
      )}
    </DashboardLayout>
  );
}
