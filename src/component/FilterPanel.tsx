import { useMemo } from "react";
import { useFilters } from "../context/FilterContext";
import DateRangeSlider from "./DateRangeSlider";

function Field({
  label,
  isActive,
  children,
}: {
  label: string;
  isActive?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-3.5">
      <div className="flex items-center justify-between mb-1.5">
        <label className="block text-xs font-semibold text-slate-600">
          {label}
        </label>
        {isActive && (
          <span className="h-1.5 w-1.5 rounded-full bg-blue-600" />
        )}
      </div>
      {children}
    </div>
  );
}

const selectBase =
  "w-full rounded-lg border bg-white px-3 py-2 text-xs font-medium transition-all focus:outline-none focus:ring-2 focus:ring-blue-500/20";

export default function FilterPanel() {
  const { filters, setFilter, resetFilters, lookups, loadingLookups } =
    useFilters();

  const activeCount = Object.values(filters).filter(
    (value) => value !== null && value !== "",
  ).length;

  const models = useMemo(() => {
    if (!lookups) return [];
    return lookups.models.filter((model) => {
      if (filters.variant && model.variant !== filters.variant) return false;
      if (filters.vehicleType && model.vehicle_type !== filters.vehicleType) {
        return false;
      }
      return true;
    });
  }, [lookups, filters.variant, filters.vehicleType]);

  const variants = useMemo(() => {
    if (!lookups) return [];
    return Array.from(
      new Set(
        lookups.models
          .filter((model) =>
            filters.modelId ? model.model_id === filters.modelId : true,
          )
          .filter((model) =>
            filters.vehicleType
              ? model.vehicle_type === filters.vehicleType
              : true,
          )
          .map((model) => model.variant)
          .filter(Boolean),
      ),
    ).sort();
  }, [lookups, filters.modelId, filters.vehicleType]);

  const vehicleTypes = useMemo(() => {
    if (!lookups) return [];
    return Array.from(
      new Set(
        lookups.models
          .filter((model) =>
            filters.modelId ? model.model_id === filters.modelId : true,
          )
          .filter((model) =>
            filters.variant ? model.variant === filters.variant : true,
          )
          .map((model) => model.vehicle_type)
          .filter(Boolean),
      ),
    ).sort();
  }, [lookups, filters.modelId, filters.variant]);

  const locations = useMemo(() => {
    if (!lookups) return [];
    return lookups.locations.filter((location) =>
      filters.regionId ? location.region_id === filters.regionId : true,
    );
  }, [lookups, filters.regionId]);

  const routes = useMemo(() => {
    if (!lookups) return [];
    return lookups.routes.filter((route) => {
      const origin = lookups.locationsById.get(route.origin_location_id);
      const destination = lookups.locationsById.get(
        route.destination_location_id,
      );

      if (filters.locationId) {
        return (
          route.origin_location_id === filters.locationId ||
          route.destination_location_id === filters.locationId
        );
      }

      if (filters.regionId) {
        return (
          origin?.region_id === filters.regionId ||
          destination?.region_id === filters.regionId
        );
      }

      return true;
    });
  }, [lookups, filters.locationId, filters.regionId]);

  const transporters = useMemo(() => {
    if (!lookups) return [];
    if (!filters.regionId) return lookups.transporters;

    const regionName = lookups.regionsById.get(filters.regionId)?.region_name;
    if (!regionName) return lookups.transporters;

    const matching = lookups.transporters.filter((transporter) =>
      (transporter.service_region || "")
        .toLowerCase()
        .includes(regionName.toLowerCase()),
    );

    return matching.length > 0 ? matching : lookups.transporters;
  }, [lookups, filters.regionId]);

  return (
    <aside className="fixed left-0 top-16 bottom-0 w-64 bg-slate-50/70 border-r border-slate-200/90 overflow-y-auto px-4 py-4 z-20 shadow-2xs">
      <div className="flex items-center justify-between mb-4 border-b border-slate-200/80 pb-3">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-800">
            Filters
          </span>

          {activeCount > 0 && (
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-blue-600 text-white">
              {activeCount}
            </span>
          )}
        </div>

        {activeCount > 0 && (
          <button
            type="button"
            onClick={resetFilters}
            className="text-xs font-semibold text-blue-600 hover:text-blue-800 transition-colors"
          >
            Reset all
          </button>
        )}
      </div>

      <div className="space-y-1">
        <Field label="Region" isActive={Boolean(filters.regionId)}>
          <select
            className={`${selectBase} ${
              filters.regionId
                ? "border-blue-500 bg-blue-50/30 text-blue-900 font-semibold"
                : "border-slate-200 text-slate-700"
            }`}
            disabled={loadingLookups}
            value={filters.regionId ?? ""}
            onChange={(event) =>
              setFilter("regionId", event.target.value || null)
            }
          >
            <option value="">All Regions</option>
            {lookups?.regions.map((region) => (
              <option key={region.region_id} value={region.region_id}>
                {region.region_name}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Model" isActive={Boolean(filters.modelId)}>
          <select
            className={`${selectBase} ${
              filters.modelId
                ? "border-blue-500 bg-blue-50/30 text-blue-900 font-semibold"
                : "border-slate-200 text-slate-700"
            }`}
            disabled={loadingLookups}
            value={filters.modelId ?? ""}
            onChange={(event) =>
              setFilter("modelId", event.target.value || null)
            }
          >
            <option value="">All Models</option>
            {models.map((model) => (
              <option key={model.model_id} value={model.model_id}>
                {model.variant
                  ? `${model.model_name} (${model.variant})`
                  : model.model_name}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Variant" isActive={Boolean(filters.variant)}>
          <select
            className={`${selectBase} ${
              filters.variant
                ? "border-blue-500 bg-blue-50/30 text-blue-900 font-semibold"
                : "border-slate-200 text-slate-700"
            }`}
            disabled={loadingLookups}
            value={filters.variant ?? ""}
            onChange={(event) =>
              setFilter("variant", event.target.value || null)
            }
          >
            <option value="">All Variants</option>
            {variants.map((variant) => (
              <option key={variant} value={variant}>
                {variant}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Vehicle Type" isActive={Boolean(filters.vehicleType)}>
          <select
            className={`${selectBase} ${
              filters.vehicleType
                ? "border-blue-500 bg-blue-50/30 text-blue-900 font-semibold"
                : "border-slate-200 text-slate-700"
            }`}
            disabled={loadingLookups}
            value={filters.vehicleType ?? ""}
            onChange={(event) =>
              setFilter("vehicleType", event.target.value || null)
            }
          >
            <option value="">All Vehicle Types</option>
            {vehicleTypes.map((vehicleType) => (
              <option key={vehicleType} value={vehicleType}>
                {vehicleType}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Location" isActive={Boolean(filters.locationId)}>
          <select
            className={`${selectBase} ${
              filters.locationId
                ? "border-blue-500 bg-blue-50/30 text-blue-900 font-semibold"
                : "border-slate-200 text-slate-700"
            }`}
            disabled={loadingLookups}
            value={filters.locationId ?? ""}
            onChange={(event) =>
              setFilter("locationId", event.target.value || null)
            }
          >
            <option value="">All Locations</option>
            {locations.map((location) => (
              <option key={location.location_id} value={location.location_id}>
                {location.location_name}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Transporter" isActive={Boolean(filters.transporterId)}>
          <select
            className={`${selectBase} ${
              filters.transporterId
                ? "border-blue-500 bg-blue-50/30 text-blue-900 font-semibold"
                : "border-slate-200 text-slate-700"
            }`}
            disabled={loadingLookups}
            value={filters.transporterId ?? ""}
            onChange={(event) =>
              setFilter("transporterId", event.target.value || null)
            }
          >
            <option value="">All Transporters</option>
            {transporters.map((transporter) => (
              <option
                key={transporter.transporter_id}
                value={transporter.transporter_id}
              >
                {transporter.transporter_name}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Route" isActive={Boolean(filters.routeId)}>
          <select
            className={`${selectBase} ${
              filters.routeId
                ? "border-blue-500 bg-blue-50/30 text-blue-900 font-semibold"
                : "border-slate-200 text-slate-700"
            }`}
            disabled={loadingLookups}
            value={filters.routeId ?? ""}
            onChange={(event) =>
              setFilter("routeId", event.target.value || null)
            }
          >
            <option value="">All Routes</option>
            {routes.map((route) => {
              const origin = lookups?.locationsById.get(
                route.origin_location_id,
              );
              const destination = lookups?.locationsById.get(
                route.destination_location_id,
              );
              return (
                <option key={route.route_id} value={route.route_id}>
                  {origin?.location_name ?? route.origin_location_id} →{" "}
                  {destination?.location_name ?? route.destination_location_id}
                </option>
              );
            })}
          </select>
        </Field>

        <Field
          label="Inventory Status"
          isActive={Boolean(filters.inventoryStatus)}
        >
          <select
            className={`${selectBase} ${
              filters.inventoryStatus
                ? "border-blue-500 bg-blue-50/30 text-blue-900 font-semibold"
                : "border-slate-200 text-slate-700"
            }`}
            disabled={loadingLookups}
            value={filters.inventoryStatus ?? ""}
            onChange={(event) =>
              setFilter("inventoryStatus", event.target.value || null)
            }
          >
            <option value="">All Inventory Statuses</option>
            {(lookups?.inventoryStatuses ?? []).map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
        </Field>

        <Field
          label="Delivery Status"
          isActive={Boolean(filters.deliveryStatus)}
        >
          <select
            className={`${selectBase} ${
              filters.deliveryStatus
                ? "border-blue-500 bg-blue-50/30 text-blue-900 font-semibold"
                : "border-slate-200 text-slate-700"
            }`}
            disabled={loadingLookups}
            value={filters.deliveryStatus ?? ""}
            onChange={(event) =>
              setFilter("deliveryStatus", event.target.value || null)
            }
          >
            <option value="">All Delivery Statuses</option>
            {(lookups?.deliveryStatuses ?? []).map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div className="mt-5 pt-3 border-t border-slate-200/80">
        <DateRangeSlider
          startDate={filters.startDate}
          endDate={filters.endDate}
          minDateStr="2025-01-01"
          maxDateStr="2026-12-31"
          onChange={(start, end) => {
            setFilter("startDate", start);
            setFilter("endDate", end);
          }}
        />
      </div>
    </aside>
  );
}
