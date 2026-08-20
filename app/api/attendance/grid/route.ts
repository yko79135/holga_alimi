import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getUserRoles } from "@/lib/roles-server";
import { effectiveStaffRole } from "@/lib/roles";
import { latestStatusByStudentDate } from "@/lib/attendance/aggregate";
import { emptyExceptionCounts, type AttendanceExceptionStatus, type AttendanceGridStudent, type AttendanceStatus } from "@/lib/attendance/types";
import { sortGrades } from "@/lib/grade-sort";

export const runtime = "nodejs";

async function staff() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { e: NextResponse.json({ error: "세션이 만료되었습니다. 다시 로그인해 주세요." }, { status: 401 }) };
  const roles = await getUserRoles(supabase, user.id);
  if (!roles.includes("admin") && !roles.includes("teacher")) return { e: NextResponse.json({ error: "교사 또는 관리자 권한이 필요합니다." }, { status: 403 }) };
  return { supabase, role: effectiveStaffRole(roles) || "teacher" };
}

function monthDates(year: number, month: number) {
  const cursor = new Date(Date.UTC(year, month - 1, 1));
  const dates: string[] = [];
  while (cursor.getUTCMonth() === month - 1) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

export async function GET(req: Request) {
  const a = await staff();
  if ("e" in a) return a.e;

  const url = new URL(req.url);
  const year = Number(url.searchParams.get("year") || new Date().getFullYear());
  const semester = Number(url.searchParams.get("semester") || 1);
  const month = Number(url.searchParams.get("month") || new Date().getMonth() + 1);
  const grade = url.searchParams.get("grade") || "";
  const studentName = url.searchParams.get("student") || "";
  const dates = monthDates(year, month);
  const monthPrefix = `${year}-${String(month).padStart(2, "0")}`;

  let studentQuery = a.supabase.from("students").select("id,name,grade,homeroom,active,parent_students(parent_id)").eq("active", true).order("grade").order("name");
  if (grade) studentQuery = studentQuery.eq("grade", grade);
  if (studentName) studentQuery = studentQuery.ilike("name", `%${studentName}%`);
  const { data: students, error: studentsError } = await studentQuery;
  if (studentsError) return NextResponse.json({ error: "출결 내역을 불러오는 중 오류가 발생했습니다." }, { status: 500 });

  const ids = (students || []).map((s: any) => s.id);
  let entries: any[] = [];
  if (ids.length) {
    const { data, error } = await a.supabase.from("attendance_entries").select("student_id,attendance_date,new_status,created_at").in("student_id", ids).eq("academic_year", year).eq("semester", semester);
    if (error && error.code !== "42P01") return NextResponse.json({ error: error.message }, { status: 500 });
    entries = data || [];
  }
  const latestMap = latestStatusByStudentDate(entries);

  const rows: AttendanceGridStudent[] = (students || []).map((student: any) => {
    const daily: Record<string, AttendanceStatus> = Object.fromEntries(dates.map((date) => [date, "present" as AttendanceStatus]));
    const monthlyCounts = emptyExceptionCounts();
    const semesterCounts = emptyExceptionCounts();
    let lastUpdatedAt: string | null = null;
    for (const [key, entry] of latestMap) {
      const [studentId, date] = key.split(":");
      if (studentId !== student.id) continue;
      if (entry.status !== "present") semesterCounts[entry.status as AttendanceExceptionStatus]++;
      if (date.startsWith(monthPrefix)) {
        daily[date] = entry.status;
        if (entry.status !== "present") monthlyCounts[entry.status as AttendanceExceptionStatus]++;
      }
      if (!lastUpdatedAt || entry.created_at > lastUpdatedAt) lastUpdatedAt = entry.created_at;
    }
    return {
      id: student.id,
      name: student.name,
      grade: student.grade,
      homeroom: student.homeroom,
      parentCount: Array.isArray(student.parent_students) ? student.parent_students.length : 0,
      daily,
      monthlyCounts,
      semesterCounts,
      lastUpdatedAt,
    };
  });

  return NextResponse.json({ dates, students: rows, grades: sortGrades(Array.from(new Set((students || []).map((s: any) => s.grade)))) });
}
