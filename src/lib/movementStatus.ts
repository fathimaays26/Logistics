import type { FactVehicleMovementHistory } from "../dataService";

/**
 * Canonical movement-status vocabulary for the whole dashboard.
 *
 * "Delayed" here means a movement EVENT whose recorded status is Delayed, taken
 * from the LATEST movement record for each dispatch. It is deliberately NOT the
 * same thing as a late delivery (actual after planned date), which is a
 * delivery-SLA measure owned by Page 1.
 *
 * Both Page 2 and Page 3 import from this module so the word "Delayed" can
 * never mean two different numbers on two different pages.
 */
export function normalizeMovementStatus(
  value: string | null | undefined,
): string {
  const status = (value ?? "").trim().toLowerCase();
  if (["arrived", "completed", "delivered"].includes(status)) {
    return "Delivered";
  }
  if (["departed", "dispatched", "dispatch"].includes(status)) {
    return "Dispatched";
  }
  if (["delayed", "delay"].includes(status)) return "Delayed";
  if (
    ["in transit", "in_transit", "transit", "on route", "on the way"].includes(
      status,
    )
  ) {
    return "In Transit";
  }
  return value?.trim() || "Unknown";
}

/** The most recent movement record per dispatch, by status timestamp. */
export function buildLatestMovementByDispatch(
  movements: FactVehicleMovementHistory[],
): Map<string, FactVehicleMovementHistory> {
  const map = new Map<string, FactVehicleMovementHistory>();

  for (const movement of movements) {
    const existing = map.get(movement.dispatch_id);
    if (
      !existing ||
      new Date(movement.status_date_time).getTime() >
        new Date(existing.status_date_time).getTime()
    ) {
      map.set(movement.dispatch_id, movement);
    }
  }

  return map;
}

/**
 * Resolves the movement status of a dispatch: the latest movement event's
 * status, falling back to the dispatch's own status when the dispatch has no
 * movement history. This is the single source of truth for "Delayed".
 */
export function resolveDispatchMovementStatus(
  dispatchId: string,
  dispatchStatus: string | null | undefined,
  latestMovementByDispatch: Map<string, FactVehicleMovementHistory>,
): string {
  const movement = latestMovementByDispatch.get(dispatchId);
  return normalizeMovementStatus(
    movement?.status || dispatchStatus || "Unknown",
  );
}

export const MOVEMENT_STATUSES = [
  "Dispatched",
  "In Transit",
  "Delivered",
  "Delayed",
] as const;
