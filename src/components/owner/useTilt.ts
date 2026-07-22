import { useCallback, useEffect, useRef, useState } from "react";

/** True when the device has a real pointer and the user hasn't asked for
 *  reduced motion. Read once on mount and kept in sync by media-query
 *  listeners — both are device/preference facts, not per-frame state, and
 *  re-reading them inside a pointermove handler would cost a style recalc on
 *  every single event. */
function useSpatialPointer(): boolean {
  const [ok, setOk] = useState(false);
  useEffect(() => {
    const fine = window.matchMedia("(hover: hover) and (pointer: fine)");
    const still = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setOk(fine.matches && !still.matches);
    sync();
    fine.addEventListener("change", sync);
    still.addEventListener("change", sync);
    return () => {
      fine.removeEventListener("change", sync);
      still.removeEventListener("change", sync);
    };
  }, []);
  return ok;
}

/** Tilts a lacquer slab toward the pointer and drags a gold highlight across
 *  it — the console's one spatial interaction.
 *
 *  Values are written straight onto the node as CSS custom properties. They
 *  never pass through React state: a pointermove that re-rendered the
 *  dashboard would drop frames the moment the order feed is also updating.
 *
 *  The CSS transition does the smoothing, which also makes the motion
 *  interruptible — moving the pointer re-targets a card that is still
 *  settling instead of restarting it from flat.
 *
 *  The bounding rect is measured once per hover, not per move: reading it
 *  inside the move handler forces a synchronous layout on every event.
 *
 *  Returns a ref typed as the base element so the same hook can drive a
 *  <div> slab or a <button> one; call sites narrow it with a single cast. */
export function useTilt(maxDeg = 4) {
  const ref = useRef<HTMLElement>(null);
  const rect = useRef<DOMRect | null>(null);
  const spatial = useSpatialPointer();

  const onPointerEnter = useCallback(() => {
    if (!spatial || !ref.current) return;
    rect.current = ref.current.getBoundingClientRect();
    ref.current.style.willChange = "transform";
  }, [spatial]);

  const onPointerMove = useCallback(
    (e: { clientX: number; clientY: number }) => {
      const el = ref.current;
      const r = rect.current;
      if (!spatial || !el || !r || r.width === 0 || r.height === 0) return;
      const px = (e.clientX - r.left) / r.width;
      const py = (e.clientY - r.top) / r.height;
      el.style.setProperty("--oc-rx", `${(px - 0.5) * 2 * maxDeg}deg`);
      el.style.setProperty("--oc-ry", `${(0.5 - py) * 2 * maxDeg}deg`);
      el.style.setProperty("--oc-mx", `${px * 100}%`);
      el.style.setProperty("--oc-my", `${py * 100}%`);
    },
    [spatial, maxDeg],
  );

  const onPointerLeave = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    rect.current = null;
    el.style.willChange = "";
    // Settle back to flat through the same transition it tilted with, so
    // leaving a card mirrors the path it took on the way in.
    el.style.setProperty("--oc-rx", "0deg");
    el.style.setProperty("--oc-ry", "0deg");
  }, []);

  return { ref, onPointerEnter, onPointerMove, onPointerLeave, spatial };
}
