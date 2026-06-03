import { useEffect, useRef } from "react";

/**
 * Anti-autoclicker / userbot detection.
 * Watches global pointerdown events. If we see a series of clicks that
 * land in (almost) the same pixel AND share a (nearly) constant interval
 * within [10ms .. 1000ms] (with ≤0.5s jitter tolerated), we treat it
 * as automation and call `onDetected` once.
 */
export function useAntiClicker(onDetected: () => void, enabled: boolean = true) {
  const eventsRef = useRef<{ x: number; y: number; t: number }[]>([]);
  const firedRef = useRef(false);

  useEffect(() => {
    if (!enabled) return;
    firedRef.current = false;

    const onDown = (e: PointerEvent) => {
      if (firedRef.current) return;
      const now = performance.now();
      const arr = eventsRef.current;
      arr.push({ x: e.clientX, y: e.clientY, t: now });
      // keep last 6
      if (arr.length > 6) arr.shift();
      if (arr.length < 4) return;

      // Last 4 clicks
      const last = arr.slice(-4);
      // 1px ~ "millimeter precision" tolerance — autoclickers hit identical pixels
      const dx = Math.max(...last.map(p => p.x)) - Math.min(...last.map(p => p.x));
      const dy = Math.max(...last.map(p => p.y)) - Math.min(...last.map(p => p.y));
      if (dx > 3 || dy > 3) return;

      // Intervals
      const intervals: number[] = [];
      for (let i = 1; i < last.length; i++) intervals.push(last[i].t - last[i - 1].t);
      const minI = Math.min(...intervals);
      const maxI = Math.max(...intervals);
      if (minI < 10 || maxI > 1000) return;        // out of suspicious window
      if (maxI - minI > 500) return;                // too jittery → likely human
      // Suspicious series detected
      firedRef.current = true;
      try { onDetected(); } catch {}
    };

    window.addEventListener("pointerdown", onDown, { capture: true });
    return () => window.removeEventListener("pointerdown", onDown, { capture: true } as any);
  }, [enabled, onDetected]);
}
