drop policy if exists "predictor predictions own open update" on public.predictor_predictions;

drop policy if exists "predictor predictions own open insert" on public.predictor_predictions;
create policy "predictor predictions own open insert"
on public.predictor_predictions
for insert
to authenticated
with check (
  user_id = auth.uid()
  and public.predictor_match_is_open(match_id)
  and not exists (
    select 1
    from public.predictor_predictions existing
    where existing.match_id = predictor_predictions.match_id
      and existing.user_id = auth.uid()
  )
);
