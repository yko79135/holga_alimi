import { isRequestType, requestState, type EarlyDismissalRequest } from "./types";

export const REQUEST_SELECT =
  "id,student_id,parent_id,request_type,dismissal_date,dismissal_time,reason,guardian_name,guardian_contact,returns_same_day," +
  "cancelled_at,attendance_recorded_at,attendance_recorded_by,created_at,students(id,name,grade)";

type Context = {
  /** Homeroom teacher's display name for the student's grade -- shown so staff can see whose
   * class the student is in. It carries no permission any more; anyone on staff can act. */
  homeroomTeacherName: string;
  /** profile id -> display name. Resolved server-side because RLS hides other people's profiles
   * from parents, and a parent still needs to see who handled their own child's request. */
  names: Map<string, string>;
  acknowledgedBy?: EarlyDismissalRequest["acknowledgedBy"];
};

export function serializeRequestRow(row: any, context: Context): EarlyDismissalRequest {
  const student = (Array.isArray(row.students) ? row.students[0] : row.students) || {};
  return {
    id: row.id,
    studentId: row.student_id,
    studentName: student.name || "학생",
    studentGrade: student.grade || "",
    parentId: row.parent_id,
    parentName: context.names.get(row.parent_id) || "학부모",
    // Rows written before the other kinds existed carry no request_type; they were all 조퇴.
    type: isRequestType(row.request_type) ? row.request_type : "early_dismissal",
    dismissalDate: row.dismissal_date,
    dismissalTime: row.dismissal_time,
    reason: row.reason,
    guardianName: row.guardian_name,
    guardianContact: row.guardian_contact,
    returnsSameDay: Boolean(row.returns_same_day),
    state: requestState(row),
    cancelledAt: row.cancelled_at,
    attendanceRecordedAt: row.attendance_recorded_at,
    attendanceRecordedByName: row.attendance_recorded_by ? context.names.get(row.attendance_recorded_by) || "선생님" : null,
    homeroomTeacherName: context.homeroomTeacherName || "미지정",
    createdAt: row.created_at,
    acknowledgedBy: context.acknowledgedBy || [],
  };
}
