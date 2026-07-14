import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { userIsAdmin } from "@/lib/roles-server";
export const runtime = "nodejs";
export async function GET(req: Request) {
  const s = await createClient();
  const { data: { user } } = await s.auth.getUser();
  if (!user) return NextResponse.json({ error: "세션이 만료되었습니다. 다시 로그인해 주세요." }, { status: 401 });
  if (!(await userIsAdmin(s, user.id))) return NextResponse.json({ error: "관리자 권한이 필요합니다." }, { status: 403 });
  const studentId = new URL(req.url).searchParams.get("studentId");
  let q = s.from("warning_entries").select("id,student_id,warning_date,entry_type,previous_value,new_value,delta,change_type,parent_visible_reason,teacher_note,created_at,profiles(full_name),warning_generated_notices(notice_id,recipient_count,push_sent_count,push_failed_count)").order("created_at", { ascending: false }).limit(200);
  if (studentId) q = q.eq("student_id", studentId);
  const { data, error } = await q;
  return NextResponse.json(error ? { error: "경고 감사 기록을 불러오지 못했습니다." } : { entries: data || [] }, { status: error ? 500 : 200 });
}
