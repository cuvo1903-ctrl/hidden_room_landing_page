create or replace function public.create_academy_module(payload jsonb)
returns public.academy_course_modules
language plpgsql
security definer
set search_path = public
as $$
declare
  course_id_value uuid;
  title_value text;
  summary_value text;
  cycle_value text;
  position_value integer;
  created_module public.academy_course_modules;
begin
  if not public.has_academia_admin_permission() then
    raise exception 'No tienes permisos para crear modulos de Academia.' using errcode = '42501';
  end if;

  begin
    course_id_value := nullif(payload->>'course_id', '')::uuid;
  exception when invalid_text_representation then
    raise exception 'El curso seleccionado no es valido.' using errcode = '22023';
  end;

  title_value := nullif(trim(coalesce(payload->>'title', '')), '');
  summary_value := nullif(trim(coalesce(payload->>'summary', '')), '');
  cycle_value := nullif(trim(coalesce(payload->>'cycle', '')), '');
  position_value := greatest(coalesce(nullif(payload->>'position', '')::integer, 1), 1);

  if course_id_value is null then
    raise exception 'Selecciona un curso antes de crear el modulo.' using errcode = '22023';
  end if;

  if title_value is null then
    raise exception 'Escribe el titulo del modulo.' using errcode = '22023';
  end if;

  if not exists (select 1 from public.academy_courses where id = course_id_value) then
    raise exception 'El curso seleccionado no existe.' using errcode = '22023';
  end if;

  insert into public.academy_course_modules (course_id, title, summary, position, cycle)
  values (course_id_value, title_value, summary_value, position_value, cycle_value)
  returning * into created_module;

  return created_module;
end;
$$;

revoke all on function public.create_academy_module(jsonb) from public;
grant execute on function public.create_academy_module(jsonb) to authenticated;