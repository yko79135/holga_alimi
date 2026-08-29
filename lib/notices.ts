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

/** warning/attendance/praise notices are generated automatically by the dedicated
 * discipline/praise/attendance flows, so they're excluded from the manual compose dropdown.
 * NOTICE_TYPE_LABELS keeps them for rendering historical notices of those types. */
export const COMPOSABLE_NOTICE_TYPES: string[] = ["newsletter", "guidance", "consultation", "urgent"];

/** "직접 입력" notices carry their own free-text type label instead of a fixed one. */
export function noticeTypeLabel(notice: { type: string; custom_type_label?: string | null }) {
  if (notice.type === CUSTOM_NOTICE_TYPE) return notice.custom_type_label?.trim() || "직접 입력";
  return NOTICE_TYPE_LABELS[notice.type] || notice.type;
}

/** Who a 학교 전체 notice actually goes out to. Only meaningful for target_scope = 'school':
 * grade- and student-scoped notices are always parent-facing, so they stay on 'parents'. */
export const NOTICE_AUDIENCES = ["parents", "parents_and_staff", "staff"] as const;

export type NoticeAudience = (typeof NOTICE_AUDIENCES)[number];

export const NOTICE_AUDIENCE_LABELS: Record<NoticeAudience, string> = {
  parents: "모든 학부모",
  parents_and_staff: "모든 학부모 및 교사",
  staff: "모든 교사",
};

export const DEFAULT_NOTICE_AUDIENCE: NoticeAudience = "parents";

export function isNoticeAudience(value: unknown): value is NoticeAudience {
  return typeof value === "string" && (NOTICE_AUDIENCES as readonly string[]).includes(value);
}

/** Notices on 'staff' never reach parents; the other two do. */
export function audienceIncludesParents(audience: unknown) {
  return !isNoticeAudience(audience) || audience !== "staff";
}

export function audienceIncludesStaff(audience: unknown) {
  return isNoticeAudience(audience) && audience !== "parents";
}

export function noticeAudienceLabel(audience: unknown) {
  return isNoticeAudience(audience) ? NOTICE_AUDIENCE_LABELS[audience] : NOTICE_AUDIENCE_LABELS.parents;
}
