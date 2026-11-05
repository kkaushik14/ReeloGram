"use client";
import { useEffect, useState } from "react";
import { limitedHardware } from "./preferences";

export default function Headline({ text, level = 1 }: { text: string; level?: 1 | 2 }) {
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => {
    if (typeof matchMedia !== "function") return;
    const query = matchMedia("(prefers-reduced-motion: reduce)");
    let timer: ReturnType<typeof setTimeout> | undefined;
    let position = 0;
    const characters = Array.from(text);
    const complete = () => { clearTimeout(timer); setCount(null); };
    const change = () => { if (query.matches) complete(); };
    if (!query.matches && !limitedHardware()) {
      setCount(0);
      const next = () => {
        position++;
        setCount(position);
        if (position < characters.length) timer = setTimeout(next, 45);
      };
      timer = setTimeout(next, 45);
    }
    query.addEventListener("change", change);
    return () => { clearTimeout(timer); query.removeEventListener("change", change); };
  }, [text]);
  const Tag = level === 1 ? "h1" : "h2";
  return <Tag className="animated-headline"><span className="sr-only">{text}</span><span aria-hidden="true" className="headline-reveal"><span className="headline-measure">{text}</span><span className="headline-ink">{count === null ? text : Array.from(text).slice(0, count).join("")}</span></span></Tag>;
}
