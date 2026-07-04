drop policy if exists "predictor predictions admin read" on public.predictor_predictions;
create policy "predictor predictions admin read"
on public.predictor_predictions
for select
to authenticated
using (public.predictor_can_manage_matches());
