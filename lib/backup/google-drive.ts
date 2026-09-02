import "server-only";

import { backupRetentionDays, expiredBackupNames } from "@/lib/backup/storage";

/** 구글 드라이브 사본. Supabase 버킷과 같은 JSON을 한 벌 더 올려 두어서, Supabase 프로젝트
 * 자체를 잃어도 백업이 남게 합니다.
 *
 * 라이브러리 없이 REST 로만 부릅니다. 권한은 `drive.file` 하나면 충분한데, 이 범위는 이 앱이
 * 만든 파일에만 닿기 때문에 드라이브의 다른 파일은 읽지도 쓰지도 못합니다. 그래서 저장 폴더도
 * (직접 지정하지 않으면) 앱이 스스로 만들어 씁니다. */
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const FILES_ENDPOINT = "https://www.googleapis.com/drive/v3/files";
const UPLOAD_ENDPOINT = "https://www.googleapis.com/upload/drive/v3/files";
const DEFAULT_FOLDER_NAME = "홀가 알림 자동 백업";
const FOLDER_MIME = "application/vnd.google-apps.folder";
const BACKUP_MIME = "application/json";

export class GoogleDriveError extends Error {}

export type DriveConfig = {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  folderId: string | null;
  folderName: string;
};

export type DriveSaveResult = {
  fileId: string;
  folderId: string;
  folderUrl: string;
  removed: string[];
};

/** 아무것도 설정하지 않았으면 null(=드라이브 사본을 쓰지 않음). 일부만 설정했으면 조용히
 * 넘어가지 않고 알려 줍니다. 반쯤 설정해 두고 저장되는 줄 아는 상황이 제일 위험합니다. */
export function readDriveConfig(): DriveConfig | null {
  const clientId = process.env.GOOGLE_DRIVE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_DRIVE_CLIENT_SECRET?.trim();
  const refreshToken = process.env.GOOGLE_DRIVE_REFRESH_TOKEN?.trim();
  const provided = [clientId, clientSecret, refreshToken].filter(Boolean).length;

  if (provided === 0) return null;
  if (provided < 3) {
    throw new GoogleDriveError("구글 드라이브 환경변수가 일부만 설정되어 있습니다. GOOGLE_DRIVE_CLIENT_ID, GOOGLE_DRIVE_CLIENT_SECRET, GOOGLE_DRIVE_REFRESH_TOKEN 세 개를 모두 넣어 주세요.");
  }

  return {
    clientId: clientId!,
    clientSecret: clientSecret!,
    refreshToken: refreshToken!,
    folderId: process.env.GOOGLE_DRIVE_FOLDER_ID?.trim() || null,
    folderName: process.env.GOOGLE_DRIVE_FOLDER_NAME?.trim() || DEFAULT_FOLDER_NAME,
  };
}

export function driveFolderUrl(folderId: string) {
  return `https://drive.google.com/drive/folders/${folderId}`;
}

/** 같은 이름의 파일이 이미 있으면 내용만 갈아끼웁니다(하루 두 번 돌아도 파일이 늘지 않음).
 * 올린 뒤 보관 기간이 지난 예전 백업을 지웁니다. */
export async function saveBackupToDrive(config: DriveConfig, filename: string, body: string, now: Date = new Date()): Promise<DriveSaveResult> {
  const token = await requestAccessToken(config);
  const folderId = await resolveFolderId(config, token);
  const existingId = await findFileId(token, folderId, filename);
  const fileId = existingId
    ? await updateFile(token, existingId, body)
    : await createFile(token, folderId, filename, body);

  return { fileId, folderId, folderUrl: driveFolderUrl(folderId), removed: await pruneOldBackups(token, folderId, now) };
}

async function requestAccessToken(config: DriveConfig) {
  const response = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: config.refreshToken,
      grant_type: "refresh_token",
    }),
  });

  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.access_token) {
    // invalid_grant 은 대개 리프레시 토큰이 만료·취소된 경우라 다시 발급받아야 합니다.
    const reason = result.error === "invalid_grant"
      ? "GOOGLE_DRIVE_REFRESH_TOKEN 이 만료되었거나 취소되었습니다. 토큰을 다시 발급받아 주세요."
      : describeError(result, response.status);
    throw new GoogleDriveError(`구글 드라이브 인증에 실패했습니다: ${reason}`);
  }
  return result.access_token as string;
}

/** 폴더를 직접 지정했으면 그것을, 아니면 앱이 예전에 만든 폴더를, 그것도 없으면 새로 만듭니다. */
async function resolveFolderId(config: DriveConfig, token: string) {
  if (config.folderId) return config.folderId;

  const found = await queryFiles(token, `mimeType = '${FOLDER_MIME}' and name = '${escapeQueryValue(config.folderName)}' and trashed = false`);
  if (found.length) return found[0].id;

  return createFolder(token, config.folderName);
}

async function createFolder(token: string, name: string) {
  const response = await fetch(`${FILES_ENDPOINT}?fields=id`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name, mimeType: FOLDER_MIME }),
  });
  const result = await driveJson(response, "백업 폴더를 만들지 못했습니다");
  return result.id as string;
}

async function findFileId(token: string, folderId: string, filename: string) {
  const files = await queryFiles(token, `name = '${escapeQueryValue(filename)}' and '${escapeQueryValue(folderId)}' in parents and trashed = false`);
  return files.length ? files[0].id : null;
}

async function createFile(token: string, folderId: string, filename: string, body: string) {
  const boundary = `holga-${crypto.randomUUID()}`;
  const metadata = JSON.stringify({ name: filename, parents: [folderId] });
  const multipart = [
    `--${boundary}`,
    "Content-Type: application/json; charset=UTF-8",
    "",
    metadata,
    `--${boundary}`,
    `Content-Type: ${BACKUP_MIME}; charset=UTF-8`,
    "",
    body,
    `--${boundary}--`,
    "",
  ].join("\r\n");

  const response = await fetch(`${UPLOAD_ENDPOINT}?uploadType=multipart&fields=id`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": `multipart/related; boundary=${boundary}` },
    body: multipart,
  });
  const result = await driveJson(response, "백업 파일을 구글 드라이브에 올리지 못했습니다");
  return result.id as string;
}

async function updateFile(token: string, fileId: string, body: string) {
  const response = await fetch(`${UPLOAD_ENDPOINT}/${fileId}?uploadType=media&fields=id`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": `${BACKUP_MIME}; charset=UTF-8` },
    body,
  });
  const result = await driveJson(response, "구글 드라이브의 오늘 백업 파일을 갱신하지 못했습니다");
  return result.id as string;
}

/** 지우기가 실패해도 백업 자체는 이미 올라갔으므로 실행을 실패로 만들지는 않습니다. */
async function pruneOldBackups(token: string, folderId: string, now: Date) {
  let files: Array<{ id: string; name: string }>;
  try {
    files = await queryFiles(token, `'${escapeQueryValue(folderId)}' in parents and trashed = false`);
  } catch {
    return [];
  }

  const expired = expiredBackupNames(files.map((file) => file.name), backupRetentionDays(), now);
  const removed: string[] = [];
  for (const name of expired) {
    const file = files.find((candidate) => candidate.name === name)!;
    const response = await fetch(`${FILES_ENDPOINT}/${file.id}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
    if (response.ok) removed.push(name);
  }
  return removed;
}

async function queryFiles(token: string, q: string) {
  const url = new URL(FILES_ENDPOINT);
  url.searchParams.set("q", q);
  url.searchParams.set("fields", "files(id,name)");
  url.searchParams.set("pageSize", "1000");
  url.searchParams.set("orderBy", "name");

  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const result = await driveJson(response, "구글 드라이브 파일 목록을 읽지 못했습니다");
  return (result.files || []) as Array<{ id: string; name: string }>;
}

async function driveJson(response: Response, whatFailed: string) {
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new GoogleDriveError(`${whatFailed}: ${describeError(result, response.status)}`);
  return result as Record<string, unknown> & { id?: string; files?: unknown };
}

function describeError(result: { error?: unknown; error_description?: string }, status: number) {
  if (typeof result.error === "object" && result.error && "message" in result.error) return String((result.error as { message: unknown }).message);
  if (result.error_description) return result.error_description;
  if (typeof result.error === "string") return result.error;
  return `HTTP ${status}`;
}

/** 드라이브 검색어(q)의 작은따옴표 문자열 안에서 특별한 뜻을 갖는 문자만 막습니다. */
function escapeQueryValue(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}
