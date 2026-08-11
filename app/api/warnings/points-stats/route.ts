import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getUserRoles } from "@/lib/roles-server";
import { summarizeWarningsForStudents } from "@/lib/warnings/stats";

export const runtime = "nodejs";

async function staff() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { e: NextResponse.json({ error: "세션이 만료되었습니다. 다시 로그인해 주세요." }, { status: 401 }) };
  const roles = await getUserRoles(supabase, user.id);
  if (!roles.includes("admin") && !roles.includes("teacher")) return { e: NextResponse.json({ error: "교사 또는 관리자 권한이 필요합니다." }, { status: 403 }) };
  return { supabase };
}

export async function GET(req: Request) {
  const a = await staff();
  if ("e" in a) return a.e;

  const url = new URL(req.url);
  const year = Number(url.searchParams.get("year") || new Date().getFullYear());
  const semester = Number(url.searchParams.get("semester") || 1);
  const grade = url.searchParams.get("grade") || "";
  const studentName = url.searchParams.get("student") || "";

  let studentQuery = a.supabase.from("students").select("id,name,grade,homeroom,active,parent_students(parent_id)").eq("active", true).order("grade").order("name");
  if (grade) studentQuery = studentQuery.eq("grade", grade);
  if (studentName) studentQuery = studentQuery.ilike("name", `%${studentName}%`);
  const { data: students, error: studentsError } = await studentQuery;
  if (studentsError) return NextResponse.json({ error: "통계를 불러오는 중 오류가 발생했습니다." }, { status: 500 });

  const ids = (students || []).map((s: any) => s.id);
  let disciplineEntries: any[] = [];
  let praiseEntries: any[] = [];
  if (ids.length) {
    const { data, error } = await a.supabase.from("warning_entries").select("student_id,month,delta,kind").in("student_id", ids).eq("academic_year", year).eq("semester", semester);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    disciplineEntries = (data || []).filter((entry: any) => entry.kind !== "praise");
    praiseEntries = (data || []).filter((entry: any) => entry.kind === "praise");
  }

  const disciplineSummaries = summarizeWarningsForStudents(disciplineEntries, ids);
  const praiseSummaries = summarizeWarningsForStudents(praiseEntries, ids);
  const rows = (students || []).map((student: any) => ({
    id: student.id,
    name: student.name,
    grade: student.grade,
    homeroom: student.homeroom,
    parentCount: Array.isArray(student.parent_students) ? student.parent_students.length : 0,
    discipline: disciplineSummaries[student.id],
    praise: praiseSummaries[student.id],
  }));

  return NextResponse.json({ students: rows, grades: Array.from(new Set((students || []).map((s: any) => s.grade))).sort() });
}
