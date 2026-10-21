import { NextResponse } from "next/server";
import { requireStaff, staffJsonError } from "@/lib/admin/require-staff";
import { createAdminClient } from "@/lib/supabase/admin";
import { replacePointNoticeDetail } from "@/lib/warnings/format";
import { refreshGeneratedPointNotice } from "@/lib/warnings/notice-refresh";
import { notifyParentsOfPointChange } from "@/lib/warnings/parent-events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 발송 기록에서 이미 보낸 칭찬·훈계 점수 알림의 세부사항만 고친다. 점수 기록의 사유와 학부모
 * 안내문을 함께 바꾸고, 앱 알림(푸시)은 보내지 않는다. 점수·날짜·수업은 점수 통계에서 고친다. */

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_DETAIL_LENGTH = 2000;
const POINT_SOURCE_TYPES = ["praise_update", "warning_update"];

type Admin = ReturnType<typeof createAdminClient>;
type EntryRow = { id: string; entry_type: string; kind: "discipline" | "praise" | null; category: string | null; custom_category_label: string | null; parent_visible_reason: string | null };
type Target = { noticeId: string; title: string; body: string; batchId: string; studentId: string; entry: EntryRow; label: string };

/** 점수 부여 화면은 사유를 "카테고리 - 세부사항"으로 저장한다(app/api/warnings/grant). */
function detailFromReason(reason: string | null, label: string) {
  const text = (reason || "").trim();
  if (!text || text === label) return "";
  return text.startsWith(`${label} - `) ? text.slice(label.length + 3) : text;
}

async function loadTarget(admin: Admin, noticeId: string): Promise<{ target: Target } | { error: NextResponse }> {
  const noticeRes = await admin.from("notices").select("id,title,body,source_type").eq("id", noticeId).maybeSingle<{ id: string; title: string; body: string; source_type: string | null }>();
  if (noticeRes.error) return { error: staffJsonError("알림을 불러오지 못했습니다.", 500) };
  if (!noticeRes.data) return { error: staffJsonError("알림을 찾을 수 없습니다.", 404) };
  if (!POINT_SOURCE_TYPES.includes(noticeRes.data.source_type || "")) return { error: staffJsonError("칭찬·훈계 점수 알림만 세부사항을 고칠 수 있습니다.", 400) };

  const generatedRes = await admin.from("warning_generated_notices").select("batch_id,student_id").eq("notice_id", noticeId).maybeSingle<{ batch_id: string; student_id: string }>();
  if (generatedRes.error) return { error: staffJsonError("점수 내역을 불러오지 못했습니다.", 500) };
  if (!generatedRes.data) return { error: staffJsonError("이 알림과 연결된 점수 내역을 찾을 수 없습니다.", 404) };
  const { batch_id: batchId, student_id: studentId } = generatedRes.data;

  const entriesRes = await admin.from("warning_entries").select("id,entry_type,kind,category,custom_category_label,parent_visible_reason").eq("batch_id", batchId).eq("student_id", studentId);
  if (entriesRes.error) return { error: staffJsonError("점수 내역을 불러오지 못했습니다.", 500) };
  const entries = (entriesRes.data || []) as EntryRow[];
  // 칭찬·훈계 점수 부여 화면에서 보낸 알림만 "카테고리 + 세부사항" 한 건으로 되어 있다. 표에서
  // 여러 칸을 한꺼번에 저장한 알림이나 희월 정산은 세부사항이라는 칸이 없다.
  const entry = entries[0];
  if (entries.length !== 1 || entry.entry_type !== "daily" || !entry.category) {
    return { error: staffJsonError("이 알림은 세부사항 칸이 없는 점수 알림입니다. 점수 통계에서 해당 점수 내역을 고쳐 주세요.", 400) };
  }
  const label = (entry.custom_category_label || entry.category).trim();
  return { target: { noticeId, title: noticeRes.data.title, body: noticeRes.data.body, batchId, studentId, entry, label } };
}

export async function GET(_request: Request, { params }: { params: Promise<{ noticeId: string }> }) {
  const auth = await requireStaff();
  if ("error" in auth) return auth.error;
  const { noticeId } = await params;
  if (!UUID_PATTERN.test(noticeId)) return staffJsonError("알림 ID를 확인해 주세요.", 400);

  const loaded = await loadTarget(createAdminClient(), noticeId);
  if ("error" in loaded) return loaded.error;
  const { label, entry } = loaded.target;
  return NextResponse.json({ category: label, detail: detailFromReason(entry.parent_visible_reason, label) });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ noticeId: string }> }) {
  const auth = await requireStaff();
  if ("error" in auth) return auth.error;
  const { noticeId } = await params;
  if (!UUID_PATTERN.test(noticeId)) return staffJsonError("알림 ID를 확인해 주세요.", 400);

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return staffJsonError("입력값을 확인해 주세요.", 400);
  const detail = String(body.detail ?? "").replace(/\r\n/g, "\n").trim();
  if (detail.length > MAX_DETAIL_LENGTH) return staffJsonError(`세부사항은 ${MAX_DETAIL_LENGTH}자 이내로 입력해 주세요.`, 400);

  const admin = createAdminClient();
  const loaded = await loadTarget(admin, noticeId);
  if ("error" in loaded) return loaded.error;
  const target = loaded.target;

  const reason = detail ? `${target.label} - ${detail}` : target.label;
  const entryRes = await admin.from("warning_entries").update({ parent_visible_reason: reason }).eq("id", target.entry.id).select("id").single();
  if (entryRes.error) {
    console.error("point-notice-detail-entry-update-failed", { noticeId, code: entryRes.error.code, message: entryRes.error.message });
    return staffJsonError("세부사항을 저장하지 못했습니다.", 500);
  }

  // 처음 보낸 모양의 안내문은 세부 내용 부분만 바꿔 끼운다. 이미 점수 통계에서 정정된 안내문은
  // 세부 내용 칸 없이 사유 한 줄로 되어 있어서, 정정 안내문을 고친 사유로 다시 만든다.
  // 어느 쪽이든 notices 행을 고칠 뿐 sendNoticePushes를 부르지 않으므로 앱 알림은 가지 않는다.
  const editedAt = new Date().toISOString();
  const replaced = target.title.includes("(정정)") ? null : replacePointNoticeDetail(target.body, detail);
  let noticeUpdated: boolean;
  if (replaced !== null) {
    const noticeRes = await admin.from("notices").update({ body: replaced, edited_at: editedAt, edited_by: auth.user.id }).eq("id", noticeId).select("id").single();
    if (noticeRes.error) console.error("point-notice-detail-notice-update-failed", { noticeId, code: noticeRes.error.code, message: noticeRes.error.message });
    noticeUpdated = !noticeRes.error;
  } else {
    noticeUpdated = (await refreshGeneratedPointNotice(admin, { batchId: target.batchId, studentId: target.studentId, today: editedAt.slice(0, 10) })) === "updated";
    if (noticeUpdated) await admin.from("notices").update({ edited_at: editedAt, edited_by: auth.user.id }).eq("id", noticeId);
  }

  await notifyParentsOfPointChange(admin, target.studentId, target.entry.kind, target.batchId);

  return NextResponse.json({
    success: true,
    noticeUpdated,
    message: noticeUpdated
      ? "세부사항을 수정했습니다. 학부모 화면에도 반영되며 앱 알림은 다시 가지 않습니다."
      : "점수 기록의 세부사항은 수정했지만 학부모 안내문 갱신에 실패했습니다. 다시 저장해 주세요.",
  });
}
