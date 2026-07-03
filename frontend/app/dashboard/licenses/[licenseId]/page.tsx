import { notFound } from "next/navigation";
import LicenseDetails from "@/components/license/LicenseDetails";
import ActivationHistory from "@/components/license/ActivationHistory";
import LicenseActions from "@/components/license/LicenseActions";
import { licenseManagementService } from "@/services/license-management.service";

export default async function LicenseDetailPage({
  params,
}: {
  params: Promise<{ licenseId: string }>;
}) {
  const { licenseId } = await params;
  const license = licenseManagementService.getById(licenseId);

  if (!license) notFound();

  return (
    <div className="space-y-6 max-w-3xl">
      <h1 className="text-2xl font-bold">License</h1>
      <LicenseDetails license={license} />
      <ActivationHistory license={license} />
      <LicenseActions />
    </div>
  );
}