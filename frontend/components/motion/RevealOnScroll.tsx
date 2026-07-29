"use client";

// components/motion/RevealOnScroll.tsx
// Sprint H1.7 - Shared "institutional-grade motion" primitive: a subtle
// fade-and-rise applied once when a section scrolls into view. Purely
// aesthetic sequencing, not a claim about anything - unlike Explainable
// Intelligence or Architecture Visualization (which animate because the
// underlying process is genuinely sequential), this exists only to stop
// below-the-fold sections from popping in abruptly. Wraps server-rendered
// children without converting them to client components themselves - only
// this wrapper needs interactivity. Respects prefers-reduced-motion by
// rendering fully visible immediately.
import { useEffect, useRef, useState } from "react";

export default function RevealOnScroll({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setVisible(true);
      return;
    }

    const node = ref.current;
    if (!node) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0.15 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={`transition-all duration-700 ease-out ${visible ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0"} ${className}`}
    >
      {children}
    </div>
  );
}
