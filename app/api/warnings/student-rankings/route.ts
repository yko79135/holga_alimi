import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { userIsAdmin } from "@/lib/roles-server";
import { selectAll } from "@/lib/supabase/select-all";
import { SCHOOL_DIVISIONS, buildStudentRanking, schoolDivision, type StudentRankingEntry } from "@/lib/warnings/student-rankings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 학생 칭찬·훈계 순위와 항목별 구성. 학생끼리 줄 세우는 화면이라 관리자만 본다. */
export async function GET(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "세션이 만료되었습니다. 다시 로그인해 주세요." }, { status: 401 });
  if (!(await userIsAdmin(supabase, user.id))) return NextResponse.json({ error: "관리자 권한이 필요합니다." }, { status: 403 });

  const url = new URL(req.url);
  const year = Number(url.searchParams.get("year") || new Date().getFullYear());
  const semester = Number(url.searchParams.get("semester") || 2);
  const kind = url.searchParams.get("kind") === "discipline" ? "discipline" : "praise";
  if (!Number.isInteger(year) || (semester !== 1 && semester !== 2)) return NextResponse.json({ error: "학년도와 학기를 확인해 주세요." }, { status: 400 });

  const studentsRes = await supabase.from("students").select("id,name,grade").eq("active", true);
  if (studentsRes.error) return NextResponse.json({ error: "학생 목록을 불러오지 못했습니다." }, { status: 500 });
  const students = (studentsRes.data || []) as Array<{ id: string; name: string; grade: string }>;

  const entriesRes = await selectAll<StudentRankingEntry>((from, to) =>
    supabase
      .from("warning_entries")
      .select("student_id,kind,category,custom_category_label,delta")
      .eq("academic_year", year)
      .eq("semester", semester)
      .eq("entry_type", "daily")
      .order("id")
      .range(from, to),
  );
  if (entriesRes.error) return NextResponse.json({ error: "점수 기록을 불러오지 못했습니다." }, { status: 500 });

  // 초저·초고·중등은 따로 순위를 매긴다 (학년대가 달라 한 줄로 세우면 비교가 안 된다).
  const divisions = SCHOOL_DIVISIONS.map((division) => ({
    ...division,
    ...buildStudentRanking(entriesRes.data, students.filter((student) => schoolDivision(student.grade) === division.key), kind),
  }));
  return NextResponse.json({ kind, divisions });
}
