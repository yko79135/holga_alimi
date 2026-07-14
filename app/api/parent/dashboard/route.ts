import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getUserRoles } from "@/lib/roles-server";

export async function GET() {
  const start = process.env.NODE_ENV !== "production" ? performance.now() : 0;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  const roles = await getUserRoles(supabase, user.id);
  if (!roles.includes("parent")) return NextResponse.json({ error: "학부모 권한이 필요합니다." }, { status: 403 });

  const { data: links } = await supabase.from("parent_students").select("student_id,students(id,name,grade,homeroom)").eq("parent_id", user.id);
  const studentRows = (links || []).flatMap((row: any) => Array.isArray(row.students) ? row.students : row.students ? [row.students] : []);
  const studentIds = studentRows.map((s: any) => s.id);
  const grades = Array.from(new Set(studentRows.map((s: any) => s.grade).filter(Boolean)));

  const [{ data: school }, { data: grade }, { data: individual }, { data: warnings }] = await Promise.all([
    supabase.from("notices").select("id,type,title,body,target_scope,target_grade,requires_confirmation,published_at,notice_attachments(id,original_filename,size_bytes),acknowledgements!left(read_at,confirmed_at,parent_reply,replied_at)").eq("target_scope", "school").eq("acknowledgements.parent_id", user.id).order("published_at", { ascending: false }),
    grades.length ? supabase.from("notices").select("id,type,title,body,target_scope,target_grade,requires_confirmation,published_at,notice_attachments(id,original_filename,size_bytes),acknowledgements!left(read_at,confirmed_at,parent_reply,replied_at)").eq("target_scope", "grade").in("target_grade", grades).eq("acknowledgements.parent_id", user.id).order("published_at", { ascending: false }) : Promise.resolve({ data: [] }),
    studentIds.length ? supabase.from("notices").select("id,type,title,body,target_scope,target_grade,requires_confirmation,published_at,notice_students!inner(student_id,students(id,name,grade,homeroom)),notice_attachments(id,original_filename,size_bytes),acknowledgements!left(read_at,confirmed_at,parent_reply,replied_at)").eq("target_scope", "student").in("notice_students.student_id", studentIds).eq("acknowledgements.parent_id", user.id).order("published_at", { ascending: false }) : Promise.resolve({ data: [] }),
    studentIds.length ? supabase.rpc("parent_warning_entries") : Promise.resolve({ data: [] }),
  ] as any);

  const map = new Map<string, any>();
  for (const notice of [...(school || []), ...(grade || []), ...(individual || [])]) map.set(notice.id, notice);
  const notices = Array.from(map.values()).sort((a, b) => String(b.published_at).localeCompare(String(a.published_at)));
  if (process.env.NODE_ENV !== "production") console.debug("parent-dashboard-fetch", { durationMs: Math.round(performance.now() - start) });
  return NextResponse.json({ students: studentRows, notices, warnings: warnings || [] });
}
