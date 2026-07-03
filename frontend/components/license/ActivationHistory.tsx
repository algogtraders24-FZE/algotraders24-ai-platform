import type { License } from "@/types/license";

export default function ActivationHistory({ license }: { license: License }) {
  return (
    <div className="rounded-2xl bg-[#0C1324] border border-[#1F2937] p-6">
      <h3 className="font-bold mb-4">Activations</h3>
      <div className="flex justify-between text-sm text-gray-400">
        <span>Used</span>
        <span>{license.activations} / {license.maxActivations}</span>
      </div>
      <div className="mt-2 h-2 rounded-full bg-[#111827] overflow-hidden">
        <div
          className="h-full bg-blue-600"
          style={{ width: `${(license.activations / license.maxActivations) * 100}%` }}
        />
      </div>
    </div>
  );
}