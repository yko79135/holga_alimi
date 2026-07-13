"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type PushState =
  | "idle"
  | "checking"
  | "registering_worker"
  | "requesting_permission"
  | "subscribing"
  | "saving"
  | "enabled"
  | "blocked"
  | "unsupported"
  | "failed";

const PUSH_MESSAGES: Record<PushState, string> = {
  idle: "앱 알림이 꺼져 있습니다.",
  checking: "알림 기능을 확인하고 있습니다.",
  registering_worker: "Service Worker를 준비하고 있습니다.",
  requesting_permission: "알림 권한을 요청하고 있습니다.",
  subscribing: "알림 구독을 생성하고 있습니다.",
  saving: "알림 구독을 저장하고 있습니다.",
  enabled: "앱 알림이 켜져 있습니다.",
  blocked: "알림 권한이 차단되어 있습니다.",
  unsupported: "이 기기에서는 앱 알림을 지원하지 않습니다.",
  failed: "알림 설정에 실패했습니다.",
};

const WORKER_TIMEOUT_MS = 8000;

function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

function isValidVapidPublicKey(key: string | undefined): key is string {
  if (!key) return false;
  try {
    const bytes = urlBase64ToUint8Array(key);
    return bytes.length === 65 && bytes[0] === 4;
  } catch {
    return false;
  }
}

function timeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        window.clearTimeout(timer);
        reject(error);
      },
    );
  });
}

async function getJsonError(response: Response, fallback: string) {
  const body = await response.json().catch(() => null);
  return typeof body?.error === "string" ? body.error : fallback;
}

async function getRegistration() {
  const existing = await navigator.serviceWorker.getRegistration("/");
  const registration = existing ?? (await navigator.serviceWorker.register("/sw.js", { scope: "/" }));
  await registration.update().catch(() => undefined);
  return registration;
}

export default function AccountSettings({ email }: { email: string }) {
  const [cur, setCur] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [pushState, setPushState] = useState<PushState>("idle");
  const [pushError, setPushError] = useState("");
  const [pushBusy, setPushBusy] = useState(false);
  const [showIos, setShowIos] = useState(false);

  const push = useMemo(() => pushError || PUSH_MESSAGES[pushState], [pushError, pushState]);

  useEffect(() => {
    function onServiceWorkerError(event: Event) {
      const detail = (event as CustomEvent<{ message?: string }>).detail;
      setPushError(detail?.message || "Service Worker 등록에 실패했습니다.");
      setPushState("failed");
    }

    window.addEventListener("holga:service-worker-error", onServiceWorkerError);

    if (!window.isSecureContext || !("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
      setPushState("unsupported");
    } else if (Notification.permission === "denied") {
      setPushState("blocked");
    } else {
      timeout(navigator.serviceWorker.ready, WORKER_TIMEOUT_MS, "Service Worker가 준비되지 않았습니다.")
        .then((registration) => registration.pushManager.getSubscription())
        .then((subscription) => setPushState(subscription ? "enabled" : "idle"))
        .catch(() => setPushState("idle"));
    }

    return () => window.removeEventListener("holga:service-worker-error", onServiceWorkerError);
  }, []);

  async function change(e: FormEvent) {
    e.preventDefault();
    setErr("");
    setMsg("");
    if (!cur || !next || !confirm) return setErr("모든 비밀번호 항목을 입력해주세요.");
    if (next.length < 8) return setErr("비밀번호는 8자 이상이어야 합니다.");
    if (next !== confirm) return setErr("새 비밀번호가 서로 일치하지 않습니다.");
    if (cur === next) return setErr("새 비밀번호는 현재 비밀번호와 달라야 합니다.");
    setBusy(true);
    const s = createClient();
    const { error: signErr } = await s.auth.signInWithPassword({ email, password: cur });
    if (signErr) {
      setErr("현재 비밀번호가 올바르지 않습니다.");
      setBusy(false);
      return;
    }
    const { error } = await s.auth.updateUser({ password: next });
    setBusy(false);
    if (error) setErr("비밀번호 변경에 실패했습니다.");
    else {
      setCur("");
      setNext("");
      setConfirm("");
      setMsg("비밀번호가 변경되었습니다.");
    }
  }

  async function enablePush() {
    setErr("");
    setPushError("");
    setPushState("checking");
    setPushBusy(true);

    try {
      if (!window.isSecureContext || !("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
        setPushState("unsupported");
        return;
      }

      setPushState("registering_worker");
      await getRegistration().catch(() => {
        throw new Error("Service Worker 등록에 실패했습니다.");
      });
      const readyRegistration = await timeout(navigator.serviceWorker.ready, WORKER_TIMEOUT_MS, "Service Worker가 준비되지 않았습니다.");

      if (Notification.permission === "denied") {
        setPushState("blocked");
        setPushError("알림 권한이 차단되어 있습니다.");
        return;
      }

      if (Notification.permission !== "granted") {
        setPushState("requesting_permission");
        const permission = await Notification.requestPermission();
        if (permission === "denied") {
          setPushState("blocked");
          setPushError("알림 권한이 차단되어 있습니다.");
          return;
        }
        if (permission !== "granted") {
          setPushState("failed");
          setPushError("알림 권한이 허용되지 않았습니다.");
          return;
        }
      }

      const key = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
      if (!isValidVapidPublicKey(key)) {
        setPushState("failed");
        setPushError("VAPID 공개 키가 설정되지 않았습니다.");
        return;
      }

      setPushState("subscribing");
      let subscription = await readyRegistration.pushManager.getSubscription();
      if (!subscription) {
        subscription = await readyRegistration.pushManager
          .subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(key) })
          .catch(() => {
            throw new Error("알림 구독 생성에 실패했습니다.");
          });
      }

      setPushState("saving");
      const saveResponse = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(subscription),
      }).catch(() => {
        throw new Error("네트워크 오류가 발생했습니다.");
      });

      if (!saveResponse.ok) throw new Error(await getJsonError(saveResponse, "알림 구독 저장에 실패했습니다."));

      const statusResponse = await fetch(`/api/push/status?endpoint=${encodeURIComponent(subscription.endpoint)}`).catch(() => {
        throw new Error("네트워크 오류가 발생했습니다.");
      });
      if (!statusResponse.ok) throw new Error(await getJsonError(statusResponse, "알림 구독 저장에 실패했습니다."));
      const status = await statusResponse.json().catch(() => null);
      if (!status?.subscribed) throw new Error("알림 구독 저장에 실패했습니다.");

      setPushState("enabled");
    } catch (error) {
      setPushState("failed");
      setPushError(error instanceof Error ? error.message : "네트워크 오류가 발생했습니다.");
    } finally {
      setPushBusy(false);
    }
  }

  async function disablePush() {
    setPushError("");
    try {
      const reg = await timeout(navigator.serviceWorker.ready, WORKER_TIMEOUT_MS, "Service Worker가 준비되지 않았습니다.");
      const sub = await reg.pushManager.getSubscription();
      await fetch("/api/push/subscribe", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint: sub?.endpoint }),
      });
      await sub?.unsubscribe();
      setPushState("idle");
    } catch (error) {
      setPushState("failed");
      setPushError(error instanceof Error ? error.message : "네트워크 오류가 발생했습니다.");
    }
  }

  return (
    <div className="account-wrap">
      <section className="form-panel">
        <p className="eyebrow">ACCOUNT</p>
        <h2>비밀번호 변경</h2>
        <form onSubmit={change}>
          <label>현재 비밀번호</label>
          <input type="password" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} required />
          <label>새 비밀번호</label>
          <input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} required />
          <label>새 비밀번호 확인</label>
          <input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
          <button className="primary" disabled={busy}>{busy ? "변경 중..." : "비밀번호 변경"}</button>
        </form>
        {msg && <p role="status" className="success-message">{msg}</p>}
        {err && <p role="alert" className="form-error">{err}</p>}
      </section>
      <section className="content-card">
        <p className="eyebrow">PUSH</p>
        <h2>앱 알림 설정</h2>
        <p role="status" className="notice-body">{push}</p>
        <p className="muted">알림은 버튼을 누른 뒤에만 권한을 요청합니다. iPhone/iPad는 공유 → 홈 화면에 추가 후 홈 화면 앱에서 알림을 켜야 합니다. OS, 브라우저, 네트워크 설정에 따라 전달이 보장되지 않으며 앱 안의 읽지 않은 알림이 항상 대체 수단입니다.</p>
        <div className="topbar-actions">
          <button className="primary" onClick={enablePush} disabled={pushBusy}>{pushBusy ? "처리 중..." : "앱 알림 켜기"}</button>
          <button className="secondary" onClick={disablePush} disabled={pushBusy}>앱 알림 끄기</button>
          <button className="secondary" onClick={() => setShowIos(!showIos)}>홈 화면 추가 방법 보기</button>
        </div>
        {showIos && <ol className="muted"><li>Safari에서 포털을 엽니다.</li><li>공유 버튼을 누릅니다.</li><li>홈 화면에 추가를 선택합니다.</li><li>홈 화면 아이콘으로 다시 열고 앱 알림 켜기를 누릅니다.</li></ol>}
      </section>
    </div>
  );
}
