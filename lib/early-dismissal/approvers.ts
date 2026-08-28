import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ApproverRole } from "./types";

export type ApproverSlot = { teacherId: string | null; name: string };
export type ApproverSlots = { homeroom: ApproverSlot; vicePrincipal: ApproverSlot };

/** Resolves the two approval slots for a grade. Both may be unlinked (teacherId null) if the
 * assignment exists only as a name; admins can still decide in that case -- see
 * public.can_decide_early_dismissal(). */
export async function resolveApproverSlots(supabase: SupabaseClient, grade: string): Promise<ApproverSlots> {
  const [homeroomRes, officerRes] = await Promise.all([
    supabase.from("homeroom_assignments").select("teacher_id,teacher_name").eq("grade", grade).maybeSingle(),
    supabase.from("school_officers").select("profile_id,person_name").eq("role_key", "vice_principal").maybeSingle(),
  ]);
  return {
    homeroom: { teacherId: (homeroomRes.data as any)?.teacher_id || null, name: (homeroomRes.data as any)?.teacher_name || "" },
    vicePrincipal: { teacherId: (officerRes.data as any)?.profile_id || null, name: (officerRes.data as any)?.person_name || "" },
  };
}

/** Which approval slots `userId` may sign. The vice principal is also the G8-G12 homeroom
 * teacher, so one account can legitimately hold both slots on the same request -- in that case a
 * single decision is recorded against both, rather than asking the same person twice. */
export function approverRolesFor(slots: ApproverSlots, userId: string, isAdmin: boolean): ApproverRole[] {
  const roles: ApproverRole[] = [];
  if (slots.homeroom.teacherId === userId) roles.push("homeroom");
  if (slots.vicePrincipal.teacherId === userId) roles.push("vice_principal");
  if (roles.length) return roles;
  // An admin stands in for an approval slot that has no linked account yet, so a request is never
  // permanently stuck waiting on a teacher who has not been given a portal account.
  if (isAdmin) {
    const standIn: ApproverRole[] = [];
    if (!slots.homeroom.teacherId) standIn.push("homeroom");
    if (!slots.vicePrincipal.teacherId) standIn.push("vice_principal");
    return standIn;
  }
  return [];
}
