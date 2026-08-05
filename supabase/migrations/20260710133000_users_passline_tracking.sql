-- Hidden Room / MysAuth
-- Passline buyer-name aliases used to link imported tickets to operational users.

alter table public.users
  add column if not exists passline_tracking text[] not null default '{}'::text[];

comment on column public.users.passline_tracking is
  'Operational Passline buyer-name aliases. Used to match repeated/variant Passline names to a real Hidden Room user.';
