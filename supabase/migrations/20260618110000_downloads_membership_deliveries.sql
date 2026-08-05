alter table public.downloads
  add column if not exists release_mode text not null default 'immediate',
  add column if not exists membership_id uuid references public.memberships(id) on delete set null,
  add column if not exists membership_delivery_id uuid references public.membership_material_deliveries(id) on delete set null,
  add column if not exists membership_cycle_number integer;

alter table public.downloads
  drop constraint if exists downloads_release_mode_check;

alter table public.downloads
  add constraint downloads_release_mode_check
  check (release_mode in ('immediate', 'membership_delivery'));

alter table public.downloads
  drop constraint if exists downloads_membership_cycle_number_check;

alter table public.downloads
  add constraint downloads_membership_cycle_number_check
  check (membership_cycle_number is null or membership_cycle_number > 0);

create index if not exists downloads_membership_id_idx
  on public.downloads (membership_id);

create index if not exists downloads_membership_delivery_id_idx
  on public.downloads (membership_delivery_id);

create index if not exists downloads_membership_release_idx
  on public.downloads (user_id, membership_id, membership_cycle_number);

create or replace function public.link_downloads_to_membership_delivery()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.downloads d
  set membership_delivery_id = new.id
  where d.release_mode = 'membership_delivery'
    and d.user_id = new.user_id
    and d.membership_cycle_number = new.cycle_number
    and (
      d.membership_id = new.membership_id
      or (d.membership_id is null and new.membership_id is null)
    );

  return new;
end;
$$;

drop trigger if exists membership_delivery_link_downloads on public.membership_material_deliveries;

create trigger membership_delivery_link_downloads
after insert or update of membership_id, user_id, cycle_number, delivered_at
on public.membership_material_deliveries
for each row
execute function public.link_downloads_to_membership_delivery();

update public.downloads d
set membership_delivery_id = md.id
from public.membership_material_deliveries md
where d.release_mode = 'membership_delivery'
  and d.membership_delivery_id is null
  and d.user_id = md.user_id
  and d.membership_cycle_number = md.cycle_number
  and (
    d.membership_id = md.membership_id
    or (d.membership_id is null and md.membership_id is null)
  );

drop policy if exists "Users can view their own downloads" on public.downloads;

create policy "Users can view released own downloads"
  on public.downloads
  for select
  to authenticated
  using (
    user_id = (
      select u.user_id
      from public.users u
      where u.id = auth.uid()
    )
    and (
      release_mode = 'immediate'
      or (
        release_mode = 'membership_delivery'
        and exists (
          select 1
          from public.membership_material_deliveries md
          where md.user_id = downloads.user_id
            and md.cycle_number = downloads.membership_cycle_number
            and md.delivered_at is not null
            and (
              md.id = downloads.membership_delivery_id
              or md.membership_id = downloads.membership_id
              or (md.membership_id is null and downloads.membership_id is null)
            )
        )
      )
    )
  );
