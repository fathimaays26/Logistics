// ---- Raw table row shapes (match existing Supabase schema exactly) ----

export interface DimCustomer {
  customer_id: string;
  customer_name: string;
  customer_type: string;
  region_id: string;
}

export interface DimRegion {
  region_id: string;
  region_name: string;
  state: string;
  country: string;
}

export interface DimVModel {
  model_id: string;
  model_name: string;
  variant: string;
  vehicle_type: string;
}

export interface DimVehicle {
  vehicle_id: string;
  vin: string;
  model_id: string;
  customer_id: string;
  location_id: string;
  current_status: string;
}

export interface FactBooking {
  booking_id: string;
  customer_id: string;
  vehicle_id: string;
  model_id: string;
  booking_date: string;
  booking_status: string;
  cancellation_reason: string | null;
  cancellation_date: string | null;
}

export interface FactSalesTransaction {
  sale_id: string;
  booking_id: string;
  customer_id: string;
  vehicle_id: string;
  model_id: string;
  region_id: string;
  sale_date: string;
  sale_value: number;
}

export interface FactNVVehicleDelivery {
  delivery_id: string;
  booking_id: string;
  vehicle_id: string;
  planned_delivery_date: string;
  actual_delivery_date: string | null;
  delivery_status: string;
}

export interface FactSalesTarget {
  target_id: string;
  region_id: string;
  model_id: string;
  target_period: string;
  sales_target: number;
}

// ---- Logistics dimension / lookup row shapes ----

export interface DimLocation {
  location_id: string;
  location_name: string;
  region_id: string;
  address: string;
  location_type: string;
}

export interface DimRoute {
  route_id: string;
  origin_location_id: string;
  destination_location_id: string;
  distance_km: number;
  standard_transit_time_hours: number;
}

export interface FactTransporter {
  transporter_id: string;
  transporter_name: string;
  service_region: string;
  status: string;
}

// ---- Dimension lookup maps, built once and reused across pages ----

export interface DimensionLookups {
  regionsById: Map<string, DimRegion>;
  modelsById: Map<string, DimVModel>;
  customersById: Map<string, DimCustomer>;

  regions: DimRegion[];
  models: DimVModel[];
  variants: string[];
  vehicleTypes: string[];
  customerTypes: string[];
  bookingStatuses: string[];

  // Logistics lookups
  locations: DimLocation[];
  locationsById: Map<string, DimLocation>;
  transporters: FactTransporter[];
  routes: DimRoute[];
  inventoryStatuses: string[];
  deliveryStatuses: string[];
}

// ---- Global filter state shared across every page ----

export interface GlobalFilters {
  startDate: string | null;
  endDate: string | null;

  regionId: string | null;
  modelId: string | null;
  variant: string | null;
  vehicleType: string | null;

  // Existing New Vehicle Sales filters
  customerType: string | null;
  bookingStatus: string | null;

  // Logistics filters
  locationId: string | null;
  transporterId: string | null;
  routeId: string | null;
  inventoryStatus: string | null;
  deliveryStatus: string | null;
}

export const EMPTY_FILTERS: GlobalFilters = {
  startDate: null,
  endDate: null,

  regionId: null,
  modelId: null,
  variant: null,
  vehicleType: null,

  // Existing New Vehicle Sales filters
  customerType: null,
  bookingStatus: null,

  // Logistics filters
  locationId: null,
  transporterId: null,
  routeId: null,
  inventoryStatus: null,
  deliveryStatus: null,
};

export interface OverviewKpis {
  totalVehiclesSold: number;
  totalSalesRevenue: number;
  avgSalesValue: number;
  totalBookings: number;
  conversionRate: number;
  targetAchievement: number;
  topSellingModel: string;
}

export interface ChartPoint {
  label: string;
  value: number;
}