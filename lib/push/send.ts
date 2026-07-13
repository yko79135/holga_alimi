import "server-only";
import crypto from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { buildSafeNoticePayload } from "./payload";

type Notice = { id: string; target_scope: string; target_grade: string | null };
type Sub = { id: string; endpoint: string; p256dh: string; auth: string; user_id: string };
function b64url(input: Buffer | string) { return Buffer.from(input).toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_"); }
function rawB64Url(key: string) {
  const b64 = key.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(b64 + "=".repeat((4 - b64.length % 4) % 4), "base64");
}
function vapidPrivateKey(publicKey: string, privateKey: string) {
  const pub = rawB64Url(publicKey);
  return crypto.createPrivateKey({ key: { kty: "EC", crv: "P-256", x: b64url(pub.subarray(1, 33)), y: b64url(pub.subarray(33, 65)), d: b64url(rawB64Url(privateKey)) }, format: "jwk" });
}
function vapid(endpoint: string) {
  const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY; const priv = process.env.VAPID_PRIVATE_KEY; const sub = process.env.VAPID_SUBJECT || "mailto:admin@example.com";
  if (!pub || !priv) return null;
  const aud = new URL(endpoint).origin; const exp = Math.floor(Date.now()/1000)+12*60*60;
  const token = `${b64url(JSON.stringify({ typ:"JWT", alg:"ES256" }))}.${b64url(JSON.stringify({ aud, exp, sub }))}`;
  const sig = crypto.sign("sha256", Buffer.from(token), vapidPrivateKey(pub, priv));
  return { Authorization: `vapid t=${token}.${b64url(sig)}, k=${pub}` };
}
export async function resolveNoticeRecipientIds(notice: Notice) {
  const admin = createAdminClient(); let ids: string[] = [];
  if (notice.target_scope === "school") {
    const { data } = await admin.from("profiles").select("id").eq("role", "parent"); ids = (data||[]).map((r:any)=>r.id);
  } else if (notice.target_scope === "grade") {
    const { data } = await admin.from("parent_students").select("parent_id,students!inner(grade)").eq("students.grade", notice.target_grade);
    ids = (data||[]).map((r:any)=>r.parent_id);
  } else {
    const { data: ns } = await admin.from("notice_students").select("student_id").eq("notice_id", notice.id);
    const studentIds = (ns||[]).map((r:any)=>r.student_id);
    if (studentIds.length) { const { data } = await admin.from("parent_students").select("parent_id").in("student_id", studentIds); ids = (data||[]).map((r:any)=>r.parent_id); }
  }
  return Array.from(new Set(ids));
}
export async function sendNoticePushes(notice: Notice) {
  const admin = createAdminClient(); const recipients = await resolveNoticeRecipientIds(notice);
  if (!recipients.length) return { sent:0, unsubscribed:0, failed:0, recipients:0 };
  const { data } = await admin.from("push_subscriptions").select("id,endpoint,p256dh,auth,user_id").in("user_id", recipients);
  const subs = (data||[]) as Sub[];  buildSafeNoticePayload(notice); let sent=0, failed=0; const invalid:string[]=[];
  for (let i=0;i<subs.length;i+=5) await Promise.all(subs.slice(i,i+5).map(async (s)=>{ try { const h=vapid(s.endpoint); if(!h) { failed++; return; } const res=await fetch(s.endpoint,{method:"POST",headers:{TTL:"86400",...h}}); if(res.ok||res.status===201||res.status===202) sent++; else if(res.status===404||res.status===410) invalid.push(s.id); else failed++; } catch { failed++; }}));
  if (invalid.length) await admin.from("push_subscriptions").delete().in("id", invalid);
  return { sent, unsubscribed: Math.max(0, recipients.length - new Set(subs.map(s=>s.user_id)).size), failed, recipients: recipients.length };
}
