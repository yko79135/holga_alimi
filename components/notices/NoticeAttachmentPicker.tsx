"use client";

import { useState } from "react";

import { formatBytes, MAX_NOTICE_ATTACHMENTS } from "@/lib/notice-security";

// 같은 파일을 또 골랐는지 판단한다. 브라우저는 고를 때마다 File 객체를 새로 만들기 때문에
// 객체끼리 비교할 수 없고 이름·크기·수정시각을 본다.
export function attachmentKey(file: File) { return `${file.name}::${file.size}::${file.lastModified}`; }

type Props = {
  /** 이번에 새로 올릴 파일들. */
  files: File[];
  onChange: (files: File[]) => void;
  /** 이미 발송된 알림에 붙어 있는 첨부. 수정 화면에서만 넘긴다. */
  existing?: Array<{ id: string; original_filename: string; size_bytes: number }>;
  /** 지우기로 표시한 기존 첨부 id. */
  removedExistingIds?: string[];
  onToggleExisting?: (attachmentId: string) => void;
  disabled?: boolean;
};

export default function NoticeAttachmentPicker({ files, onChange, existing = [], removedExistingIds = [], onToggleExisting, disabled }: Props) {
  const [note, setNote] = useState("");
  const keptExisting = existing.filter((attachment) => !removedExistingIds.includes(attachment.id));
  const total = keptExisting.length + files.length;

  // 파일 선택 창은 한 번에 한 폴더 안의 파일만 고를 수 있다. 그래서 고른 목록을 갈아끼우지 않고
  // 이어붙인다 — 폴더를 옮겨 가며 여러 번 골라도 앞서 고른 파일이 사라지지 않는다.
  function addFiles(selected: FileList | null) {
    const incoming = Array.from(selected || []);
    if (!incoming.length) return;
    const seen = new Set(files.map(attachmentKey));
    const fresh: File[] = [];
    let duplicates = 0;
    for (const file of incoming) {
      const key = attachmentKey(file);
      if (seen.has(key)) { duplicates += 1; continue; }
      seen.add(key);
      fresh.push(file);
    }
    const room = Math.max(MAX_NOTICE_ATTACHMENTS - total, 0);
    const accepted = fresh.slice(0, room);
    const overflow = fresh.length - accepted.length;
    if (accepted.length) onChange([...files, ...accepted]);
    // 조용히 빠뜨리지 않는다. 첨부가 말없이 사라지는 것이 원래 문제였다.
    const notes = [];
    if (duplicates) notes.push(`이미 고른 파일 ${duplicates}개는 건너뛰었습니다.`);
    if (overflow) notes.push(`최대 ${MAX_NOTICE_ATTACHMENTS}개까지만 첨부할 수 있어 ${overflow}개는 넣지 못했습니다.`);
    setNote(notes.join(" "));
  }

  const overflowed = total >= MAX_NOTICE_ATTACHMENTS;

  return (
    <div className="attachment-picker">
      <input
        type="file"
        accept="application/pdf"
        multiple
        disabled={disabled}
        onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }}
      />
      <p className="field-hint">
        파일 선택 창은 한 번에 한 폴더 안의 파일만 고를 수 있습니다. 파일이 여러 폴더에 흩어져 있으면 나눠서 고르세요 —
        먼저 고른 파일은 지워지지 않고 아래 목록에 계속 쌓입니다. 아래 목록에 있는 파일만 발송됩니다.
      </p>
      {(keptExisting.length > 0 || removedExistingIds.length > 0 || files.length > 0) && (
        <div className="attachment-list">
          {existing.map((attachment) => {
            const removed = removedExistingIds.includes(attachment.id);
            return (
              <div className={removed ? "attachment-item removed" : "attachment-item"} key={attachment.id}>
                <span>📎 {attachment.original_filename} · {formatBytes(attachment.size_bytes)}{removed ? " · 지울 예정" : ""}</span>
                {onToggleExisting && (
                  <button type="button" className="secondary" disabled={disabled} onClick={() => onToggleExisting(attachment.id)}>
                    {removed ? "되살리기" : "삭제"}
                  </button>
                )}
              </div>
            );
          })}
          {files.map((file) => (
            <div className="attachment-item" key={attachmentKey(file)}>
              <span>📎 {file.name} · {formatBytes(file.size)}{existing.length ? " · 새로 추가" : ""}</span>
              <button type="button" className="secondary" disabled={disabled} onClick={() => { setNote(""); onChange(files.filter((candidate) => attachmentKey(candidate) !== attachmentKey(file))); }}>삭제</button>
            </div>
          ))}
        </div>
      )}
      <p className="field-hint">첨부 {total}개 / 최대 {MAX_NOTICE_ATTACHMENTS}개{overflowed ? " · 더 넣으려면 먼저 하나를 지우세요." : ""}</p>
      {note && <p role="status" className="attachment-note">{note}</p>}
    </div>
  );
}
