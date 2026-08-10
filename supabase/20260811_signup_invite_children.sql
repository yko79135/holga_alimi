-- Atomic multi-child redemption: resolves each child's student (existing match or new row),
-- links the parent, and logs each redemption, all in one transaction. If any child fails
-- re-validation (stale/tampered selection, or a match appeared since the client's pre-check),
-- the whole batch rolls back -- a signup never leaves some children linked and others not.
-- Called only by the service-role client from app/api/signup/invite (never by a parent's own
-- authenticated session, since it performs privileged linking without per-child RLS checks).

create or replace function public.redeem_signup_invite_children(
  p_invite_id uuid,
  p_parent_id uuid,
  p_children jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  child jsonb;
  v_name text;
  v_grade text;
  v_norm_name text;
  v_norm_grade text;
  v_selected uuid;
  v_student_id uuid;
  v_was_new boolean;
  v_match_count int;
  results jsonb := '[]'::jsonb;
begin
  for child in select * from jsonb_array_elements(p_children)
  loop
    v_name := trim(both from (child->>'name'));
    v_grade := trim(both from (child->>'grade'));
    v_selected := nullif(child->>'selectedStudentId', '')::uuid;

    if v_name = '' or v_grade = '' then
      raise exception 'INVALID_CHILD_INFO: %', coalesce(v_name, '');
    end if;

    v_norm_name := lower(regexp_replace(v_name, '\s+', ' ', 'g'));
    v_norm_grade := lower(regexp_replace(v_grade, '\s+', ' ', 'g'));

    select count(*) into v_match_count
    from public.students s
    where s.active
      and lower(regexp_replace(s.name, '\s+', ' ', 'g')) = v_norm_name
      and lower(regexp_replace(s.grade, '\s+', ' ', 'g')) = v_norm_grade;

    if v_selected is not null then
      select s.id into v_student_id
      from public.students s
      where s.id = v_selected
        and s.active
        and lower(regexp_replace(s.name, '\s+', ' ', 'g')) = v_norm_name
        and lower(regexp_replace(s.grade, '\s+', ' ', 'g')) = v_norm_grade;
      if v_student_id is null then
        raise exception 'STUDENT_MATCH_STALE: %', v_name;
      end if;
      v_was_new := false;
    elsif v_match_count > 0 then
      raise exception 'STUDENT_MATCH_FOUND: %', v_name;
    else
      insert into public.students (name, grade) values (v_name, v_grade) returning id into v_student_id;
      v_was_new := true;
    end if;

    insert into public.parent_students (parent_id, student_id) values (p_parent_id, v_student_id)
    on conflict do nothing;

    insert into public.signup_invite_redemptions (invite_id, parent_id, student_id) values (p_invite_id, p_parent_id, v_student_id);

    results := results || jsonb_build_object('studentId', v_student_id, 'name', v_name, 'grade', v_grade, 'wasNew', v_was_new);
  end loop;

  return results;
end;
$$;

revoke all on function public.redeem_signup_invite_children(uuid, uuid, jsonb) from public;
grant execute on function public.redeem_signup_invite_children(uuid, uuid, jsonb) to service_role;

notify pgrst, 'reload schema';
