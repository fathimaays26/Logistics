import Header from "./Header";
import FilterPanel from "./FilterPanel";
import type { DashboardPage } from "./Header";

export default function DashboardLayout({
  children,
  activePage = "Logistics Overview",
  onPageChange,
}: {
  children: React.ReactNode;
  activePage?: DashboardPage;
  onPageChange?: (page: DashboardPage) => void;
}) {
  const handlePageChange = onPageChange ?? (() => undefined);

  return (
    <div className="min-h-screen bg-slate-100">
      <Header activePage={activePage} onPageChange={handlePageChange} />
      <FilterPanel />
      <main className="pt-16 pl-64">
        <div className="px-6 py-6 max-w-[1600px] mx-auto">{children}</div>
      </main>
    </div>
  );
}
