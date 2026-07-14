"use client";

import { ReactNode, useEffect, useRef } from "react";

type ConfirmDialogProps = {
  open: boolean;
  title: string;
  eyebrow?: string;
  children: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  pending?: boolean;
  variant?: "default" | "danger";
  onConfirm: () => void;
  onClose: () => void;
};

export default function ConfirmDialog({ open, title, eyebrow = "CONFIRM", children, confirmLabel, cancelLabel = "취소", pending = false, variant = "default", onConfirm, onClose }: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    requestAnimationFrame(() => dialogRef.current?.focus());
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !pending) onClose();
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>('button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'));
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = originalOverflow;
      document.removeEventListener("keydown", onKeyDown);
      previousFocus.current?.focus();
    };
  }, [open, pending, onClose]);

  if (!open) return null;
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !pending) onClose(); }}>
      <div ref={dialogRef} className={`modal-card action-dialog ${variant === "danger" ? "destructive-modal" : ""}`} role={variant === "danger" ? "alertdialog" : "dialog"} aria-modal="true" aria-labelledby="action-dialog-title" tabIndex={-1}>
        <button type="button" className="modal-close" aria-label="닫기" onClick={onClose} disabled={pending}>×</button>
        <p className="eyebrow">{eyebrow}</p>
        <h2 id="action-dialog-title">{title}</h2>
        <div className="action-dialog-body">{children}</div>
        <div className="modal-actions"><button type="button" className="secondary" onClick={onClose} disabled={pending}>{cancelLabel}</button><button type="button" className={variant === "danger" ? "danger-button" : "primary"} onClick={onConfirm} disabled={pending}>{pending ? "저장 중..." : confirmLabel}</button></div>
      </div>
    </div>
  );
}
