import { useEffect, useRef } from "react";

/**
 * Anti-autoclicker / userbot detection based on a cumulative
 * "suspicion score" that grows from multiple behavioural signals
 * and decays during natural human pauses.
 *
 * The hook NEVER blocks on a single event. `onDetected` fires only
 * once, when the accumulated score crosses THRESHOLD.
 *
 * Signals:
 *  - Interval regularity (MAD / median  →  bots have low variance, even
 *    "anti-detect" jitter of ±10ms is caught when median is ~constant)
 *  - Coordinate clustering (≥80% of recent clicks within 8px of a hot
 *    centre — catches autoclickers that nudge cursor by 3-4px)
 *  - Cyclic patterns (A→B→A→B… or A→B→C repeated)
 *  - Sustained no-pause activity (>90 min without ≥3-min pause)
 */

type Ev = { x: number; y: number; t: number };

const WINDOW = 30;
// Высокий порог: живой человек его почти никогда не достигнет.
// Чтобы добраться до 16, нужно несколько ДЕСЯТКОВ секунд устойчиво
// роботизированных кликов подряд — реальный автокликер/userbot, а не
// случайная быстрая серия нажатий.
const SCORE_THRESHOLD = 16;
const TICK_MS = 1000;
const NATURAL_PAUSE_MS = 2000;
const DECAY_EVERY_MS = 15_000;
const NO_PAUSE_LIMIT_MS = 90 * 60 * 1000;
const LONG_PAUSE_MS = 3 * 60 * 1000;

function median(a: number[]) {
  const s = [...a].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function intervalRegularityScore(ev: Ev[]): number {
  if (ev.length < 15) return 0;
  const intervals: number[] = [];
  for (let i = 1; i < ev.length; i++) intervals.push(ev[i].t - ev[i - 1].t);
  const med = median(intervals);
  if (med < 100 || med > 10_000) return 0;
  const mad = median(intervals.map((v) => Math.abs(v - med)));
  const ratio = mad / med;
  // ratio < 0.05 → very robotic; ~0.15 borderline
  if (ratio < 0.04) return 4;
  if (ratio < 0.08) return 3;
  if (ratio < 0.12) return 2;
  if (ratio < 0.18) return 1;
  return 0;
}

function clusterScore(ev: Ev[]): number {
  if (ev.length < 15) return 0;
  // greedy: pick last point as a centre, count neighbours within 8px,
  // repeat for a few points to find best hot centre
  let best = 0;
  for (let i = ev.length - 1; i >= Math.max(0, ev.length - 5); i--) {
    const c = ev[i];
    let n = 0;
    for (const p of ev) {
      const dx = p.x - c.x, dy = p.y - c.y;
      if (dx * dx + dy * dy <= 64) n++;
    }
    if (n > best) best = n;
  }
  const frac = best / ev.length;
  if (frac >= 0.95) return 3;
  if (frac >= 0.85) return 2;
  if (frac >= 0.75) return 1;
  return 0;
}

function cyclicPatternScore(ev: Ev[]): number {
  if (ev.length < 12) return 0;
  // Quantise to 16px grid and build a symbol string
  const syms = ev.map((p) => `${Math.round(p.x / 16)},${Math.round(p.y / 16)}`);
  let best = 0;
  for (let len = 2; len <= 4; len++) {
    if (syms.length < len * 3) continue;
    for (let start = 0; start <= syms.length - len; start++) {
      const pat = syms.slice(start, start + len).join("|");
      let repeats = 0;
      for (let j = start; j + len <= syms.length; j += len) {
        if (syms.slice(j, j + len).join("|") === pat) repeats++;
        else break;
      }
      if (repeats > best) best = repeats;
    }
  }
  if (best >= 12) return 5;
  if (best >= 9) return 4;
  if (best >= 7) return 3;
  if (best >= 5) return 2;
  return 0;
}

export function useAntiClicker(onDetected: () => void, enabled: boolean = true) {
  const evRef = useRef<Ev[]>([]);
  const scoreRef = useRef(0);
  const lastEvtRef = useRef<number>(performance.now());
  const lastDecayRef = useRef<number>(performance.now());
  const sessionStartRef = useRef<number>(performance.now());
  const lastLongPauseRef = useRef<number>(performance.now());
  const firedRef = useRef(false);

  useEffect(() => {
    if (!enabled) return;
    firedRef.current = false;
    scoreRef.current = 0;
    evRef.current = [];
    sessionStartRef.current = performance.now();
    lastLongPauseRef.current = performance.now();

    const onDown = (e: PointerEvent) => {
      const now = performance.now();
      const sinceLast = now - lastEvtRef.current;
      if (sinceLast >= LONG_PAUSE_MS) lastLongPauseRef.current = now;
      lastEvtRef.current = now;
      const arr = evRef.current;
      arr.push({ x: e.clientX, y: e.clientY, t: now });
      if (arr.length > WINDOW) arr.shift();
    };
    // any natural human movement counts toward decay
    const onMove = (e: PointerEvent) => {
      // big movement → mark as "human-ish"
      const arr = evRef.current;
      const last = arr[arr.length - 1];
      if (!last) return;
      const dx = e.clientX - last.x, dy = e.clientY - last.y;
      if (dx * dx + dy * dy > 900) lastEvtRef.current = performance.now();
    };

    window.addEventListener("pointerdown", onDown, { capture: true });
    window.addEventListener("pointermove", onMove, { passive: true });

    const tick = window.setInterval(() => {
      if (firedRef.current) return;
      const now = performance.now();

      // Add scores
      const ev = evRef.current;
      let add = 0;
      add += intervalRegularityScore(ev);
      add += clusterScore(ev);
      add += cyclicPatternScore(ev);

      // Sustained activity bonus
      const sinceLongPause = now - lastLongPauseRef.current;
      if (sinceLongPause > NO_PAUSE_LIMIT_MS) {
        const extraMin = (sinceLongPause - NO_PAUSE_LIMIT_MS) / 60_000;
        add += Math.min(5, Math.floor(extraMin / 15) + 1);
      }

      // Decay if natural pause happened recently
      if (now - lastDecayRef.current >= DECAY_EVERY_MS) {
        lastDecayRef.current = now;
        if (now - lastEvtRef.current > NATURAL_PAUSE_MS) {
          scoreRef.current = Math.max(0, scoreRef.current - 1);
        }
      }

      // Only the strongest signal of this tick is added (avoid stacking)
      // but require at least 2 indicators to actually push the needle
      if (add > 0) {
        // dampen: we don't want a single suspicious tick to dominate
        scoreRef.current += Math.min(3, add * 0.4);
      }

      if (scoreRef.current >= SCORE_THRESHOLD && !firedRef.current) {
        firedRef.current = true;
        try { onDetected(); } catch {}
      }
    }, TICK_MS);

    return () => {
      window.removeEventListener("pointerdown", onDown, { capture: true } as any);
      window.removeEventListener("pointermove", onMove as any);
      window.clearInterval(tick);
    };
  }, [enabled, onDetected]);
}
