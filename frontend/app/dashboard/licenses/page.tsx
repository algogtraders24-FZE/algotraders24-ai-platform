import LicenseCard from "@/components/license/LicenseCard";
import { licenseManagementService } from "@/services/license-management.service";
import { authService } from "@/services/auth.service";
import EmptyState from "@/components/ui/EmptyState";
import ButtonLink from "@/components/ui/ButtonLink";

export default async function LicensesPage() {
  const user = await authService.getCurrentUser();
  const licenses = licenseManagementService.getMyLicenses(user?.id ?? "");

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-text">My Licenses</h1>
      {licenses.length === 0 ? (
        <EmptyState
          title="No licenses yet."
          description="Licenses are issued after purchasing a product."
          action={<ButtonLink href="/products">Browse products</ButtonLink>}
        />
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
