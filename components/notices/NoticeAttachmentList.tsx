import { formatBytes, isImageMime } from "@/lib/notice-security";

type Attachment = { id: string; original_filename: string; size_bytes: number; mime_type?: string | null };

/** 알림에 붙은 첨부 목록. 이미지는 열지 않아도 보이도록 본문 아래에 바로 띄운다. */
export default function NoticeAttachmentList({ attachments }: { attachments: Attachment[] }) {
  return (
    <div className="attachment-list">
      {attachments.map((att) => (
        <div className="attachment-item" key={att.id}>
          {isImageMime(att.mime_type) && (
            <a className="attachment-image" href={`/api/attachments/${att.id}`} target="_blank">
              <img src={`/api/attachments/${att.id}`} alt={att.original_filename} loading="lazy" />
            </a>
          )}
          <span>
            {isImageMime(att.mime_type) ? "🖼️" : "📎"} {att.original_filename} · {formatBytes(att.size_bytes)}
          </span>
          <a className="secondary" href={`/api/attachments/${att.id}`} target="_blank">
            미리보기
          </a>
          <a className="secondary" href={`/api/attachments/${att.id}?download=1`}>
            다운로드
          </a>
        </div>
      ))}
    </div>
  );
}
