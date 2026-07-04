create or replace function public.predictor_can_manage_matches()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.users u
    where (
        u.id = auth.uid()
        or u.user_id = auth.uid()::text
        or lower(coalesce(u.email, '')) = lower(coalesce(auth.email(), ''))
      )
      and lower(coalesce(u.roles, '')) ~ '(^|,)[[:space:]]*admin[[:space:]]*(,|$)'
  );
$$;

grant execute on function public.predictor_can_manage_matches() to authenticated;
