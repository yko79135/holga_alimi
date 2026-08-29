/** 학기 이름: 상반기(1~7월)는 봄학기, 하반기(8~12월)는 가을학기.
 *
 * DB에는 지금까지처럼 semester 1 / 2 숫자로 저장하고 화면 표기만 이 이름을 씁니다. 저장값을
 * 그대로 두는 덕에 기존 기록과 학기 경계 규칙(lib/warnings/term.ts#semesterForMonth)이 전부
 * 그대로 유지되고, 마이그레이션도 필요하지 않습니다. */
export const SEMESTERS = [1, 2] as const;

export type Semester = (typeof SEMESTERS)[number];

export const SEMESTER_LABELS: Record<Semester, string> = {
  1: "봄학기",
  2: "가을학기",
};

export function semesterLabel(semester: number) {
  return semester === 1 ? SEMESTER_LABELS[1] : SEMESTER_LABELS[2];
}

/** 화면의 학기 선택 칸에 노출할 학기. 지금은 가을학기만 운영하므로 봄학기는 빼 둡니다.
 *
 * 봄학기를 다시 쓰려면 이 배열에 1을 되돌려 놓기만 하면 됩니다 -- 화면 7곳이 전부 이 값을
 * 읽고, 저장 규칙(lib/warnings/term.ts#semesterForMonth)은 애초에 건드리지 않았습니다. */
export const SELECTABLE_SEMESTERS: readonly Semester[] = [2];

/** 학기 선택 칸이 처음 여는 값. 오늘 날짜가 가리키는 학기를 쓰되, 그 학기가 지금 고를 수
 * 없다면 고를 수 있는 것 중 가장 나중 학기로 떨어집니다. 이 보정이 없으면 1~7월에 select의
 * 값이 어느 option과도 맞지 않아, 화면에는 가을학기가 보이는데 조회는 봄학기로 나가는
 * 어긋남이 생깁니다. */
export function defaultSemester(date = new Date()): Semester {
  const current: Semester = date.getMonth() < 7 ? 1 : 2;
  if (SELECTABLE_SEMESTERS.includes(current)) return current;
  return SELECTABLE_SEMESTERS[SELECTABLE_SEMESTERS.length - 1] ?? 2;
}

/** 기록 초기화의 확인 문구. 화면과 서버가 같은 문자열을 기대해야 하므로 한 곳에서 만듭니다. */
export function resetRecordsConfirmPhrase(academicYear: number, semester: number) {
  return `${academicYear}년 ${semesterLabel(semester)} 삭제`;
}
