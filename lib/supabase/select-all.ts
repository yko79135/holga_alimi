/** Supabase(PostgREST)는 한 번의 select에 최대 1000행만 돌려주고, 넘치는 행은 오류 없이 잘라
 * 버립니다. 학기 전체처럼 1000행을 넘을 수 있는 조회는 이 함수로 끝까지 나눠 읽습니다.
 *
 * `page(from, to)`는 매번 새 쿼리를 만들어 `.order(...)`(겹치지 않는 열, 예: id)와
 * `.range(from, to)`를 붙여 돌려줘야 합니다. 순서가 고정되지 않으면 페이지 사이에서 행이
 * 빠지거나 겹칠 수 있습니다. */
const PAGE_SIZE = 1000;

export async function selectAll<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { code?: string; message: string } | null }>,
): Promise<{ data: T[]; error: { code?: string; message: string } | null }> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await page(from, from + PAGE_SIZE - 1);
    if (error) return { data: rows, error };
    rows.push(...(data || []));
    if (!data || data.length < PAGE_SIZE) return { data: rows, error: null };
  }
}
