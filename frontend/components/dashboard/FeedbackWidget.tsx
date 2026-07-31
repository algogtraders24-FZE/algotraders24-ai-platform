"use client";
// components/dashboard/FeedbackWidget.tsx
// Sprint R1.2 - Phase 1: floating feedback button, present on every
// dashboard page (rendered once in app/dashboard/layout.tsx, outside the
// per-page content). Bug Report / Feature Request / General Feedback, all
// stored as a real Feedback row via /api/private/feedback.
import { useState } from "react";
import { usePathname } from "next/navigation";
import { FeedbackApi } from "@/services/api/FeedbackApi";
import type { FeedbackType } from "@/services/feedback/FeedbackService";

const TYPES: { value: FeedbackType; label: string }[] = [
  { value: "bug", label: "Bug Report" },
  { value: "feature", label: "Feature Request" },
  { value: "general", label: "General Feedback" },
];

export default function FeedbackWidget() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<FeedbackType>("general");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const reset = () => {
    setType("general");
    setMessage("");
    setError(null);
    setSuccess(false);
  };

  const close = () => {
    setOpen(false);
    reset();
  };

  const submit = async () => {
    if (message.trim().length === 0) {
      setError("Please describe your feedback before submitting.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await FeedbackApi.submit(type, message.trim(), pathname ?? "");
      setSuccess(true);
      setMessage("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not submit feedback. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-6 right-6 z-40 flex items-center gap-2 rounded-full bg-indigo-600 px-4 py-3 text-sm font-semibold text-white shadow-lg transition hover:bg-indigo-500"
      >
        Feedback
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-end bg-black/50 p-4 sm:items-center sm:justify-center">
          <div className="w-full max-w-md rounded-2xl border border-[#1F2937] bg-[#0C1324] p-6 text-white shadow-2xl">
            {success ? (
              <div className="text-center">
                <p className="text-lg font-semibold">Thanks for the feedback</p>
                <p className="mt-2 text-sm text-gray-400">
                  We read every submission - this helps shape what we build next for the beta.
                </p>
                <button
                  type="button"
                  onClick={close}
                  className="mt-5 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-500"
                >
                  Close
                </button>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-semibold">Send feedback</h2>
                  <button type="button" onClick={close} className="text-gray-500 hover:text-gray-300" aria-label="Close">
                    &times;
                  </button>
                </div>

                <div className="mt-4 flex gap-2">
                  {TYPES.map((t) => (
                    <button
                      key={t.value}
                      type="button"
                      onClick={() => setType(t.value)}
                      className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition ${
                        type === t.value
                          ? "border-indigo-500 bg-indigo-600/20 text-indigo-300"
                          : "border-[#1F2937] text-gray-400 hover:border-gray-600"
                      }`}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>

                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  rows={5}
                  maxLength={2000}
                  placeholder={
                    type === "bug"
                      ? "What went wrong? Steps to reproduce help a lot."
                      : type === "feature"
                        ? "What would you like to see added or changed?"
                        : "Anything on your mind about the platform?"
                  }
                  className="mt-4 w-full rounded-lg border border-[#1F2937] bg-[#111827] p-3 text-sm text-white outline-none focus:border-indigo-500"
                />

                {error && <p className="mt-2 text-sm text-red-400">{error}</p>}

                <div className="mt-4 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={close}
                    className="rounded-lg border border-[#1F2937] px-4 py-2 text-sm text-gray-300 transition hover:bg-[#111827]"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={submit}
                    disabled={submitting}
                    className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-500 disabled:opacity-50"
                  >
                    {submitting ? "Sending..." : "Send feedback"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
