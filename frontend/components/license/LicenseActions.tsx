export default function LicenseActions() {
  return (
    <div className="flex gap-3">
      <button className="bg-blue-600 hover:bg-blue-700 px-5 py-2 rounded-xl font-semibold transition">
        Download
      </button>
      <button className="border border-gray-600 hover:border-blue-500 px-5 py-2 rounded-xl font-semibold transition">
        Renew
      </button>
    </div>
  );
}