"use client";

import { useEffect, useRef } from "react";

type Props = {
  open: boolean;
  title: string;
  description?: string;
  onClose?: () => void;
  closable?: boolean;
  children: React.ReactNode;
};

export function Dialog({ open, title, description, onClose, closable = true, children }: Props) {
  const cardRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && closable) onClose?.();
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    // Focus first focusable in dialog.
    setTimeout(() => {
      const focusable = cardRef.current?.querySelector<HTMLElement>("input, textarea, button");
      focusable?.focus();
    }, 30);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, closable, onClose]);

  if (!open) return null;

  return (
    <div
      className="dialog-backdrop"
      onClick={closable ? () => onClose?.() : undefined}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div ref={cardRef} className="dialog-card" onClick={(e) => e.stopPropagation()}>
        <h3 className="dialog-title">{title}</h3>
        {description && <p className="dialog-desc">{description}</p>}
        {children}
      </div>
    </div>
  );
}
