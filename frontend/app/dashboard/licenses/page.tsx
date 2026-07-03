import LicenseCard from "@/components/license/LicenseCard";
import { licenseManagementService } from "@/services/license-management.service";
import { authService } from "@/services/auth.service";

export default function LicensesPage() {
  const user = authService.getCurrentUser();
  const licenses = licenseManagementService.getMyLicenses(user?.id ?? "");

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">My Licenses</h1>
      {licenses.length === 0 ? (
        <p className="text-gray-400">No licenses yet.</p>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {licenses.map((l) => (
            <LicenseCard key={l.id} license={l} />
          ))}
        </div>
      )}
    </div>
  );
}