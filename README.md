# 학교 학부모 소통 포털

학부모별 로그인, 학생별 비공개 알림, 가정통신문, 읽음/확인/답변 기록을 제공하는 Next.js + Supabase 웹앱입니다.

## 핵심 기능

- 관리자: 학생 등록, 학부모/교사 계정 발급, 학부모-학생 연결
- 교사: 학교 전체·학년·개별 학생 대상 알림 발송
- 학부모: 연결된 자녀 관련 알림만 열람
- 경고/생활지도 알림의 읽음 및 확인 완료 기록
- 학부모 답변을 교사 발송 기록에서 확인
- 모바일 반응형 화면
- Supabase Row Level Security로 서버/브라우저 양쪽에서 개인정보 분리

## 1. Supabase 설정

1. Supabase에서 새 프로젝트를 만듭니다.
2. SQL Editor에서 `supabase/schema.sql` 전체를 실행합니다.
3. Authentication > Users에서 첫 관리자 계정을 직접 생성합니다.
4. `supabase/bootstrap-admin.sql`의 이메일을 방금 만든 계정 이메일로 바꾸고 실행합니다.
5. Project Settings에서 Project URL, Publishable key(또는 anon key), service_role key를 확인합니다.

중요: `service_role` 키는 `.env.local`과 Vercel 서버 환경변수에만 저장하세요. 브라우저 코드나 GitHub에 올리면 안 됩니다.

## 2. 로컬 실행

```bash
cp .env.example .env.local
npm install
npm run dev
```

`.env.local`에 실제 키를 입력합니다.

```env
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
NEXT_PUBLIC_SCHOOL_NAME=우리학교 학부모 포털
```

브라우저에서 `http://localhost:3000`을 엽니다.

## 3. 최초 운영 순서

1. 관리자 로그인
2. `학생 관리`에서 학생 등록
3. `계정 관리`에서 학부모 계정 생성 및 자녀 연결
4. 교사 계정 생성
5. `알림 작성`에서 전체/학년/학생 대상을 선택하여 발송

## 4. Vercel 배포

1. 이 폴더를 GitHub 저장소에 업로드합니다.
2. Vercel에서 저장소를 Import합니다.
3. Vercel Project Settings > Environment Variables에 `.env.local`의 네 변수를 등록합니다.
4. Deploy합니다.
5. Supabase Authentication > URL Configuration의 Site URL을 Vercel 주소로 설정합니다.

## 개인정보 운영 권장사항

- 경고/생활지도 내용은 필요한 사실과 지도 내용만 기록합니다.
- 비밀번호는 교사가 대신 보관하지 말고 임시 비밀번호 전달 후 변경하도록 운영합니다.
- 퇴학·졸업·퇴사 계정은 즉시 비활성화하거나 삭제합니다.
- 실제 운영 전 학부모 개인정보 수집·이용 동의 문구와 학교의 보존 기간 정책을 정합니다.
- 문자·카카오톡·이메일 푸시 알림은 별도 외부 서비스 연동이 필요합니다. 현재 버전은 로그인 후 확인하는 인앱 알림 방식입니다.

## Notice attachments and Web Push setup

Run `supabase/20260713_notice_attachments_push.sql` in the Supabase SQL Editor. It creates the private `notice-attachments` Storage bucket, `notice_attachments`, `push_subscriptions`, indexes, and RLS policies.

VAPID keys are required for Web Push. Generate placeholders locally with:

```bash
npx web-push generate-vapid-keys
```

Add these Vercel environment variables without committing real secrets:

- `NEXT_PUBLIC_VAPID_PUBLIC_KEY` - public VAPID key exposed to browsers.
- `VAPID_PRIVATE_KEY` - private VAPID key, server-only.
- `VAPID_SUBJECT` - contact URI such as `mailto:school@example.com`.

Existing Supabase variables remain required: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and server-only `SUPABASE_SERVICE_ROLE_KEY`.
