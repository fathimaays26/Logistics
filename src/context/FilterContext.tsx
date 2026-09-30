import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { loadDatabaseSnapshot } from "../dataService";
import {
  EMPTY_FILTERS,
  type DimCustomer,
  type DimensionLookups,
  type GlobalFilters,
} from "../index";

interface FilterContextValue {
  filters: GlobalFilters;

  setFilter: <K extends keyof GlobalFilters>(
    key: K,
    value: GlobalFilters[K],
  ) => void;

  resetFilters: () => void;

  lookups: DimensionLookups | null;
  loadingLookups: boolean;

  matchingModelIds: string[] | null;
  matchingCustomerIds: string[] | null;
}

const FilterContext = createContext<FilterContextValue | undefined>(
  undefined,
);

function uniqueSorted(values: Array<string | null | undefined>): string[] {
  return Array.from(
    new Set(
      values.filter(
        (value): value is string =>
          typeof value === "string" && value.length > 0,
      ),
    ),
  ).sort();
}

export function FilterProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [filters, setFilters] = useState<GlobalFilters>(EMPTY_FILTERS);
  const [lookups, setLookups] =
    useState<DimensionLookups | null>(null);
  const [loadingLookups, setLoadingLookups] = useState(true);

  useEffect(() => {
    async function loadLookups() {
      setLoadingLookups(true);

      try {
        const snapshot = await loadDatabaseSnapshot();
        const customers: DimCustomer[] = snapshot.customers;

        setLookups({
          regions: snapshot.regions,
          models: snapshot.models,
          locations: snapshot.locations,
          transporters: snapshot.transporters,
          routes: snapshot.routes,

          regionsById: new Map(
            snapshot.regions.map((region) => [region.region_id, region]),
          ),
          modelsById: new Map(
            snapshot.models.map((model) => [model.model_id, model]),
          ),
          customersById: new Map(
            customers.map((customer) => [customer.customer_id, customer]),
          ),
          locationsById: new Map(
            snapshot.locations.map((location) => [
              location.location_id,
              location,
            ]),
          ),

          variants: uniqueSorted(snapshot.models.map((model) => model.variant)),
          vehicleTypes: uniqueSorted(
            snapshot.models.map((model) => model.vehicle_type),
          ),
          customerTypes: uniqueSorted(
            customers.map((customer) => customer.customer_type),
          ),
          bookingStatuses: [],
          inventoryStatuses: uniqueSorted(
            snapshot.vehicleInventory.map((row) => row.inventory_status),
          ),
          deliveryStatuses: uniqueSorted(
            snapshot.deliveries.map((row) => row.delivery_status),
          ),
        });
      } catch (error) {
        console.error(error);
        setLookups(null);
      } finally {
        setLoadingLookups(false);
      }
    }

    void loadLookups();
  }, []);

  const setFilter: FilterContextValue["setFilter"] = useCallback(
    (key, value) => {
      setFilters((previousFilters) => {
        const nextFilters: GlobalFilters = {
          ...previousFilters,
          [key]: value,
        };

        if (!lookups) return nextFilters;

        if (key === "regionId") {
          if (nextFilters.locationId) {
            const location = lookups.locationsById.get(nextFilters.locationId);
            if (
              value &&
              location &&
              location.region_id !== value
            ) {
              nextFilters.locationId = null;
            }
          }

          if (nextFilters.routeId && value) {
            const route = lookups.routes.find(
              (item) => item.route_id === nextFilters.routeId,
            );
            if (route) {
              const origin = lookups.locationsById.get(route.origin_location_id);
              const destination = lookups.locationsById.get(
                route.destination_location_id,
              );
              if (
                origin?.region_id !== value &&
                destination?.region_id !== value
              ) {
                nextFilters.routeId = null;
              }
            }
          }
        }

        if (key === "locationId" && nextFilters.routeId && value) {
          const route = lookups.routes.find(
            (item) => item.route_id === nextFilters.routeId,
          );
          if (
            route &&
            route.origin_location_id !== value &&
            route.destination_location_id !== value
          ) {
            nextFilters.routeId = null;
          }
        }

        if (key === "modelId" && value) {
          const model = lookups.modelsById.get(value);
          if (model) {
            if (nextFilters.variant && nextFilters.variant !== model.variant) {
              nextFilters.variant = null;
            }
            if (
              nextFilters.vehicleType &&
              nextFilters.vehicleType !== model.vehicle_type
            ) {
              nextFilters.vehicleType = null;
            }
          }
        }

        if (key === "variant" && value) {
          if (nextFilters.modelId) {
            const model = lookups.modelsById.get(nextFilters.modelId);
            if (model && model.variant !== value) {
              nextFilters.modelId = null;
            }
          }
        }

        if (key === "vehicleType" && value) {
          if (nextFilters.modelId) {
            const model = lookups.modelsById.get(nextFilters.modelId);
            if (model && model.vehicle_type !== value) {
              nextFilters.modelId = null;
            }
          }
        }

        return nextFilters;
      });
    },
    [lookups],
  );

  const resetFilters = useCallback(() => setFilters(EMPTY_FILTERS), []);

  const matchingModelIds = useMemo(() => {
    if (!lookups) return null;

    const modelId = filters.modelId;
    const variant = filters.variant;
    const vehicleType = filters.vehicleType;

    if (!modelId && !variant && !vehicleType) {
      return null;
    }

    return lookups.models
      .filter((model) => (modelId ? model.model_id === modelId : true))
      .filter((model) => (variant ? model.variant === variant : true))
      .filter((model) =>
        vehicleType ? model.vehicle_type === vehicleType : true,
      )
      .map((model) => model.model_id);
  }, [lookups, filters.modelId, filters.variant, filters.vehicleType]);

  const matchingCustomerIds = useMemo(() => {
    if (!lookups) return null;

    const customerType = filters.customerType;
    const regionId = filters.regionId;

    if (!customerType && !regionId) {
      return null;
    }

    return Array.from(lookups.customersById.values())
      .filter((customer) =>
        customerType ? customer.customer_type === customerType : true,
      )
      .filter((customer) =>
        regionId ? customer.region_id === regionId : true,
      )
      .map((customer) => customer.customer_id);
  }, [lookups, filters.customerType, filters.regionId]);

  const value = useMemo(
    () => ({
      filters,
      setFilter,
      resetFilters,
      lookups,
      loadingLookups,
      matchingModelIds,
      matchingCustomerIds,
    }),
    [
      filters,
      setFilter,
      resetFilters,
      lookups,
      loadingLookups,
      matchingModelIds,
      matchingCustomerIds,
    ],
  );

  return (
    <FilterContext.Provider value={value}>{children}</FilterContext.Provider>
  );
}

export function useFilters() {
  const context = useContext(FilterContext);

  if (!context) {
    throw new Error("useFilters must be used within a FilterProvider");
  }

  return context;
}

export { EMPTY_FILTERS };
export type { GlobalFilters, DimensionLookups };
