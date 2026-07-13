export type SafePushPayload = { title: string; body: string; noticeId: string; url: string; category: "general" | "individual" };
export function buildSafeNoticePayload(notice: { id: string; target_scope: string }): SafePushPayload {
  const individual = notice.target_scope === "student";
  return {
    title: "홀가 학부모 포털",
    body: individual ? "새로운 개별 알림이 도착했습니다. 앱에서 로그인하여 확인해주세요." : "새로운 학교 알림이 도착했습니다. 앱에서 확인해주세요.",
    noticeId: notice.id,
    url: `/dashboard?notice=${encodeURIComponent(notice.id)}`,
    category: individual ? "individual" : "general",
  };
}
