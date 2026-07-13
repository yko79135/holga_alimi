"use client";

import { useEffect } from "react";

const SW_ERROR_EVENT = "holga:service-worker-error";
const SW_READY_EVENT = "holga:service-worker-ready";

function reportServiceWorkerError(message: string) {
  window.dispatchEvent(new CustomEvent(SW_ERROR_EVENT, { detail: { message } }));
}

export default function ServiceWorkerRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    let cancelled = false;

    navigator.serviceWorker
      .register("/sw.js", { scope: "/" })
      .then(async (registration) => {
        if (cancelled) return;

        if (registration.scope !== `${window.location.origin}/`) {
          reportServiceWorkerError("Service Worker 등록 범위가 올바르지 않습니다.");
          return;
        }

        window.dispatchEvent(new CustomEvent(SW_READY_EVENT));

        try {
          await registration.update();
        } catch {
          reportServiceWorkerError("Service Worker 업데이트 확인에 실패했습니다.");
        }
      })
      .catch(() => {
        if (!cancelled) reportServiceWorkerError("Service Worker 등록에 실패했습니다.");
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return null;
}
