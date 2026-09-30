import LogisticsOverview from "./pages/Overview";
import DispatchDelivery from "./pages/DispatchVehicleMovement";
import TransportationMovement from "./pages/DeliveryFulfillment";
import VehicleInventory from "./pages/InventoryAvailability";
import PartsInventory from "./pages/TransporterRouteException";

import type { DashboardPage } from "./component/Header";
import { FilterProvider } from "./context/FilterContext";
import { useState } from "react";

export default function App() {
  const [activePage, setActivePage] =
    useState<DashboardPage>("Logistics Overview");

  return (
    <FilterProvider>
      {activePage === "Logistics Overview" ? (
        <LogisticsOverview
          activePage={activePage}
          onPageChange={setActivePage}
        />
      ) : activePage === "Dispatch & Delivery" ? (
        <DispatchDelivery
          activePage={activePage}
          onPageChange={setActivePage}
        />
      ) : activePage === "Transportation & Movement" ? (
        <TransportationMovement
          activePage={activePage}
          onPageChange={setActivePage}
        />
      ) : activePage === "Vehicle Inventory" ? (
        <VehicleInventory
          activePage={activePage}
          onPageChange={setActivePage}
        />
      ) : (
        <PartsInventory
          activePage={activePage}
          onPageChange={setActivePage}
        />
      )}
    </FilterProvider>
  );
}