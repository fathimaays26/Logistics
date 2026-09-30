const PAGES = [
  "Logistics Overview",
  "Dispatch & Delivery",
  "Transportation & Movement",
  "Vehicle Inventory",
  "Parts & Inventory",
] as const;

export type DashboardPage = (typeof PAGES)[number];

export default function Header({
  activePage,
  onPageChange,
}: {
  activePage: DashboardPage;
  onPageChange: (page: DashboardPage) => void;
}) {
  return (
    <header className="fixed top-0 left-0 right-0 z-30 h-16 bg-slate-900 text-white flex items-center px-6 shadow-md">
      <div className="flex items-center gap-3 shrink-0 mr-8">
        <span className="text-lg font-semibold tracking-tight">LOG</span>
        <span className="hidden sm:inline-block h-4 w-px bg-white/25" />
        <span className="hidden sm:inline text-xs font-medium text-white/70">
          Logistics
        </span>
      </div>

      <nav className="flex items-center gap-1.5 overflow-x-auto">
        {PAGES.map((page) => (
          <button
            key={page}
            type="button"
            onClick={() => onPageChange(page)}
            className={[
              "whitespace-nowrap rounded-md px-3.5 py-2 text-sm font-medium transition-colors",
              activePage === page
                ? "bg-white text-slate-900"
                : "text-white/80 hover:bg-white/10 hover:text-white",
            ].join(" ")}
          >
            {page}
          </button>
        ))}
      </nav>
    </header>
  );
}
