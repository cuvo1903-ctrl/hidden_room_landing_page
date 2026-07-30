alter table public.academy_course_modules
  add column if not exists cycle text;

create index if not exists academy_modules_course_cycle_position_idx
  on public.academy_course_modules(course_id, cycle, position);

comment on column public.academy_course_modules.cycle is 'Optional Academia cycle label used to group course modules.';
