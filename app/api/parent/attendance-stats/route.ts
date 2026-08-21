import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getUserRoles } from "@/lib/roles-server";
import { summarizeAttendanceForStudents } from "@/lib/attendance/stats";
import { computePresentEstimate } from "@/lib/attendance/schoolDays";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "세션이 만료되었습니다. 다시 로그인해 주세요." }, { status: 401 });
  const roles = await getUserRoles(supabase, user.id);
  if (!roles.includes("parent")) return NextResponse.json({ error: "학부모 권한이 필요합니다." }, { status: 403 });

  const url = new URL(req.url);
  const year = Number(url.searchParams.get("year") || new Date().getFullYear());
  const semester = Number(url.searchParams.get("semester") || 1);

  const { data: links, error: linksError } = await supabase
    .from("parent_students")
    .select("students(id,name,grade,homeroom)")
    .eq("parent_id", user.id);
  if (linksError) return NextResponse.json({ error: "출석 통계를 불러오는 중 오류가 발생했습니다." }, { status: 500 });

  const students = (links || []).flatMap((row: any) => (Array.isArray(row.students) ? row.students : row.students ? [row.students] : []));
  const ids = students.map((s: any) => s.id);

  let entries: any[] = [];
  if (ids.length) {
    const { data, error } = await supabase
      .from("attendance_entries")
      .select("student_id,attendance_date,new_status,created_at")
      .in("student_id", ids)
      .eq("academic_year", year)
      .eq("semester", semester);
    if (error) return NextResponse.json({ error: "출석 통계를 불러오는 중 오류가 발생했습니다." }, { status: 500 });
    entries = data || [];
  }

  const summaries = summarizeAttendanceForStudents(entries, ids);
  const [{ data: term }, { data: exceptionRows }] = await Promise.all([
    supabase.from("academic_terms").select("start_date,end_date,total_instructional_days").eq("academic_year", year).eq("semester", semester).maybeSingle(),
    supabase.from("academic_calendar_exceptions").select("date").eq("academic_year", year).eq("is_closure", true),
  ]);
  const exceptionDates = new Set((exceptionRows || []).map((r: any) => r.date));
  const rows = students.map((s: any) => {
    const summary = summaries[s.id];
    const presentEstimate = computePresentEstimate({ term: term || null, exceptionDates, semesterExceptionTotal: summary?.semesterTotal || 0 });
    return { id: s.id, name: s.name, grade: s.grade, homeroom: s.homeroom, presentEstimate, ...summary };
  });

  return NextResponse.json({ students: rows });
}
