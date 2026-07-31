// components/ai/ThinkingIndicator.tsx
export default function ThinkingIndicator({ speed = 1 }: { speed?: number }) {
  const dur = `${1 / speed}s`;
  return (
    <div className="flex justify-start">
      <div className="flex items-center gap-1 rounded-2xl border border-border bg-ink-2 px-4 py-3">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="h-2 w-2 animate-bounce rounded-full bg-ink-4"
            style={{ animationDuration: dur, animationDelay: `${i * 0.15}s` }}
          />
        ))}
      </div>
    </div>
  );
}