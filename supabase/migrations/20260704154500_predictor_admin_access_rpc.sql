create or replace function public.predictor_can_manage_matches()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.is_admin(), false);
$$;

grant execute on function public.predictor_can_manage_matches() to authenticated;
