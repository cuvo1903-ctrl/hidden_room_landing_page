create or replace function public.predictor_prediction_exists(
  p_match_id uuid,
  p_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.predictor_predictions p
    where p.match_id = p_match_id
      and p.user_id = p_user_id
  );
$$;

grant execute on function public.predictor_prediction_exists(uuid, uuid) to authenticated;

drop policy if exists "predictor predictions own open insert" on public.predictor_predictions;
create policy "predictor predictions own open insert"
on public.predictor_predictions
for insert
to authenticated
with check (
  user_id = auth.uid()
  and public.predictor_match_is_open(match_id)
  and not public.predictor_prediction_exists(match_id, auth.uid())
);
