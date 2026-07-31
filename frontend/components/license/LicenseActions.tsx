export default function LicenseActions() {
  return (
    <div className="flex gap-3">
      <button className="bg-gold hover:brightness-110 px-5 py-2 rounded-xl font-semibold transition">
        Download
      </button>
      <button className="border border-border hover:border-gold px-5 py-2 rounded-xl font-semibold transition">
        Renew
      </button>
    </div>
  );
}