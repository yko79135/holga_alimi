"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { isValidVapidPublicKey, pushSupported, urlBase64ToUint8Array } from "@/lib/push/client";

const DISMISS_KEY = "holy-guide-push-prompt-dismissed-at";
const DISMISS_MS = 7 * 24 * 60 * 60 * 1000;

function promptDismissedRecently() {
  try {
    const at = Number(window.localStorage.getItem(DISMISS_KEY) || 0);
    return Date.now() - at < DISMISS_MS;
  } catch {
    return false;
  }
}

/** Runs once each time the dashboard opens. If this device already allows notifications, it
 * makes sure the browser holds a push subscription (creating one if the home-screen app was
 * reinstalled or the browser dropped it) and re-saves it to the server, which refreshes
 * last_seen_at. Push services keep accepting messages for an install that no longer exists on
 * the phone, so this re-save -- not the send result -- is what tells a live device from a dead
 * one, and it repairs the device without anyone pressing 앱 알림 켜기 again.
 *
 * If the device has never been asked, a small banner points to 내 계정 → 앱 알림 켜기 (the
 * permission prompt itself needs a tap there; iOS ignores it outside a user gesture). On an
 * iPhone outside a home-screen app, it explains how to add one instead. */
/** An iPhone/iPad page opened in Safari (or from a plain bookmark icon that still shows the
 * address bar) can never receive push: iOS only allows it in an app added with 홈 화면에 추가.
 * There PushManager doesn't exist at all, so without this check such a device got no hint. */
function isIosOutsideHomeScreenApp() {
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const standalone = (navigator as Navigator & { standalone?: boolean }).standalone === true || window.matchMedia("(display-mode: standalone)").matches;
  return ios && !standalone;
}

export default function PushSync() {
  const [prompt, setPrompt] = useState<"enable" | "install" | null>(null);

  useEffect(() => {
    if (isIosOutsideHomeScreenApp()) {
      if (!promptDismissedRecently()) setPrompt("install");
      return;
    }
    if (!pushSupported()) return;
    if (Notification.permission === "default") {
      if (!promptDismissedRecently()) setPrompt("enable");
      return;
    }
    if (Notification.permission !== "granted") return;

    const key = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    if (!isValidVapidPublicKey(key)) return;

    (async () => {
      const registration = await navigator.serviceWorker.ready;
      const subscription =
        (await registration.pushManager.getSubscription()) ??
        (await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(key) }));
      await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(subscription.toJSON()),
      });
    })().catch(() => undefined);
  }, []);

  if (!prompt) return null;

  function dismiss() {
    try {
      window.localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {
      // Private mode: the banner just comes back next time.
    }
    setPrompt(null);
  }

  if (prompt === "install") {
    return (
      <div className="push-prompt" role="status">
        <span>iPhone에서는 홈 화면에 추가한 앱에서만 알림을 받을 수 있습니다. Safari 아래쪽 공유 버튼 → 홈 화면에 추가를 누른 뒤, 새로 생긴 &quot;홀가 포털&quot; 아이콘으로 열어 주세요. 주소창이 보이는 아이콘은 지워 주세요.</span>
        <button type="button" className="secondary" onClick={dismiss}>닫기</button>
      </div>
    );
  }

  return (
    <div className="push-prompt" role="status">
      <span>이 기기에서 앱 알림이 꺼져 있습니다.</span>
      <Link className="primary" href="/account">알림 켜기</Link>
      <button type="button" className="secondary" onClick={dismiss}>나중에</button>
    </div>
  );
}
