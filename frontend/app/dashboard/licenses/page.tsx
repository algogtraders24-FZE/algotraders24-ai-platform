import Link from "next/link";
import LicenseCard from "@/components/license/LicenseCard";
import { licenseManagementService } from "@/services/license-management.service";
import { authService } from "@/services/auth.service";

export default async function LicensesPage() {
  const user = await authService.getCurrentUser();
  const licenses = licenseManagementService.getMyLicenses(user?.id ?? "");

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">My Licenses</h1>
      {licenses.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[#1F2937] p-10 text-center">
          <p className="text-sm text-gray-400">No licenses yet.</p>
          <p className="mt-1 text-xs text-gray-600">Licenses are issued after purchasing a product.</p>
          <Link
            href="/products"
            className="mt-3 inline-block rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-500"
          >
            Browse products
          </Link>
        </div>
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

