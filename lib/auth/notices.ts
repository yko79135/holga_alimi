/** Status codes passed as `?notice=` when a Supabase auth email link lands back on the app.
 * Shared by /auth/callback (which sets them), the login form and 계정 설정 (which show them). */
export type AuthNoticeCode =
  | "email_change_done"
  | "confirmed"
  | "email_change_partial"
  | "link_expired"
  | "verifier_missing"
  | "confirm_failed";

export type AuthNoticeTone = "success" | "info" | "error";

type AuthNotice = { tone: AuthNoticeTone; message: string };

const AUTH_NOTICES: Record<AuthNoticeCode, AuthNotice> = {
  email_change_done: {
    tone: "success",
    message: "이메일 변경이 확인되었습니다. 앞으로는 새 이메일 주소로 로그인해 주세요.",
  },
  confirmed: {
    tone: "success",
    message: "확인이 완료되었습니다.",
  },
  email_change_partial: {
    tone: "info",
    message:
      "확인 링크가 접수되었습니다. 이 프로젝트는 기존 이메일과 새 이메일 양쪽으로 확인 메일을 보내므로, 두 링크를 모두 눌러야 변경이 완료됩니다. 나머지 메일함의 링크도 확인해 주세요.",
  },
  link_expired: {
    tone: "error",
    message: "확인 링크가 만료되었거나 이미 사용되었습니다. 계정 설정에서 이메일 변경을 다시 요청해 주세요.",
  },
  verifier_missing: {
    tone: "error",
    message:
      "확인 링크는 이메일 변경을 요청한 것과 같은 기기·브라우저에서 열어야 합니다. 요청했던 브라우저에서 메일을 열어 링크를 다시 눌러주세요.",
  },
  confirm_failed: {
    tone: "error",
    message: "확인 링크 처리에 실패했습니다. 계정 설정에서 이메일 변경을 다시 요청해 주세요.",
  },
};

export function isAuthNoticeCode(value: unknown): value is AuthNoticeCode {
  return typeof value === "string" && value in AUTH_NOTICES;
}

export function resolveAuthNotice(value: unknown): AuthNotice | null {
  return isAuthNoticeCode(value) ? AUTH_NOTICES[value] : null;
}

/** Maps a GoTrue error (query param or exchange failure) onto a notice code. */
export function authNoticeFromError(reason: string): AuthNoticeCode {
  const text = reason.toLowerCase();
  if (text.includes("code verifier")) return "verifier_missing";
  if (text.includes("expired") || text.includes("invalid") || text.includes("already")) return "link_expired";
  return "confirm_failed";
}
