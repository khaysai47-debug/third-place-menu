// DecryptedText — the owner name resolving out of scramble, once, on view.
//
// Adapted from the React Bits DecryptedText component. React Bits wraps each
// character in a `motion.span` that animates nothing for this effect — the
// scramble itself is a plain interval — so this adaptation drops the `motion`
// dependency and keeps only what does the work: an interval that reveals the
// real characters one at a time, gated on the element entering view by an
// IntersectionObserver.
//
// Restraint: settled characters are the caller's `className` (gold); the
// still-scrambling ones are `encryptedClassName` (soft vermillion). Respects
// prefers-reduced-motion by showing the final text immediately, no scramble.

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { cn } from "@/lib/utils";

type RevealDirection = "start" | "end" | "center";

interface DecryptedTextProps {
  text: string;
  speed?: number;
  maxIterations?: number;
  sequential?: boolean;
  revealDirection?: RevealDirection;
  characters?: string;
  className?: string;
  encryptedClassName?: string;
  parentClassName?: string;
  /** Per-index override for settled characters — lets one run settle
   *  different ranges in different colors (greeting cream, name gold)
   *  without splitting into two effects. Falls back to `className`. */
  settledClassName?: (index: number) => string | undefined;
  /** "view" reveals once on entering the viewport; "mount" on first paint. */
  animateOn?: "view" | "mount";
  style?: CSSProperties;
}

const DEFAULT_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz1234567890";

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true
  );
}

export function DecryptedText({
  text,
  speed = 50,
  maxIterations = 10,
  sequential = false,
  revealDirection = "start",
  characters = DEFAULT_CHARS,
  className = "",
  encryptedClassName = "",
  parentClassName = "",
  settledClassName,
  animateOn = "view",
  style,
}: DecryptedTextProps) {
  const [displayText, setDisplayText] = useState(text);
  const [revealed, setRevealed] = useState<Set<number>>(() => new Set());
  const [scrambling, setScrambling] = useState(false);
  // Reduced motion → treat everything as already revealed, never scramble.
  const [reduced] = useState(prefersReducedMotion);
  const startedRef = useRef(false);
  const containerRef = useRef<HTMLSpanElement>(null);

  // The scramble run. Fires once (guarded by startedRef) when triggered.
  useEffect(() => {
    if (reduced || !scrambling) return;

    const nextRevealIndex = (revealedSet: Set<number>): number => {
      switch (revealDirection) {
        case "end":
          return text.length - 1 - revealedSet.size;
        case "center": {
          const mid = Math.floor(text.length / 2);
          const offset = Math.floor(revealedSet.size / 2);
          const i = revealedSet.size % 2 === 0 ? mid + offset : mid - offset - 1;
          if (i >= 0 && i < text.length && !revealedSet.has(i)) return i;
          for (let k = 0; k < text.length; k++) if (!revealedSet.has(k)) return k;
          return 0;
        }
        default:
          return revealedSet.size;
      }
    };

    const scrambleChar = () =>
      characters[Math.floor(Math.random() * characters.length)] ?? "";

    let iteration = 0;
    const interval = setInterval(() => {
      setRevealed((prev) => {
        if (sequential) {
          if (prev.size >= text.length) {
            clearInterval(interval);
            setScrambling(false);
            return prev;
          }
          const next = new Set(prev);
          next.add(nextRevealIndex(prev));
          setDisplayText(
            text
              .split("")
              .map((ch, i) => (next.has(i) || ch === " " ? ch : scrambleChar()))
              .join(""),
          );
          return next;
        }

        // Non-sequential: scramble the whole word for maxIterations, then settle.
        iteration += 1;
        if (iteration >= maxIterations) {
          clearInterval(interval);
          setScrambling(false);
          setDisplayText(text);
          return new Set(text.split("").map((_, i) => i));
        }
        setDisplayText(
          text
            .split("")
            .map((ch) => (ch === " " ? ch : scrambleChar()))
            .join(""),
        );
        return prev;
      });
    }, speed);

    return () => clearInterval(interval);
  }, [
    scrambling,
    reduced,
    text,
    characters,
    sequential,
    revealDirection,
    maxIterations,
    speed,
  ]);

  // Trigger: on mount, or when the element scrolls into view. Runs once.
  useEffect(() => {
    if (reduced || animateOn === "mount") {
      if (animateOn === "mount" && !reduced && !startedRef.current) {
        startedRef.current = true;
        setScrambling(true);
      }
      return;
    }
    const el = containerRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && !startedRef.current) {
            startedRef.current = true;
            setScrambling(true);
            observer.disconnect();
          }
        }
      },
      { threshold: 0.4 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [animateOn, reduced]);

  return (
    <span ref={containerRef} className={parentClassName} style={style}>
      {/* Screen readers get the real name, never the scramble. */}
      <span className="sr-only">{text}</span>
      <span aria-hidden>
        {displayText.split("").map((ch, i) => {
          const settled = reduced || revealed.has(i) || !scrambling;
          const settledCls = settledClassName?.(i) ?? className;
          return (
            <span key={i} className={cn(settled ? settledCls : encryptedClassName)}>
              {ch}
            </span>
          );
        })}
      </span>
    </span>
  );
}

export default DecryptedText;
