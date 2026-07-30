create or replace function public.create_academy_module(
  p_course_id uuid,
  p_title text,
  p_summary text default null,
  p_position integer default 1,
  p_cycle text default null
)
returns public.academy_course_modules
language plpgsql
security definer
set search_path = public
as $$
declare
  created_module public.academy_course_modules;
begin
  if not public.has_academia_admin_permission() then
    raise exception 'No tienes permisos para crear modulos de Academia.' using errcode = '42501';
  end if;

  if p_course_id is null then
    raise exception 'Selecciona un curso antes de crear el modulo.' using errcode = '22023';
  end if;

  if nullif(trim(p_title), '') is null then
    raise exception 'Escribe el titulo del modulo.' using errcode = '22023';
  end if;

  if not exists (select 1 from public.academy_courses where id = p_course_id) then
    raise exception 'El curso seleccionado no existe.' using errcode = '22023';
  end if;

  insert into public.academy_course_modules (course_id, title, summary, position, cycle)
  values (p_course_id, trim(p_title), nullif(trim(coalesce(p_summary, '')), ''), greatest(coalesce(p_position, 1), 1), nullif(trim(coalesce(p_cycle, '')), ''))
  returning * into created_module;

  return created_module;
end;
$$;

revoke all on function public.create_academy_module(uuid, text, text, integer, text) from public;
grant execute on function public.create_academy_module(uuid, text, text, integer, text) to authenticated;