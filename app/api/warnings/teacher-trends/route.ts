import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { userIsAdmin } from "@/lib/roles-server";
import { selectAll } from "@/lib/supabase/select-all";
import { buildTeacherTrendReport, type TeacherTrendEntry } from "@/lib/warnings/teacher-trends";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 선생님별 칭찬·훈계 추이. 교사끼리 서로의 부여 패턴을 비교하는 화면이라 관리자만 본다. */
export async function GET(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "세션이 만료되었습니다. 다시 로그인해 주세요." }, { status: 401 });
  if (!(await userIsAdmin(supabase, user.id))) return NextResponse.json({ error: "관리자 권한이 필요합니다." }, { status: 403 });

  const url = new URL(req.url);
  const year = Number(url.searchParams.get("year") || new Date().getFullYear());
  const semester = Number(url.searchParams.get("semester") || 2);
  if (!Number.isInteger(year) || (semester !== 1 && semester !== 2)) return NextResponse.json({ error: "학년도와 학기를 확인해 주세요." }, { status: 400 });

  const [entriesRes, rolesRes] = await Promise.all([
    selectAll<TeacherTrendEntry>((from, to) =>
      supabase
        .from("warning_entries")
        .select("author_id,student_id,warning_date,kind,category,custom_category_label,delta")
        .eq("academic_year", year)
        .eq("semester", semester)
        .eq("entry_type", "daily")
        .order("id")
        .range(from, to),
    ),
    supabase.from("profile_roles").select("profile_id").in("role", ["admin", "teacher"]),
  ]);
  if (entriesRes.error) return NextResponse.json({ error: "점수 기록을 불러오지 못했습니다." }, { status: 500 });
  if (rolesRes.error) return NextResponse.json({ error: "선생님 목록을 불러오지 못했습니다." }, { status: 500 });

  const staffIds = new Set((rolesRes.data || []).map((row: { profile_id: string }) => row.profile_id));
  // 지금은 교사가 아니어도 이번 학기에 점수를 준 계정은 이름이 보여야 한다.
  for (const entry of entriesRes.data) staffIds.add(entry.author_id);
  const ids = Array.from(staffIds);
  const profilesRes = ids.length ? await supabase.from("profiles").select("id,full_name,email").in("id", ids) : { data: [], error: null };
  if (profilesRes.error) return NextResponse.json({ error: "선생님 목록을 불러오지 못했습니다." }, { status: 500 });
  const staff = (profilesRes.data || []).map((profile: { id: string; full_name: string | null; email: string | null }) => ({
    id: profile.id,
    name: profile.full_name || profile.email || "(이름 없음)",
  }));

  const today = new Date().toISOString().slice(0, 10);
  const semesterEnd = semester === 1 ? `${year}-07-31` : `${year}-12-31`;
  const report = buildTeacherTrendReport(entriesRes.data, staff, today < semesterEnd ? today : semesterEnd);
  return NextResponse.json(report);
}
