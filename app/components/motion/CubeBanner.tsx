"use client";
import { useEffect, useRef, useState, type PointerEvent } from "react";
import { limitedHardware } from "./preferences";

export default function CubeBanner({ children }: { children: React.ReactNode }) {
  const section = useRef<HTMLElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const lastPointer = useRef<{ x: number; y: number } | null>(null);
  const move = useRef<((x: number, y: number) => void) | null>(null);
  const [active, setActive] = useState(false);
  const failed = useRef(false);
  const eligible = () => typeof matchMedia === "function" && typeof ResizeObserver !== "undefined" && typeof IntersectionObserver !== "undefined" && !failed.current && !limitedHardware() && matchMedia("(min-width:1024px) and (hover:hover) and (pointer:fine) and (prefers-reduced-motion:no-preference)").matches;
  function pointer(event: PointerEvent<HTMLElement>) {
    if (event.pointerType !== "mouse" || !eligible()) { setActive(false); return; }
    lastPointer.current = { x: event.clientX, y: event.clientY };
    setActive(true);
    move.current?.(event.clientX, event.clientY);
  }
  useEffect(() => {
    if (typeof matchMedia !== "function") return;
    const query = matchMedia("(min-width:1024px) and (hover:hover) and (pointer:fine) and (prefers-reduced-motion:no-preference)");
    const stop = () => setActive(false);
    const change = () => { if (!query.matches) stop(); };
    const visibility = () => { if (document.hidden) stop(); };
    window.addEventListener("blur", stop);
    document.addEventListener("visibilitychange", visibility);
    query.addEventListener("change", change);
    const observer = typeof IntersectionObserver !== "undefined" ? new IntersectionObserver(entries => { if (!entries[0].isIntersecting) stop(); }) : null;
    if (section.current) observer?.observe(section.current);
    return () => { window.removeEventListener("blur", stop); document.removeEventListener("visibilitychange", visibility); query.removeEventListener("change", change); observer?.disconnect(); };
  }, []);
  useEffect(() => {
    if (!active || !host.current) return;
    const target = host.current;
    let cancelled = false;
    let dispose: (() => void) | undefined;
    import("./cube-surface").then(({ mountCubes }) => {
      if (cancelled) return;
      const surface = mountCubes(target, () => { failed.current = true; setActive(false); });
      dispose = surface.dispose;
      move.current = surface.pointer;
      if (lastPointer.current) surface.pointer(lastPointer.current.x, lastPointer.current.y);
    }).catch(() => { if (!cancelled) { console.warn("Decorative motion unavailable; using static banner."); failed.current = true; setActive(false); } });
    return () => { cancelled = true; move.current = null; dispose?.(); };
  }, [active]);
  return <section ref={section} className="feature-banner cube-banner" onPointerEnter={pointer} onPointerMove={pointer} onPointerLeave={() => setActive(false)} onPointerCancel={() => setActive(false)}>{active && <div ref={host} className="cube-surface" aria-hidden="true"/>}{children}</section>;
}
