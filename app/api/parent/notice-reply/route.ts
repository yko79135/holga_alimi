import { after, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getUserRoles } from "@/lib/roles-server";
import { sendReplyPushToTeacher } from "@/lib/push/send";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "세션이 만료되었습니다. 다시 로그인해 주세요." }, { status: 401 });
  const roles = await getUserRoles(supabase, user.id);
  if (!roles.includes("parent")) return NextResponse.json({ error: "학부모 권한이 필요합니다." }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const noticeId = String(body.noticeId || "").trim();
  const reply = String(body.reply || "").trim();
  if (!noticeId || !reply) return NextResponse.json({ error: "답변 내용을 입력해 주세요." }, { status: 400 });

  const now = new Date().toISOString();
  const { error } = await supabase
    .from("acknowledgements")
    .upsert({ notice_id: noticeId, parent_id: user.id, read_at: now, parent_reply: reply, replied_at: now }, { onConflict: "notice_id,parent_id" });
  if (error) return NextResponse.json({ error: "답변 저장에 실패했습니다." }, { status: 500 });

  const [{ data: notice }, { data: profile }] = await Promise.all([
    supabase.from("notices").select("id,title,created_by").eq("id", noticeId).maybeSingle(),
    supabase.from("profiles").select("full_name,email").eq("id", user.id).maybeSingle(),
  ]);

  if (notice?.created_by) {
    const parentName = profile?.full_name || profile?.email || "학부모";
    after(async () => {
      try {
        await sendReplyPushToTeacher({ id: notice.id, title: notice.title, created_by: notice.created_by }, parentName, reply);
      } catch (err) {
        console.error("reply-push-failed", { noticeId, message: err instanceof Error ? err.message : "unknown" });
      }
    });
  }

  return NextResponse.json({ success: true, repliedAt: now });
}
