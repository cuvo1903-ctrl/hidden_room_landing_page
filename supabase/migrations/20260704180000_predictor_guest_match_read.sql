drop policy if exists "predictor matches read authenticated" on public.predictor_matches;
drop policy if exists "predictor matches read public" on public.predictor_matches;

create policy "predictor matches read public"
on public.predictor_matches
for select
to anon, authenticated
using (true);

grant select on public.predictor_matches to anon;
