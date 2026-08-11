export const NOTICE_TYPE_LABELS: Record<string, string> = {
  newsletter: "가정통신문",
  warning: "훈계 점수",
  guidance: "생활지도",
  consultation: "상담 안내",
  urgent: "긴급 공지",
  attendance: "출결 안내",
  praise: "칭찬합니다",
};

export const CUSTOM_NOTICE_TYPE = "custom";

/** "직접 입력" notices carry their own free-text type label instead of a fixed one. */
export function noticeTypeLabel(notice: { type: string; custom_type_label?: string | null }) {
  if (notice.type === CUSTOM_NOTICE_TYPE) return notice.custom_type_label?.trim() || "직접 입력";
  return NOTICE_TYPE_LABELS[notice.type] || notice.type;
}
