"use client";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { Info, X } from "lucide-react";

type Variant = "error" | "success" | "info";
type Flash = { id: number; message: string; variant: Variant; expires: number };
const FlashContext = createContext<
  (message: string, variant?: Variant) => void
>(() => {});
export function FlashProvider({ children }: { children: React.ReactNode }) {
  const [flash, setFlash] = useState<Flash | null>(null);
  const [mounted, setMounted] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const sequence = useRef(0);
  const show = useCallback((message: string, variant: Variant = "info") => {
    if (!message.trim()) return;
    setFlash({
      id: ++sequence.current,
      message,
      variant,
      expires: Date.now() + 5000,
    });
    if (variant === "error")
      requestAnimationFrame(() => {
        const active = document.activeElement;
        const form =
          active?.closest("form") ||
          document.querySelector("dialog[open] form") ||
          document.querySelector("form");
        const target =
          form?.querySelector<HTMLElement>(
            "input:invalid,textarea:invalid,select:invalid,[aria-invalid='true']",
          ) ||
          form?.querySelector<HTMLElement>(
            "input:not([readonly]):not([disabled]):not([type='hidden']):not([hidden]),textarea:not([disabled]),select:not([disabled])",
          ) ||
          form;
        if (target) {
          target.scrollIntoView({
            behavior: matchMedia("(prefers-reduced-motion:reduce)").matches
              ? "auto"
              : "smooth",
            block: "center",
          });
          if (
            target instanceof HTMLInputElement ||
            target instanceof HTMLTextAreaElement ||
            target instanceof HTMLSelectElement
          )
            target.focus({ preventScroll: true });
        }
      });
  }, []);
  useEffect(() => {
    setMounted(true);
    try {
      const value = JSON.parse(
        sessionStorage.getItem("reelogram-flash") || "null",
      );
      sessionStorage.removeItem("reelogram-flash");
      if (
        value &&
        typeof value.message === "string" &&
        value.message.length <= 600 &&
        ["error", "success", "info"].includes(value.variant) &&
        value.expires > Date.now() &&
        value.expires <= Date.now() + 5000
      )
        setFlash({ ...value, id: ++sequence.current });
    } catch {}
    const invalid = (event: Event) => {
      const field = event.target;
      if (
        !(
          field instanceof HTMLInputElement ||
          field instanceof HTMLTextAreaElement ||
          field instanceof HTMLSelectElement
        )
      )
        return;
      event.preventDefault();
      // One notification per validation pass, focused on the first invalid field.
      const first = field.form?.querySelector(
        "input:invalid,textarea:invalid,select:invalid",
      );
      if (first && first !== field) return;
      show(
        field.validationMessage || "Check this field and try again.",
        "error",
      );
      field.scrollIntoView({
        behavior: matchMedia("(prefers-reduced-motion:reduce)").matches
          ? "auto"
          : "smooth",
        block: "center",
      });
      field.focus({ preventScroll: true });
    };
    document.addEventListener("invalid", invalid, true);
    return () => document.removeEventListener("invalid", invalid, true);
  }, [show]);
  useEffect(() => {
    if (!flash) return;
    const node = panel.current;
    // A manual popover stays above modal dialogs without stealing keyboard focus.
    try {
      node?.showPopover?.();
    } catch {}
    const timer = setTimeout(
      () => setFlash((current) => (current?.id === flash.id ? null : current)),
      Math.max(0, flash.expires - Date.now()),
    );
    const persist = () => {
      try {
        if (flash.expires > Date.now())
          sessionStorage.setItem("reelogram-flash", JSON.stringify(flash));
      } catch {}
    };
    window.addEventListener("pagehide", persist);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("pagehide", persist);
      try {
        node?.hidePopover?.();
      } catch {}
    };
  }, [flash]);
  return (
    <FlashContext.Provider value={show}>
      {children}
      {mounted &&
        flash &&
        createPortal(
          <div
            ref={panel}
            popover="manual"
            className={`flash-notification flash-${flash.variant}`}
            data-flash-notification
            role={flash.variant === "error" ? "alert" : "status"}
            aria-atomic="true"
          >
            <Info size={23} aria-hidden="true" />
            <p>{flash.message}</p>
            <button
              type="button"
              aria-label="Close notification"
              onClick={() => setFlash(null)}
            >
              <X size={20} />
            </button>
          </div>,
          document.body,
        )}
    </FlashContext.Provider>
  );
}
export function useFlash() {
  return useContext(FlashContext);
}
export default function FlashMessage({
  message,
  variant = "error",
}: {
  message?: string | null;
  variant?: Variant;
}) {
  const show = useFlash();
  useEffect(() => {
    if (message) show(message, variant);
  }, [message, variant, show]);
  return null;
}
