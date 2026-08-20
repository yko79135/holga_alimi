-- Reworks the discipline category list: splits "거짓말·부정행위" into separate "거짓말" and
-- "부정행위" categories, adds a new "미디어 규정" category, drops "학교 규정·물품 관련 위반", and
-- renames "친구·타인에게 부적절한 행동" to "친구·교사간 폭행". Praise categories are unchanged.
-- No existing warning_entries rows use the categories being removed (checked before writing this
-- migration), so this can be applied as a normal validated constraint swap.
alter table public.warning_entries drop constraint if exists warning_entries_category_check;
alter table public.warning_entries add constraint warning_entries_category_check check (
  category is null or category in (
    '숙제·과제 미이행', '준비물·교재 미지참', '시험 성적 미달·미응시', '지각·시간 미준수',
    '말씀묵상·QT·경건생활 미이행', '교사 지시 불응', '수업·예배 태도 불량·장난',
    '거짓말', '부정행위', '친구·교사간 폭행', '미디어 규정',
    '성적 우수', '과제·활동 성실 수행', '발표 우수', '질문에 훌륭히 답변', '친구를 도와줌',
    '수업 태도 우수', '말씀묵상 성실', '교사 지도에 잘 따름',
    '직접 입력'
  )
);

notify pgrst, 'reload schema';
