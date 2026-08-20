import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getUserRoles } from "@/lib/roles-server";
import { summarizeWarningsForStudents } from "@/lib/warnings/stats";

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
  if (linksError) return NextResponse.json({ error: "통계를 불러오는 중 오류가 발생했습니다." }, { status: 500 });

  const students = (links || []).flatMap((row: any) => (Array.isArray(row.students) ? row.students : row.students ? [row.students] : []));
  const ids = students.map((s: any) => s.id);

  let disciplineEntries: any[] = [];
  let praiseEntries: any[] = [];
  let graceEntries: any[] = [];
  if (ids.length) {
    const { data, error } = await supabase
      .from("warning_entries")
      .select("student_id,month,delta,kind,entry_type")
      .in("student_id", ids)
      .eq("academic_year", year)
      .eq("semester", semester);
    if (error) return NextResponse.json({ error: "통계를 불러오는 중 오류가 발생했습니다." }, { status: 500 });
    disciplineEntries = (data || []).filter((entry: any) => entry.kind !== "praise");
    praiseEntries = (data || []).filter((entry: any) => entry.kind === "praise");
    graceEntries = (data || []).filter((entry: any) => entry.entry_type === "grace_conversion" && entry.kind !== "praise");
  }

  const disciplineSummaries = summarizeWarningsForStudents(disciplineEntries, ids);
  const praiseSummaries = summarizeWarningsForStudents(praiseEntries, ids);
  const graceTotals = new Map<string, number>();
  for (const entry of graceEntries) graceTotals.set(entry.student_id, (graceTotals.get(entry.student_id) || 0) + Math.abs(Number(entry.delta || 0)));
  const rows = students.map((s: any) => ({
    id: s.id,
    name: s.name,
    grade: s.grade,
    homeroom: s.homeroom,
    discipline: disciplineSummaries[s.id],
    praise: praiseSummaries[s.id],
    graceTotal: graceTotals.get(s.id) || 0,
  }));

  return NextResponse.json({ students: rows });
}
