-- Adds a "직접 입력" (custom) option to the 훈계/칭찬 점수 grant category dropdown, mirroring the
-- notices custom_type_label pattern: category stores the sentinel, custom_category_label holds
-- the teacher's actual free-text reason.
alter table public.warning_entries add column if not exists custom_category_label text;

alter table public.warning_entries drop constraint if exists warning_entries_category_check;
alter table public.warning_entries add constraint warning_entries_category_check check (
  category is null or category in (
    '숙제·과제 미이행', '준비물·교재 미지참', '시험 성적 미달·미응시', '지각·시간 미준수',
    '말씀묵상·QT·경건생활 미이행', '교사 지시 불응', '수업·예배 태도 불량·장난', '거짓말·부정행위',
    '친구·타인에게 부적절한 행동', '학교 규정·물품 관련 위반',
    '성적 우수', '과제·활동 성실 수행', '발표 우수', '질문에 훌륭히 답변', '친구를 도와줌',
    '수업 태도 우수', '말씀묵상 성실', '교사 지도에 잘 따름',
    '직접 입력'
  )
);

alter table public.warning_entries drop constraint if exists warning_entries_custom_category_label_required;
alter table public.warning_entries add constraint warning_entries_custom_category_label_required check (
  (category = '직접 입력' and custom_category_label is not null and length(trim(custom_category_label)) > 0)
  or category is distinct from '직접 입력'
);

notify pgrst, 'reload schema';
