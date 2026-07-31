import type { License } from "@/types/license";

export default function ActivationHistory({ license }: { license: License }) {
  return (
    <div className="rounded-2xl bg-ink-2 border border-border p-6">
      <h3 className="font-bold mb-4">Activations</h3>
      <div className="flex justify-between text-sm text-text-2">
        <span>Used</span>
        <span>{license.activations} / {license.maxActivations}</span>
      </div>
      <div className="mt-2 h-2 rounded-full bg-ink-3 overflow-hidden">
        <div
          className="h-full bg-gold"
          style={{ width: `${(license.activations / license.maxActivations) * 100}%` }}
        />
      </div>
    </div>
  );
}