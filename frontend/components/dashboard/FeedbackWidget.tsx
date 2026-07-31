"use client";
// components/dashboard/FeedbackWidget.tsx
// Sprint R1.2 - Phase 1: floating feedback button, present on every
// dashboard page. Bug Report / Feature Request / General Feedback, all
// stored as a real Feedback row via /api/private/feedback.
// Sprint D1.0 - Rebuilt on the shared primitives (Modal, Button, Textarea,
// Toast) instead of hand-rolled overlay/panel/button markup in bg-
// indigo-600/border-[#1F2937] - the type selector is now Button's
// "secondary" vs a plain state, and the old in-modal success panel is now
// a toast (the platform's one confirmation pattern), closing the modal
// immediately instead of leaving it open on a dead-end screen.
import { useState } from "react";
import { usePathname } from "next/navigation";
import { FeedbackApi } from "@/services/api/FeedbackApi";
import type { FeedbackType } from "@/services/feedback/FeedbackService";
import Modal from "@/components/ui/Modal";
import Button from "@/components/ui/Button";
import Textarea from "@/components/ui/Textarea";
import { useToast } from "@/components/ui/Toast";

const TYPES: { value: FeedbackType; label: string }[] = [
  { value: "bug", label: "Bug Report" },
  { value: "feature", label: "Feature Request" },
  { value: "general", label: "General Feedback" },
];

export default function FeedbackWidget() {
  const pathname = usePathname();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<FeedbackType>("general");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    setOpen(false);
    setType("general");
    setMessage("");
    setError(null);
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
      close();
      toast.push("Thanks for the feedback - we read every submission.", "success");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not submit feedback. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <Button
        onClick={() => setOpen(true)}
        className="fixed bottom-6 right-6 z-40 !rounded-full shadow-floating"
      >
        Feedback
      </Button>

      <Modal open={open} onClose={close} title="Send feedback">
        <div className="flex gap-2">
          {TYPES.map((t) => (
            <Button key={t.value} size="sm" variant={type === t.value ? "primary" : "secondary"} onClick={() => setType(t.value)}>
              {t.label}
            </Button>
          ))}
        </div>

        <Textarea
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
          invalid={!!error}
          className="mt-4"
        />

        {error && <p className="mt-2 text-sm text-danger">{error}</p>}

        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={close}>
            Cancel
          </Button>
          <Button onClick={submit} loading={submitting}>
            {submitting ? "Sending..." : "Send feedback"}
          </Button>
        </div>
      </Modal>
    </>
  );
}
