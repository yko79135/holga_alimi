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

const DEVICE_KEY = "holy-guide-device-key";

type Platform = "ios" | "android" | "other";
type Permission = "granted" | "default" | "denied" | "unsupported";

function platformOf(): Platform {
  if (/iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)) return "ios";
  return /Android/.test(navigator.userAgent) ? "android" : "other";
}

function isStandalone() {
  return (navigator as Navigator & { standalone?: boolean }).standalone === true || window.matchMedia("(display-mode: standalone)").matches;
}

/** A random id kept in this browser's storage, so each install reports as one device. iOS keeps
 * separate storage for a home-screen app and Safari, so those count as two devices -- which is
 * what the admin list needs to tell an old Safari bookmark apart from the real app. */
function deviceKey() {
  try {
    let key = window.localStorage.getItem(DEVICE_KEY);
    if (!key) {
      key = typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
      window.localStorage.setItem(DEVICE_KEY, key);
    }
    return key;
  } catch {
    // No storage (private mode): skip reporting rather than log a new "device" on every open.
    return null;
  }
}

function report(state: { platform: Platform; standalone: boolean; permission: Permission; subscribed: boolean }) {
  const key = deviceKey();
  if (!key) return;
  fetch("/api/devices/heartbeat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ deviceKey: key, ...state }),
  }).catch(() => undefined);
}

/** Runs once each time the dashboard opens. If this device already allows notifications, it
 * makes sure the browser holds a push subscription (creating one if the home-screen app was
 * reinstalled or the browser dropped it) and re-saves it to the server, which refreshes
 * last_seen_at. Push services keep accepting messages for an install that no longer exists on
 * the phone, so this re-save -- not the send result -- is what tells a live device from a dead
 * one, and it repairs the device without anyone pressing 앱 알림 켜기 again.
 *
 * If the device has never been asked, a small banner points to 내 계정 → 앱 알림 켜기 (the
 * permission prompt itself needs a tap there; iOS ignores it outside a user gesture). An
 * iPhone/iPad outside a home-screen app (Safari, or an old bookmark icon that still shows the
 * address bar) can never receive push -- iOS doesn't even expose PushManager there -- so it gets
 * instructions to add the app instead.
 *
 * Either way it reports the device's state to /api/devices/heartbeat for the admin list. */
export default function PushSync() {
  const [prompt, setPrompt] = useState<"enable" | "install" | null>(null);

  useEffect(() => {
    const platform = platformOf();
    const standalone = isStandalone();

    if (platform === "ios" && !standalone) {
      if (!promptDismissedRecently()) setPrompt("install");
      report({ platform, standalone, permission: "unsupported", subscribed: false });
      return;
    }
    if (!pushSupported()) {
      report({ platform, standalone, permission: "unsupported", subscribed: false });
      return;
    }
    const permission = Notification.permission as Permission;
    if (permission !== "granted") {
      if (permission === "default" && !promptDismissedRecently()) setPrompt("enable");
      report({ platform, standalone, permission, subscribed: false });
      return;
    }

    const key = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    if (!isValidVapidPublicKey(key)) return;

    (async () => {
      const registration = await navigator.serviceWorker.ready;
      const subscription =
        (await registration.pushManager.getSubscription()) ??
        (await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(key) }));
      const response = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(subscription.toJSON()),
      });
      return response.ok;
    })()
      .catch(() => false)
      .then((subscribed) => report({ platform, standalone, permission, subscribed }));
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
