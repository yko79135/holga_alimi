"use client";

import { ReactNode, useEffect, useRef } from "react";

type ConfirmDialogProps = {
  open: boolean;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  pending?: boolean;
  pendingLabel?: string;
  error?: string;
  onConfirm: () => void;
  onCancel: () => void;
};

export default function ConfirmDialog({ open, title, children, confirmLabel, cancelLabel = "취소", pending = false, pendingLabel = "처리 중...", error, onConfirm, onCancel }: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    previousFocus.current = document.activeElement as HTMLElement | null;
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.setTimeout(() => dialogRef.current?.focus(), 0);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !pending) onCancel();
      if (event.key !== "Tab") return;
      const focusables = dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])');
      if (!focusables?.length) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = originalOverflow;
      previousFocus.current?.focus?.();
    };
  }, [open, pending, onCancel]);

  if (!open) return null;
  return (
    <div className="modal-backdrop confirm-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !pending) onCancel(); }}>
      <div className="modal-card confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="confirm-dialog-title" tabIndex={-1} ref={dialogRef}>
        <p className="eyebrow">HOLY GUIDE CONFIRMATION</p>
        <h2 id="confirm-dialog-title">{title}</h2>
        <div className="confirm-dialog__body">{children}</div>
        {error && <p role="alert" className="form-error">{error}</p>}
        <div className="modal-actions">
          <button type="button" className="secondary" onClick={onCancel} disabled={pending}>{cancelLabel}</button>
          <button type="button" className="primary" onClick={onConfirm} disabled={pending}>{pending ? pendingLabel : confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}
