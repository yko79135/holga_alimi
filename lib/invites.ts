import { randomBytes } from "node:crypto";

export const INVITE_DEFAULT_EXPIRY_DAYS = 7;
export const INVITE_MAX_EXPIRY_DAYS = 30;

export function generateInviteToken() {
  return randomBytes(32).toString("base64url");
}

export type InviteValidityRecord = { used_at: string | null; revoked_at: string | null; expires_at: string };

export function invalidInviteReason(invite: InviteValidityRecord): string | null {
  if (invite.revoked_at) return "취소된 초대 링크입니다. 학교에 새 링크를 요청해주세요.";
  if (invite.used_at) return "이미 사용된 초대 링크입니다.";
  if (new Date(invite.expires_at).getTime() <= Date.now()) return "만료된 초대 링크입니다. 학교에 새 링크를 요청해주세요.";
  return null;
}

export type InviteStatus = "pending" | "used" | "expired" | "revoked";

export function inviteStatus(invite: InviteValidityRecord): InviteStatus {
  if (invite.revoked_at) return "revoked";
  if (invite.used_at) return "used";
  if (new Date(invite.expires_at).getTime() <= Date.now()) return "expired";
  return "pending";
}
