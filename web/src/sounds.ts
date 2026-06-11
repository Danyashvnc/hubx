let ctx: AudioContext | null = null;
let enabled = true;
let presenceMuted = false;

function getCtx(): AudioContext | null {
  if (!ctx) {
    const AC = window.AudioContext || (window as any).webkitAudioContext;
    if (!AC) return null;
    try { ctx = new AC(); } catch { return null; }
  }
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
  return ctx;
}

export function unlockAudio() { getCtx(); }
export function setSoundEnabled(v: boolean) { enabled = v; }
export function isSoundEnabled() { return enabled; }
export function setPresenceMuted(v: boolean) { presenceMuted = v; }

function blip(freq: number, t0: number, dur: number, gain = 0.05, type: OscillatorType = "sine") {
  const c = getCtx();
  if (!c) return;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.value = freq;
  o.connect(g); g.connect(c.destination);
  const t = c.currentTime + t0;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.014);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.start(t);
  o.stop(t + dur + 0.03);
}

export function playLogin() {
  if (!enabled || presenceMuted) return;
  blip(659.25, 0, 0.18, 0.045);
  blip(783.99, 0.10, 0.18, 0.045);
  blip(1046.5, 0.20, 0.28, 0.05);
}

export function playMessage() {
  if (!enabled || presenceMuted) return;
  blip(880.0, 0, 0.10, 0.045);
  blip(1174.7, 0.07, 0.14, 0.04);
}
