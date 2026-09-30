import { supabase } from "./supabaseClient";
import type {
  DimCustomer,
  DimRegion,
  DimVehicle,
  DimVModel,
} from "./index";

export type { DimCustomer, DimRegion, DimVehicle, DimVModel };

// -----------------------------------------------------------------------------
// Logistics raw table row shapes
// -----------------------------------------------------------------------------

export interface DimLocation {
  location_id: string;
  location_name: string;
  region_id: string;
  address: string;
  location_type: string;
}

export interface DimPart {
  part_id: string;
  part_name: string;
  part_type: string;
}

export interface DimDate {
  date_id: string;
  year: number;
  month_number: number;
  month_name: string;
  quarter: string;
}

export interface DimSupplier {
  supplier_id: string;
  supplier_name: string;
  risk_tier: string;
}

export interface DimRoute {
  route_id: string;
  origin_location_id: string;
  destination_location_id: string;
  distance_km: number;
  standard_transit_time_hours: number;
}

export interface FactPartInventory {
  part_inventory_id: string;
  part_id: string;
  location_id: string;
  quantity: number;
  inventory_status: string;
}

export interface FactVehicleInventory {
  inventory_id: string;
  vehicle_id: string;
  location_id: string;
  inventory_status: string;
  inventory_entry_date: string;
  allocation_date: string | null;
  exit_date: string | null;
}

export interface FactVehicleDispatch {
  dispatch_id: string;
  vehicle_id: string;
  origin_location_id: string;
  destination_location_id: string;
  transporter_id: string;
  route_id: string;
  dispatch_date_time: string;
  arrival_date_time: string | null;
  planned_delivery_date: string | null;
  dispatch_status: string;
}

export interface FactTransporter {
  transporter_id: string;
  transporter_name: string;
  service_region: string;
  status: string;
}

export interface FactVehicleMovementHistory {
  movement_id: string;
  vehicle_id: string;
  dispatch_id: string;
  status: string;
  location_id: string;
  status_date_time: string;
  remarks: string | null;
}

export interface FactLogisticsVehicleDelivery {
  delivery_id: string;
  dispatch_id: string;
  booking_id: string | null;
  vehicle_id: string;
  planned_delivery_date: string;
  actual_delivery_date: string | null;
  delivery_status: string;
}

export interface FactLogisticsException {
  exception_id: string;
  vehicle_id: string;
  dispatch_id: string;
  exception_type: string;
  exception_date: string;
  location_id: string;
  severity: string;
  status: string;
  resolution_date: string | null;
  description: string | null;
}

export interface FactTransportationCost {
  cost_id: string;
  dispatch_id: string;
  transporter_id: string;
  route_id: string;
  transportation_cost: number;
  cost_date: string;
}

// -----------------------------------------------------------------------------
// Complete shared Logistics snapshot
// -----------------------------------------------------------------------------

export interface DatabaseSnapshot {
  // Shared/master dimensions
  vehicles: DimVehicle[];
  models: DimVModel[];
  regions: DimRegion[];
  customers: DimCustomer[];
  locations: DimLocation[];
  parts: DimPart[];
  dates: DimDate[];
  suppliers: DimSupplier[];

  // Logistics facts
  partInventory: FactPartInventory[];
  vehicleInventory: FactVehicleInventory[];
  dispatches: FactVehicleDispatch[];
  routes: DimRoute[];
  transporters: FactTransporter[];
  movements: FactVehicleMovementHistory[];
  deliveries: FactLogisticsVehicleDelivery[];
  exceptions: FactLogisticsException[];
  transportationCosts: FactTransportationCost[];
}

let cachedSnapshot: DatabaseSnapshot | null = null;
let activeFetchPromise: Promise<DatabaseSnapshot> | null = null;

/**
 * Fetch every row from a Supabase table.
 *
 * Supabase/PostgREST commonly returns at most 1000 rows per request, so we
 * continue paging until the returned page is smaller than the page size.
 * No demo/fallback data is inserted here.
 */
async function fetchAllTableRows<T>(
  tableName: string,
  columns = "*",
): Promise<T[]> {
  if (!supabase) return [];

  const pageSize = 1000;
  const allRows: T[] = [];

  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from(tableName)
      .select(columns)
      .range(from, from + pageSize - 1);

    if (error) {
      throw new Error(`Error loading ${tableName}: ${error.message}`);
    }

    const page = (data ?? []) as T[];
    allRows.push(...page);

    if (page.length < pageSize) break;
  }

  return allRows;
}

/**
 * Load all shared/master + Logistics tables in parallel and cache them.
 *
 * The same snapshot is reused by every Logistics page so filters and page
 * switching do not trigger a separate set of Supabase requests each time.
 */
export async function loadDatabaseSnapshot(
  forceRefresh = false,
): Promise<DatabaseSnapshot> {
  if (!forceRefresh && cachedSnapshot) {
    return cachedSnapshot;
  }

  if (!forceRefresh && activeFetchPromise) {
    return activeFetchPromise;
  }

  activeFetchPromise = (async () => {
    try {
      const [
        vehicles,
        models,
        regions,
        customers,
        locations,
        parts,
        dates,
        suppliers,
        partInventory,
        vehicleInventory,
        dispatches,
        routes,
        transporters,
        movements,
        deliveries,
        exceptions,
        transportationCosts,
      ] = await Promise.all([
        fetchAllTableRows<DimVehicle>("dim_vehicle"),
        fetchAllTableRows<DimVModel>("dim_v_model"),
        fetchAllTableRows<DimRegion>("dim_region"),
        fetchAllTableRows<DimCustomer>("dim_customer"),
        fetchAllTableRows<DimLocation>("dim_location"),
        fetchAllTableRows<DimPart>("dim_part"),
        fetchAllTableRows<DimDate>("dim_date"),
        fetchAllTableRows<DimSupplier>("dim_supplier"),

        fetchAllTableRows<FactPartInventory>("fact_part_inventory"),
        fetchAllTableRows<FactVehicleInventory>("fact_vehicle_inventory"),
        fetchAllTableRows<FactVehicleDispatch>("fact_vehicle_dispatch"),
        fetchAllTableRows<DimRoute>("dim_route"),
        fetchAllTableRows<FactTransporter>("fact_transporter"),
        fetchAllTableRows<FactVehicleMovementHistory>(
          "fact_vehicle_movement_history",
        ),
        fetchAllTableRows<FactLogisticsVehicleDelivery>(
          "fact_l_vehicle_delivery",
        ),
        fetchAllTableRows<FactLogisticsException>(
          "fact_logistics_exception",
        ),
        fetchAllTableRows<FactTransportationCost>(
          "fact_transportation_cost",
        ),
      ]);

      cachedSnapshot = {
        vehicles,
        models,
        regions,
        customers,
        locations,
        parts,
        dates,
        suppliers,
        partInventory,
        vehicleInventory,
        dispatches,
        routes,
        transporters,
        movements,
        deliveries,
        exceptions,
        transportationCosts,
      };

      return cachedSnapshot;
    } finally {
      activeFetchPromise = null;
    }
  })();

  return activeFetchPromise;
}

export function clearDatabaseCache() {
  cachedSnapshot = null;
  activeFetchPromise = null;
}
