export function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

export function isValidVapidPublicKey(key: string | undefined): key is string {
  if (!key) return false;
  try {
    const bytes = urlBase64ToUint8Array(key);
    return bytes.length === 65 && bytes[0] === 4;
  } catch {
    return false;
  }
}

export function pushSupported() {
  return typeof window !== "undefined" && window.isSecureContext && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}
