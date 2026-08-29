export type SafePushPayload = { title: string; body: string; noticeId: string; url: string; category: "general" | "individual" | "staff" | "early_dismissal" };

const BODY_PREVIEW_LENGTH = 120;

function previewBody(body: string, max = BODY_PREVIEW_LENGTH) {
  const trimmed = body.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed;
}

/** Shows the notice's own title/body preview so parents know what arrived before opening the
 * app, and deep-links straight to that notice. */
export function buildSafeNoticePayload(notice: { id: string; title: string; body: string; target_scope: string }): SafePushPayload {
  const individual = notice.target_scope === "student";
  return {
    title: notice.title,
    body: previewBody(notice.body),
    noticeId: notice.id,
    url: `/dashboard?view=parent&notice=${encodeURIComponent(notice.id)}`,
    category: individual ? "individual" : "general",
  };
}

/** Staff-facing variant of the same notice, deep-linking into the staff notices tab instead. */
export function buildStaffNoticePayload(notice: { id: string; title: string; body: string }): SafePushPayload {
  return {
    title: notice.title,
    body: previewBody(notice.body),
    noticeId: notice.id,
    url: `/dashboard?view=staff&tab=notices&notice=${encodeURIComponent(notice.id)}`,
    category: "staff",
  };
}

/** Sent to the notice's author when a parent replies, naming who replied. */
export function buildReplyPushPayload(notice: { id: string; title: string }, parentName: string, replyText: string): SafePushPayload {
  return {
    title: `${parentName}님이 답변했습니다`,
    body: `${notice.title}: ${previewBody(replyText, 100)}`,
    noticeId: notice.id,
    url: `/dashboard?view=staff&tab=notices&notice=${encodeURIComponent(notice.id)}`,
    category: "staff",
  };
}

/** Early dismissal (조퇴) and absence (결석) pushes carry the request id rather than a notice id:
 * the service worker only uses it as the notification `tag`, and a per-request tag is what keeps
 * the submission and any later cancellation from silently overwriting one another on the device. */
export function buildEarlyDismissalPayload(requestId: string, content: { title: string; body: string }, audience: "staff" | "parent"): SafePushPayload {
  return {
    title: content.title,
    body: previewBody(content.body, 160),
    noticeId: `early-dismissal:${requestId}`,
    url: audience === "staff"
      ? `/dashboard?view=staff&tab=early-dismissal&request=${encodeURIComponent(requestId)}`
      : `/dashboard?view=parent&tab=early-dismissal&request=${encodeURIComponent(requestId)}`,
    category: "early_dismissal",
  };
}
