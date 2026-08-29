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

/** 기록 초기화의 확인 문구. 화면과 서버가 같은 문자열을 기대해야 하므로 한 곳에서 만듭니다. */
export function resetRecordsConfirmPhrase(academicYear: number, semester: number) {
  return `${academicYear}년 ${semesterLabel(semester)} 삭제`;
}
