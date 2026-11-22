// lib/chart-engine/analyze-sound.ts
// Soft synthesized sounds for the Pro Chart "Analyze" scan (no audio files): a rising sweep while the scan runs and a
// two-note chime when the analysis completes. Only ever started from a user click. A mute switch is remembered in localStorage.
const KEY = "at24.chart.sound";

export function isSoundOn(): boolean {
  try {
    return localStorage.getItem(KEY) !== "off";
  } catch {
    return true;
  }
}

export function setSoundOn(on: boolean): void {
  try {
    localStorage.setItem(KEY, on ? "on" : "off");
  } catch {
    // storage can be blocked; the choice then lasts for this page view only
  }
}

let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  if (typeof window === "undefined") return null;
  try {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    if (!ctx) ctx = new Ctor();
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

/** Rising sweep for the duration of the scan. */
export function playScanSweep(durationMs = 2200): void {
  if (!isSoundOn()) return;
  const a = audio();
  if (!a) return;
  const t0 = a.currentTime;
  const d = durationMs / 1000;
  const osc = a.createOscillator();
  const sub = a.createOscillator();
  const gain = a.createGain();
  osc.type = "sine";
  sub.type = "triangle";
  osc.frequency.setValueAtTime(180, t0);
  osc.frequency.exponentialRampToValueAtTime(840, t0 + d);
  sub.frequency.setValueAtTime(90, t0);
  sub.frequency.exponentialRampToValueAtTime(420, t0 + d);
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(0.045, t0 + 0.25);
  gain.gain.setValueAtTime(0.045, t0 + d - 0.35);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + d);
  osc.connect(gain);
  sub.connect(gain);
  gain.connect(a.destination);
  osc.start(t0);
  sub.start(t0);
  osc.stop(t0 + d + 0.05);
  sub.stop(t0 + d + 0.05);
}

/** Two-note chime: analysis complete. */
export function playAnalysisComplete(): void {
  if (!isSoundOn()) return;
  const a = audio();
  if (!a) return;
  const t0 = a.currentTime;
  [[880, 0], [1318.5, 0.13]].forEach(([freq, delay]) => {
    const osc = a.createOscillator();
    const gain = a.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, t0 + delay);
    gain.gain.exponentialRampToValueAtTime(0.07, t0 + delay + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + delay + 0.55);
    osc.connect(gain);
    gain.connect(a.destination);
    osc.start(t0 + delay);
    osc.stop(t0 + delay + 0.6);
  });
}
