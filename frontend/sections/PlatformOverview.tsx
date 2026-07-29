"use client";

// sections/PlatformOverview.tsx
// Sprint H1.4 Phase 2, upgraded in H1.5 - "What is Algotraders24 AI?" Four
// real capabilities, each labeled honestly: the AI Assistant and Knowledge
// Base are live, database-backed features today (app/dashboard/assistant,
// app/dashboard/knowledge); Market Intelligence and Explainable Analysis
// describe the real, extensively-validated deterministic pipeline built
// across Sprint 15D, rolling out across the platform - neither is
// overclaimed as already powering every dashboard page. No marketing
// exaggeration, no invented features.
//
// H1.5: each card expands on click to reveal one more real, technical
// sentence about HOW that capability actually works - a genuine second
// layer of information, not decoration. A small client component only
// because that expand/collapse state is the interactivity itself.
import { useState } from "react";
import { ChevronDown } from "lucide-react";

const CAPABILITIES = [
  {
    status: "Available today",
    title: "AI Assistant",
    description:
      "A conversational interface grounded in real evidence, not a generic chatbot. Ask a question in plain language and get an answer backed by the same reasoning the platform uses everywhere else.",
    detail:
      "Every response is generated from the Knowledge Base's retrieval layer, not from open-ended completion alone — the Assistant only draws on what's actually indexed.",
  },
  {
    status: "Available today",
    title: "Knowledge Base",
    description:
      "A searchable, retrieval-augmented knowledge layer the Assistant draws on for grounded answers - built on real documents, not improvised from memory.",
    detail:
      "Documents are chunked, embedded, and retrieved with vector similarity search — the same store the Assistant queries before it answers anything.",
  },
  {
    status: "Engineered pipeline",
    title: "Market Intelligence",
    description:
      "Price and news evidence is collected, deduplicated, and reasoned about through a deterministic pipeline - evidence in, reasoning out, never a black-box prediction.",
    detail:
      "Runs through Evidence Collection, Fusion, and Ranking before any reasoning happens — the same pipeline shown in full below.",
  },
  {
    status: "Engineered pipeline",
    title: "Explainable Analysis",
    description:
      "Every analysis carries its supporting evidence, opposing evidence, stated limitations, a confidence score, and a risk level - nothing hidden behind a single number.",
    detail:
      "Combines the Reasoning, Risk, and Confidence engines into one explainable output — each engine scored and disclosed separately, never averaged into one score.",
  },
] as const;

export default function PlatformOverview() {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  return (
    <section className="bg-ink py-24 text-text">
      <div className="mx-auto max-w-7xl px-6">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-gold">Platform Overview</p>
          <h2 className="mt-4 font-display text-4xl font-medium md:text-5xl">What is Algotraders24 AI?</h2>
          <p className="mt-5 text-lg text-text-2">
            Four real capabilities working from the same deterministic foundation — not four disconnected tools.
          </p>
        </div>

        <div className="mt-16 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {CAPABILITIES.map((capability, index) => {
            const open = openIndex === index;
            return (
              <div
                key={capability.title}
                className={`rounded-card border bg-ink-2 p-8 transition-colors ${open ? "border-gold" : "border-border hover:border-gold"}`}
              >
                <span className="inline-block rounded-control border border-gold/30 bg-gold/10 px-3 py-1 text-xs font-medium text-gold">
                  {capability.status}
                </span>
                <h3 className="mt-5 text-xl font-semibold">{capability.title}</h3>
                <p className="mt-3 text-sm leading-6 text-text-2">{capability.description}</p>

                <button
                  type="button"
                  onClick={() => setOpenIndex(open ? null : index)}
                  aria-expanded={open}
                  className="mt-5 flex items-center gap-1.5 text-sm font-medium text-gold transition-colors hover:text-gold-strong"
                >
                  {open ? "Show less" : "How it works"}
                  <ChevronDown
                    className={`h-4 w-4 transition-transform duration-300 ${open ? "rotate-180" : ""}`}
                    aria-hidden="true"
                  />
                </button>

                <div
                  className={`grid transition-all duration-300 ease-out ${open ? "mt-3 grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`}
                >
                  <p className="overflow-hidden text-sm leading-6 text-text-2">{capability.detail}</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
