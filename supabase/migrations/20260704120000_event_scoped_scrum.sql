-- Hidden Room / MysAuth
-- Event-scoped SCRUM access for collaborators and ambassadors.

alter table public.tasks
add column if not exists event_id uuid references public.events(id) on delete cascade;

create index if not exists tasks_event_id_idx
  on public.tasks (event_id);

create or replace function public.has_scrum_event_permission(
  permission_name text,
  check_event_id uuid,
  check_user_id uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    coalesce(public.is_admin(), false)
    or (
      check_user_id is not null
      and check_event_id is not null
      and permission_name in ('scrum.view', 'scrum.edit')
      and exists (
        select 1
        from public.user_permissions up
        where up.user_id = check_user_id::text
          and (
            up.permission_key = permission_name
            or (permission_name = 'scrum.view' and up.permission_key = 'scrum.edit')
          )
      )
      and exists (
        select 1
        from public.event_user_permissions eup
        join public.users u on u.user_id = eup.user_id
        where u.id = check_user_id
          and eup.event_id = check_event_id
          and (
            lower(coalesce(u.roles, '')) ~ '(^|,)[[:space:]]*(pr|collaborator|partner|admin)[[:space:]]*(,|$)'
          )
          and (
            (permission_name = 'scrum.view' and (eup.can_view_scrum = true or eup.can_edit_scrum = true))
            or (permission_name = 'scrum.edit' and eup.can_edit_scrum = true)
          )
      )
    );
$$;

revoke all on function public.has_scrum_event_permission(text, uuid, uuid) from public;
grant execute on function public.has_scrum_event_permission(text, uuid, uuid) to authenticated;

create or replace view public.hr_scrum_events
with (security_invoker = true)
as
select
  e.id,
  e.event_key,
  e.name,
  e.event_date,
  e.status,
  true as can_view_scrum,
  true as can_edit_scrum
from public.events e
where public.is_admin()
union all
select
  e.id,
  e.event_key,
  e.name,
  e.event_date,
  e.status,
  eup.can_view_scrum,
  eup.can_edit_scrum
from public.event_user_permissions eup
join public.events e on e.id = eup.event_id
join public.users u on u.user_id = eup.user_id
where u.id = auth.uid()
  and not public.is_admin()
  and (eup.can_view_scrum = true or eup.can_edit_scrum = true)
  and exists (
    select 1
    from public.user_permissions up
    where up.user_id = auth.uid()::text
      and up.permission_key in ('scrum.view', 'scrum.edit')
  );

grant select on public.hr_scrum_events to authenticated;

alter table public.tasks enable row level security;

drop policy if exists "tasks: leer si tiene scrum.view o scrum.edit" on public.tasks;
create policy "tasks: leer por evento scrum"
on public.tasks
for select
to authenticated
using (
  public.has_scrum_event_permission('scrum.view', tasks.event_id)
);

drop policy if exists "tasks: crear si tiene scrum.edit" on public.tasks;
create policy "tasks: crear por evento scrum"
on public.tasks
for insert
to authenticated
with check (
  public.has_scrum_event_permission('scrum.edit', tasks.event_id)
);

drop policy if exists "tasks: editar si tiene scrum.edit" on public.tasks;
create policy "tasks: editar por evento scrum"
on public.tasks
for update
to authenticated
using (
  public.has_scrum_event_permission('scrum.edit', tasks.event_id)
)
with check (
  public.has_scrum_event_permission('scrum.edit', tasks.event_id)
);

drop policy if exists "tasks: eliminar solo admin" on public.tasks;
create policy "tasks: eliminar por evento scrum"
on public.tasks
for delete
to authenticated
using (
  public.has_scrum_event_permission('scrum.edit', tasks.event_id)
);

comment on function public.has_scrum_event_permission(text, uuid, uuid) is
  'Checks global scrum.view/scrum.edit plus event_user_permissions can_view_scrum/can_edit_scrum for event-scoped task access.';

comment on view public.hr_scrum_events is
  'Events visible in the SCRUM selector for admins or users with global SCRUM permission and event-scoped SCRUM access.';
