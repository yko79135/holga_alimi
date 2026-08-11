-- Seeds the real class/subject list so admins don't have to type all of these in by hand.
insert into public.class_periods (name) values
  ('수학'), ('W&G'), ('Reading'), ('Literature'), ('국어'), ('과학'), ('과학실험'),
  ('사회/Social Studies'), ('역사'), ('Heritage'), ('Bible/성경'), ('성경읽기'), ('성경강의'), ('성경정리'),
  ('JEBS'), ('Speaking'), ('Phonics'), ('컴퓨터'), ('Coding'), ('음악'), ('미술'), ('연기'), ('체육'),
  ('태권도'), ('Handwriting'), ('주판'), ('Brainnow'), ('C.A.'), ('Debate'), ('독서'), ('Self Study'),
  ('예배'), ('현장학습'), ('발표'), ('Homeroom')
on conflict (name) do nothing;
