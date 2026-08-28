import type { ApproverSlots } from "./approvers";
import type { EarlyDismissalRequest } from "./types";

export const REQUEST_SELECT =
  "id,student_id,parent_id,dismissal_date,dismissal_time,reason,guardian_name,guardian_contact,returns_same_day,status," +
  "homeroom_decision,homeroom_decided_by,homeroom_decided_at,homeroom_comment," +
  "vice_principal_decision,vice_principal_decided_by,vice_principal_decided_at,vice_principal_comment," +
  "cancelled_at,created_at,students(id,name,grade)";

type Context = ApproverSlots & {
  /** profile id -> display name. Resolved server-side because RLS hides other people's profiles
   * from parents, and a parent still needs to see who decided on their own child's request. */
  names: Map<string, string>;
  acknowledgedBy?: EarlyDismissalRequest["acknowledgedBy"];
};

function studentOf(row: any) {
  return Array.isArray(row.students) ? row.students[0] : row.students;
}

export function serializeRequestRow(row: any, context: Context): EarlyDismissalRequest {
  const student = studentOf(row) || {};
  const name = (id: string | null) => (id ? context.names.get(id) || "선생님" : null);
  return {
    id: row.id,
    studentId: row.student_id,
    studentName: student.name || "학생",
    studentGrade: student.grade || "",
    parentId: row.parent_id,
    parentName: context.names.get(row.parent_id) || "학부모",
    dismissalDate: row.dismissal_date,
    dismissalTime: row.dismissal_time,
    reason: row.reason,
    guardianName: row.guardian_name,
    guardianContact: row.guardian_contact,
    returnsSameDay: Boolean(row.returns_same_day),
    status: row.status,
    homeroom: {
      decision: row.homeroom_decision,
      decidedByName: name(row.homeroom_decided_by),
      decidedAt: row.homeroom_decided_at,
      comment: row.homeroom_comment,
    },
    vicePrincipal: {
      decision: row.vice_principal_decision,
      decidedByName: name(row.vice_principal_decided_by),
      decidedAt: row.vice_principal_decided_at,
      comment: row.vice_principal_comment,
    },
    homeroomTeacherName: context.homeroom.name || "미지정",
    vicePrincipalName: context.vicePrincipal.name || "미지정",
    createdAt: row.created_at,
    acknowledgedBy: context.acknowledgedBy || [],
  };
}
