import { useEffect, useRef, useState } from "react";

/** Tweens a number toward `value` so totals settle instead of snapping.
 *  Driven by rAF (display-synced) rather than a timer, and it hands back the
 *  exact target on the final frame so the figure a customer pays is never a
 *  rounded intermediate. Reduced motion gets the value immediately. */
export function useCountUp(value: number, duration = 420): number {
  const [display, setDisplay] = useState(value);
  const fromRef = useRef(value);
  const frameRef = useRef(0);

  useEffect(() => {
    const from = fromRef.current;
    if (from === value) return;

    // Snap instead of tweening when there is nobody to watch it. rAF does
    // not run in a hidden tab, so a tween started there would leave the
    // figure frozen at a stale value — which matters more now that this
    // drives an item count rather than a decorative total.
    if (
      typeof window === "undefined" ||
      document.hidden ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      fromRef.current = value;
      setDisplay(value);
      return;
    }

    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      // Same ease-out family as --ease-fluid: fast first, gentle settle.
      const eased = 1 - Math.pow(1 - t, 3);
      if (t < 1) {
        setDisplay(Math.round(from + (value - from) * eased));
        frameRef.current = requestAnimationFrame(step);
      } else {
        fromRef.current = value;
        setDisplay(value);
      }
    };
    frameRef.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frameRef.current);
  }, [value, duration]);

  return display;
}
