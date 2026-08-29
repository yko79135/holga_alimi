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

## 조퇴 · 결석 신청

Supabase SQL Editor에서 `supabase/20260828_homeroom_and_early_dismissal.sql`를 먼저 실행하고, 이어서 `supabase/20260829_early_dismissal_no_approval.sql`, `supabase/20260830_principal_designation.sql`, `supabase/20260831_early_dismissal_absence_request_type.sql`를 순서대로 실행하세요. 두 번째 파일이 결재 절차를 걷어내고 출석부 기록 칸을 추가하며, 세 번째 파일이 교장 선생님 지정을, 네 번째 파일이 결석 신청을 위한 `request_type` 칸을 추가합니다.

### 동작 방식

1. 학부모가 `조퇴·결석 신청` 탭에서 신청 종류(조퇴 / 결석), 자녀, 날짜, 사유, 인솔자를 입력해 신청합니다. 연결된 자녀만 신청할 수 있습니다.
2. `조퇴`는 조퇴 시각과 당일 복귀 여부를 함께 받습니다. `결석`은 하루 전체이므로 두 칸이 화면에서 사라지고 저장도 되지 않습니다. 나머지 입력 칸과 절차는 두 종류가 완전히 같습니다.
3. 같은 자녀·같은 날짜에는 종류와 상관없이 신청을 하나만 넣을 수 있습니다.
4. 제출 즉시 **모든 교사·관리자**에게 웹 푸시 알림이 전송됩니다. 알림을 누르면 교사 화면의 `조퇴·결석 신청` 탭으로 바로 이동합니다.
5. 승인·반려 절차는 없습니다. 모든 선생님이 내용을 열람하고 `확인` 버튼으로 확인 기록을 남길 수 있습니다.
6. 선생님이 `출석부에 조퇴 기록` / `출석부에 결석 기록`을 누르면 해당 날짜의 출결이 신청한 종류대로(조퇴는 `early_leave`, 결석은 `absent`) 기록됩니다. 잘못 눌렀으면 `기록 취소`로 되돌립니다.
7. 학부모는 출석부에 기록되기 전까지 신청을 취소할 수 있고, 취소되면 선생님들께 알림이 갑니다.

### 출석부 기록 규칙

기존 출결 기록과 같은 방식(`attendance_change_batches` + `attendance_entries`)으로 저장되므로, 출석 관리 화면과 출석 통계에 그대로 반영되고 이력도 남습니다. 버튼을 누른 선생님이 작성자로 기록됩니다.

- 해당 날짜가 **이미 신청한 종류와 같은 상태로 기록되어 있으면** 아무것도 쓰지 않습니다.
- 해당 날짜에 **다른 출결 상태가 있으면** 그 값을 이전 상태로 남기고 신청한 종류로 바꿉니다.
- `기록 취소`는 기록 직전 상태로 되돌립니다. 다만 그 사이에 출석부를 직접 고쳤다면 건드리지 않고 그대로 둡니다.
- 출석부 기록에 실패하면 화면에 안내가 뜹니다. 출석 관리에서 직접 입력해 주세요.

### 홈룸 배정

관리자 계정의 `계정 관리` 탭에 `홈룸 · 교장 · 교감 선생님 지정` 카드가 있습니다. 조퇴·결석 신청 목록과 알림에 학생의 홈룸 선생님이 함께 표시됩니다. 결재 권한과는 무관하며, 표시용 명단입니다.

마이그레이션이 아래 배정을 넣고, 같은 이름의 교사·관리자 계정이 하나만 있으면 자동으로 연결합니다. 계정을 연결하면 표시 이름이 그 계정의 이름을 따릅니다.

| 학년 | 홈룸 선생님 |
| --- | --- |
| G1 | 임예을 |
| G2 · G3 | 홍성혜 |
| G4 | 고영찬 |
| G5 · G6 | 오민진 |
| G7 | 송재승 |
| G8 ~ G12 | 이은총 |

교장 선생님은 홍인숙 선생님, 교감 선생님은 이은총 선생님입니다. 새 학년 라벨로 학생을 등록하면 그 학년이 목록에 자동으로 나타납니다.
