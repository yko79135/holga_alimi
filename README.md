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

## 훈계·칭찬 점수 카테고리 관리

점수 카테고리 목록은 이제 코드 상수가 아니라 `point_categories` 테이블에 있습니다. Supabase SQL Editor에서 `supabase/20260826_point_categories.sql`를 실행하세요. 기존 카테고리 목록이 초기 데이터로 들어가고, `warning_entries`의 고정 카테고리 CHECK 제약이 테이블을 참조하는 트리거로 교체됩니다.

실행 후 관리자로 로그인하면 `훈계 점수`·`칭찬 점수` 탭 상단에서 수업 관리 옆에 카테고리 관리가 보입니다.

- 추가: 카테고리 이름(40자 이내)과 참고 점수(선택)를 입력하면 해당 탭의 카테고리 목록에 바로 추가됩니다. 참고 점수는 `거짓말 (10/5점)`처럼 안내로만 표시되고 입력 점수를 제한하지 않습니다.
- 비활성화: 목록에서만 감춰지고 과거 기록은 그대로 남습니다. 더 이상 쓰지 않는 카테고리는 삭제 대신 비활성화를 권장합니다.
- 삭제: 아직 한 번도 점수 부여에 쓰이지 않은 카테고리만 삭제할 수 있습니다.

교사 계정에서는 카테고리를 고르기만 하고, 추가·수정은 관리자만 할 수 있습니다.

## PWA icon cache after update

Users who installed the app before this icon update may continue seeing the old cached icon. They should:

1. Remove the existing Home Screen app.
2. Open the redeployed portal in Safari or Chrome.
3. Add or install it again.

Do not assume an already installed icon will always refresh automatically.

## 조퇴 신청과 홈룸 · 교감 승인

Supabase SQL Editor에서 `supabase/20260828_homeroom_and_early_dismissal.sql`를 실행하세요. 홈룸 배정표, 교감 지정, 조퇴 신청 테이블과 RLS 정책이 함께 생성됩니다.

### 동작 방식

1. 학부모가 `조퇴 신청` 탭에서 자녀, 날짜, 시각, 사유, 인솔자를 입력해 신청합니다. 연결된 자녀만 신청할 수 있습니다.
2. 제출 즉시 **모든 교사·관리자**에게 웹 푸시 알림이 전송됩니다. 알림을 누르면 교사 화면의 `조퇴 결재` 탭으로 바로 이동합니다.
3. 모든 선생님은 신청 내용을 열람하고 `확인` 버튼으로 확인 기록을 남길 수 있습니다.
4. **홈룸 선생님과 교감 선생님 두 사람이 모두 승인해야** 조퇴가 확정됩니다. 한 명이라도 반려하면 즉시 반려 처리됩니다.
5. 결재가 기록될 때마다 학부모에게 푸시 알림이 가고, 아직 결재하지 않은 다른 승인자에게도 알림이 전달됩니다.
6. 학부모는 승인 전까지 신청을 취소할 수 있습니다.

전체 상태(`status`)는 두 결재 칸에서 트리거로 계산되므로, 한쪽 결재가 남아 있는데 승인 완료로 표시되는 일은 없습니다.

### 홈룸 배정 초기값

마이그레이션이 아래 배정을 넣고, 같은 이름의 교사·관리자 계정이 하나만 있으면 자동으로 연결합니다.

| 학년 | 홈룸 선생님 |
| --- | --- |
| G1 | 임예을 |
| G2 · G3 | 홍성혜 |
| G4 | 고영찬 |
| G5 · G6 | 오민진 |
| G7 | 송재승 |
| G8 ~ G12 | 이은총 |

교감 선생님은 이은총 선생님입니다. 이은총 선생님은 G8~G12 홈룸도 맡고 있어 해당 학년 신청에서는 두 결재 칸을 겸합니다. 이 경우 한 번 승인하면 두 칸이 함께 기록되므로 같은 사람에게 두 번 묻지 않습니다.

### 배정 변경

관리자 계정의 `계정 관리` 탭에 `홈룸 · 교감 선생님 지정` 카드가 있습니다. 학년별로 이름을 적어두거나 실제 계정을 연결할 수 있습니다.

- 계정을 연결하면 그 선생님만 해당 학년의 조퇴를 결재할 수 있고, 표시 이름도 계정 이름을 따릅니다.
- 계정이 연결되지 않은 칸은 관리자가 대신 결재합니다. 아직 포털 계정이 없는 선생님 때문에 조퇴 신청이 멈추지 않도록 하기 위한 예외이며, 계정을 연결하면 관리자 대결재는 자동으로 사라집니다.
- 새 학년 라벨로 학생을 등록하면 그 학년이 목록에 자동으로 나타납니다. 홈룸 선생님을 지정하기 전까지는 관리자가 대신 결재합니다.
