import { randomBytes } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";

export const INVITE_DEFAULT_EXPIRY_DAYS = 30;
export const INVITE_MAX_EXPIRY_DAYS = 30;
export const MAX_CHILDREN_PER_SIGNUP = 5;

/** Trim + collapse internal whitespace, case-insensitive. No fuzzy matching -- a false-positive
 * match here means linking a parent to the wrong child's records, which is worse than asking
 * them to retype a name. */
export function normalizeMatchText(value: string) {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

export type StudentCandidate = { id: string; name: string; grade: string; homeroom: string | null };

/** Matches on normalized name + grade together (not name alone) -- same-name-same-grade
 * collisions are much rarer than same-name-anywhere, especially with common Korean names. */
export async function findMatchingStudents(studentName: string, studentGrade: string): Promise<StudentCandidate[]> {
  const admin = createAdminClient();
  const normalizedName = normalizeMatchText(studentName);
  const normalizedGrade = normalizeMatchText(studentGrade);
  if (!normalizedName || !normalizedGrade) return [];

  const { data, error } = await admin.from("students").select("id,name,grade,homeroom").eq("active", true);
  // Surface a failed lookup instead of silently returning "no matches" -- treating a query
  // failure as "definitely no existing student" would make the caller create a duplicate.
  if (error) throw new Error(`STUDENT_LOOKUP_FAILED: ${error.message}`);
  return (data || []).filter((student) => normalizeMatchText(student.name) === normalizedName && normalizeMatchText(student.grade) === normalizedGrade);
}

export function generateInviteToken() {
  return randomBytes(32).toString("base64url");
}

// Invites are reusable until they expire or are revoked -- there is no single-use "used" state.
export type InviteValidityRecord = { revoked_at: string | null; expires_at: string };

export function invalidInviteReason(invite: InviteValidityRecord): string | null {
  if (invite.revoked_at) return "취소된 초대 링크입니다. 학교에 새 링크를 요청해주세요.";
  if (new Date(invite.expires_at).getTime() <= Date.now()) return "만료된 초대 링크입니다. 학교에 새 링크를 요청해주세요.";
  return null;
}

export type InviteStatus = "active" | "expired" | "revoked";

export function inviteStatus(invite: InviteValidityRecord): InviteStatus {
  if (invite.revoked_at) return "revoked";
  if (new Date(invite.expires_at).getTime() <= Date.now()) return "expired";
  return "active";
}
