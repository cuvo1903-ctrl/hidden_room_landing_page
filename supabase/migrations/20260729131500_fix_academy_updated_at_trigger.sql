create or replace function public.set_academy_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();

  if tg_table_name = 'academy_courses' then
    if new.status = 'published' and (
      tg_op = 'INSERT'
      or old.status is distinct from 'published'
      or new.published_at is null
    ) then
      new.published_at = coalesce(new.published_at, now());
    end if;
  end if;

  return new;
end;
$$;