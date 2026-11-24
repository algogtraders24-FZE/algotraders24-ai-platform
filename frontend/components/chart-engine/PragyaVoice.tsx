"use client";
// components/chart-engine/PragyaVoice.tsx
// PRAGYA tab: talk to PRAGYA about the chart. The browser's own speech recognition turns the voice into text (tap to talk, never always listening,
// nothing is recorded or uploaded as audio by AT24) and the answer is read aloud with the browser's speech synthesis.
// The question goes to the same /api/private/pragya/analyze route as the Chat tab (measured facts only, claim rules, daily cap).
// Voice can ask questions and start the chart analysis. It can NEVER place an order: trades are sent only from the Trade tab with an explicit Confirm.
import { useCallback, useEffect, useRef, useState } from "react";

interface Turn { id: string; role: "user" | "assistant"; text: string }
type Phase = "idle" | "listening" | "thinking" | "speaking";

// minimal typing of the browser speech API (not in every TS lib)
interface RecAlt { transcript: string }
interface RecEvent { results: ArrayLike<ArrayLike<RecAlt>> }
interface Rec {
  lang: string; interimResults: boolean; continuous: boolean; maxAlternatives: number;
  onresult: ((e: RecEvent) => void) | null; onerror: ((e: { error: string }) => void) | null; onend: (() => void) | null;
  start: () => void; stop: () => void; abort: () => void;
}
type RecCtor = new () => Rec;

const uid = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);
const getCtor = (): RecCtor | null => {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: RecCtor; webkitSpeechRecognition?: RecCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
};

const ANALYZE = /\b(analy[sz]e|analysis|re-?analy[sz]e)\b|विश्लेषण|chart (dekh|dikha)/i;
const ORDER_NOW = /^\s*(please\s+)?(place|execute|send|buy|sell|open|close)\b|\b(order (kar|laga|bhej)|khareed|becho|trade (kar|laga))/i;

export default function PragyaVoice({ active, symbol, timeframe, getFacts, onAnalyze }: { active: boolean; symbol: string; timeframe: string; getFacts: () => string | null; onAnalyze: () => void }) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [lang, setLang] = useState<"en-IN" | "hi-IN">("en-IN");
  const [muted, setMuted] = useState(false);
  const [heard, setHeard] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [supported, setSupported] = useState(true);
  const recRef = useRef<Rec | null>(null);
  const phaseRef = useRef<Phase>("idle");
  phaseRef.current = phase;

  useEffect(() => { setSupported(getCtor() !== null && typeof window.speechSynthesis !== "undefined"); }, []);

  const stopAll = useCallback(() => {
    try { recRef.current?.abort(); } catch { /* already stopped */ }
    recRef.current = null;
    try { window.speechSynthesis?.cancel(); } catch { /* no synthesis */ }
    setPhase("idle");
  }, []);

  // leaving the tab (or the page) ends the microphone and the voice at once
  useEffect(() => { if (!active) stopAll(); }, [active, stopAll]);
  useEffect(() => stopAll, [stopAll]);

  const speak = useCallback((text: string) => {
    if (muted || typeof window === "undefined" || !window.speechSynthesis) { setPhase("idle"); return; }
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "en-IN";
    const voices = window.speechSynthesis.getVoices();
    const v = voices.find((x) => x.lang === "en-IN") ?? voices.find((x) => x.lang.startsWith("en"));
    if (v) u.voice = v;
    u.rate = 1;
    u.onend = () => setPhase("idle");
    u.onerror = () => setPhase("idle");
    setPhase("speaking");
    window.speechSynthesis.speak(u);
  }, [muted]);

  const reply = useCallback((text: string) => {
    setTurns((p) => [...p, { id: uid(), role: "assistant", text }]);
    speak(text);
  }, [speak]);

  const handle = useCallback(async (said: string) => {
    const q = said.trim();
    if (!q) { setPhase("idle"); return; }
    setTurns((p) => [...p, { id: uid(), role: "user", text: q }]);
    if (ORDER_NOW.test(q)) {
      reply("I cannot place or change orders by voice. Open the Trade tab, review the order and press Confirm yourself.");
      return;
    }
    if (ANALYZE.test(q) && q.split(/\s+/).length <= 6) {
      onAnalyze();
      reply("Analysing the chart now. The result appears in the Chat tab.");
      return;
    }
    const facts = getFacts();
    if (!facts) { reply("There are not enough candles on this chart yet for me to read it."); return; }
    setPhase("thinking");
    try {
      const res = await fetch("/api/private/pragya/analyze", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ symbol, timeframe, facts, question: q }) });
      const json = await res.json();
      if (json?.status === "ok" && typeof json.data?.text === "string") reply(json.data.text as string);
      else if (res.status === 429) { setError("Daily PRAGYA limit reached. Try again tomorrow."); setPhase("idle"); }
      else { setError("PRAGYA could not answer that from the chart's measured facts. Try asking it another way."); setPhase("idle"); }
    } catch {
      setError("PRAGYA is not reachable right now. Please try again.");
      setPhase("idle");
    }
  }, [getFacts, onAnalyze, reply, symbol, timeframe]);

  function listen() {
    if (phaseRef.current === "listening") { try { recRef.current?.stop(); } catch { /* ignore */ } return; }
    stopAll();
    setError(null);
    setHeard("");
    const Ctor = getCtor();
    if (!Ctor) { setSupported(false); return; }
    const rec = new Ctor();
    rec.lang = lang;
    rec.interimResults = true;
    rec.continuous = false;
    rec.maxAlternatives = 1;
    let finalText = "";
    rec.onresult = (e) => {
      let t = "";
      for (let i = 0; i < e.results.length; i++) t += e.results[i][0]?.transcript ?? "";
      finalText = t;
      setHeard(t);
    };
    rec.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") setError("Microphone access is blocked. Allow the microphone for this site in your browser, then tap the button again.");
      else if (e.error === "no-speech") setError("I did not hear anything. Tap the button and speak.");
      else if (e.error !== "aborted") setError("Voice input stopped (" + e.error + "). Try again.");
      setPhase("idle");
    };
    rec.onend = () => {
      recRef.current = null;
      if (phaseRef.current === "listening") {
        setHeard("");
        if (finalText.trim()) void handle(finalText); else setPhase("idle");
      }
    };
    recRef.current = rec;
    try { rec.start(); setPhase("listening"); } catch { setError("Could not start the microphone."); setPhase("idle"); }
  }

  const label = phase === "listening" ? "Listening… tap to finish" : phase === "thinking" ? "PRAGYA is reading the chart…" : phase === "speaking" ? "PRAGYA is speaking · tap to interrupt" : "Tap to talk";

  if (!supported) {
    return (
      <div className="flex flex-col items-center gap-3 pt-10 text-center">
        <div className="flex h-20 w-20 items-center justify-center rounded-full bg-gold/15 text-3xl text-gold">✦</div>
        <p className="text-[16px] font-semibold text-text">Voice is not available in this browser</p>
        <p className="text-[13px] leading-relaxed text-text-3">Voice input needs Chrome, Edge or Safari. The Chat tab answers the same questions in text.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-3 pt-6 text-center">
      <div className="flex items-center gap-2 text-[12.5px]">
        <div className="flex gap-1 rounded-full bg-ink-3 p-0.5">
          {(["en-IN", "hi-IN"] as const).map((l) => (
            <button key={l} type="button" onClick={() => setLang(l)} disabled={phase !== "idle"} className={`rounded-full px-3 py-1 ${lang === l ? "bg-gold font-medium text-ink" : "text-text-3 hover:text-text"}`}>{l === "en-IN" ? "English" : "हिन्दी"}</button>
          ))}
        </div>
        <button type="button" onClick={() => { setMuted((m) => !m); try { window.speechSynthesis?.cancel(); } catch { /* none */ } }} className="rounded-full border border-border px-3 py-1 text-text-3 hover:text-text">{muted ? "Voice replies off" : "Voice replies on"}</button>
      </div>

      <button
        type="button"
        onClick={() => (phase === "speaking" || phase === "thinking" ? stopAll() : listen())}
        aria-label={label}
        className={`relative flex h-24 w-24 items-center justify-center rounded-full text-3xl transition ${phase === "listening" ? "bg-gold text-ink" : "bg-gold/15 text-gold hover:bg-gold/25"}`}
      >
        {phase === "listening" && <span className="absolute inset-0 animate-ping rounded-full bg-gold/30" aria-hidden="true" />}
        <span className="relative">{phase === "listening" ? "●" : "✦"}</span>
      </button>
      <p className="text-[13px] font-medium text-text" aria-live="polite">{label}</p>
      {heard && <p className="max-w-full rounded-md bg-ink-3 px-3 py-1.5 text-[13px] italic text-text-2">{heard}</p>}
      {error && <p className="text-[12.5px] text-red-400">{error}</p>}

      {turns.length === 0 ? (
        <p className="px-2 text-[12.5px] leading-relaxed text-text-3">Try: &quot;What is the trend?&quot;, &quot;Where is the entry?&quot;, &quot;What is my risk?&quot; or &quot;Analyze the chart&quot;. Voice never places orders: trades are sent only from the Trade tab with your Confirm.</p>
      ) : (
        <div className="max-h-[calc(100vh-420px)] w-full space-y-2 overflow-y-auto text-left text-[13.5px]">
          {turns.slice(-6).map((t) => t.role === "user"
            ? <div key={t.id} className="ml-auto max-w-[90%] rounded-lg bg-ink-4 px-3 py-2 text-text">{t.text}</div>
            : <div key={t.id} className="rounded-lg border border-gold/30 bg-gold/5 px-3 py-2 leading-relaxed text-text-2"><span className="mb-1 block text-[11.5px] font-semibold uppercase tracking-wide text-gold">✦ PRAGYA</span>{t.text}</div>)}
        </div>
      )}
      <p className="px-2 text-[11.5px] text-text-3">Your browser converts speech to text and reads the answer aloud. AT24 stores no audio. Educational description of the chart, not a prediction.</p>
    </div>
  );
}
