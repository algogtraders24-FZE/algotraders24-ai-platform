import DashboardSidebar from "@/components/dashboard/DashboardSidebar";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import { authService } from "@/services/auth.service";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = authService.getCurrentUser();

  return (
    <div className="min-h-screen bg-[#050816] text-white flex">
      <DashboardSidebar />
      <div className="flex-1 flex flex-col">
        <DashboardHeader userName={user?.name ?? "Guest"} />
        <div className="flex-1 p-6">{children}</div>
      </div>
    </div>
  );
}