-- ElderXonnect FULL SETUP for a brand-new Supabase project (e.g. elderxonnect-v2).
-- All files below in dependency order; every statement is safe to re-run. Run once in SQL Editor.

-- ========== supabase-schema.sql ==========
-- ElderXonnect Supabase schema
-- Run this entire file in Supabase Dashboard > SQL Editor.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  profile_data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.checkins (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  client_id text not null,
  occurred_at timestamptz not null,
  mood text not null,
  pain smallint not null default 0 check (pain between 0 and 10),
  notes text not null default '',
  updated_at timestamptz not null default now(),
  unique (user_id, client_id)
);

create table if not exists public.reminders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  client_id text not null,
  title text not null,
  reminder_time time,
  category text not null default '⭐',
  urgent boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, client_id)
);

create table if not exists public.contacts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  client_id text not null,
  name text not null,
  phone text not null,
  relationship text not null default 'Other',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, client_id)
);

create index if not exists checkins_user_id_idx on public.checkins(user_id);
create index if not exists checkins_occurred_at_idx on public.checkins(occurred_at desc);
create index if not exists reminders_user_id_idx on public.reminders(user_id);
create index if not exists contacts_user_id_idx on public.contacts(user_id);

alter table public.profiles enable row level security;
alter table public.checkins enable row level security;
alter table public.reminders enable row level security;
alter table public.contacts enable row level security;

drop policy if exists "Users manage own profile" on public.profiles;
create policy "Users manage own profile"
on public.profiles for all to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "Users manage own checkins" on public.checkins;
create policy "Users manage own checkins"
on public.checkins for all to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "Users manage own reminders" on public.reminders;
create policy "Users manage own reminders"
on public.reminders for all to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "Users manage own contacts" on public.contacts;
create policy "Users manage own contacts"
on public.contacts for all to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

grant select, insert, update, delete on public.profiles to authenticated;
grant select, insert, update, delete on public.checkins to authenticated;
grant select, insert, update, delete on public.reminders to authenticated;
grant select, insert, update, delete on public.contacts to authenticated;

-- Keep updated_at accurate.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at before update on public.profiles
for each row execute function public.set_updated_at();

drop trigger if exists checkins_set_updated_at on public.checkins;
create trigger checkins_set_updated_at before update on public.checkins
for each row execute function public.set_updated_at();

drop trigger if exists reminders_set_updated_at on public.reminders;
create trigger reminders_set_updated_at before update on public.reminders
for each row execute function public.set_updated_at();

drop trigger if exists contacts_set_updated_at on public.contacts;
create trigger contacts_set_updated_at before update on public.contacts
for each row execute function public.set_updated_at();

-- ========== caregiver-access-migration.sql ==========
-- ElderXonnect caregiver access migration
-- Run this entire file once in Supabase Dashboard > SQL Editor.

create extension if not exists pgcrypto;

create table if not exists public.caregiver_access (
  id uuid primary key default gen_random_uuid(),
  elder_id uuid not null references auth.users(id) on delete cascade,
  caregiver_id uuid references auth.users(id) on delete cascade,
  caregiver_email text not null,
  status text not null default 'pending' check (status in ('pending','active','revoked')),
  invited_at timestamptz not null default now(),
  accepted_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (elder_id, caregiver_email)
);

create index if not exists caregiver_access_elder_idx on public.caregiver_access(elder_id);
create index if not exists caregiver_access_caregiver_idx on public.caregiver_access(caregiver_id);
create index if not exists caregiver_access_email_idx on public.caregiver_access(lower(caregiver_email));

alter table public.caregiver_access enable row level security;

drop policy if exists "Elders manage caregiver access" on public.caregiver_access;
create policy "Elders manage caregiver access"
on public.caregiver_access for all to authenticated
using ((select auth.uid()) = elder_id)
with check ((select auth.uid()) = elder_id);

drop policy if exists "Caregivers view their invitations" on public.caregiver_access;
create policy "Caregivers view their invitations"
on public.caregiver_access for select to authenticated
using (
  caregiver_id = (select auth.uid())
  or lower(caregiver_email) = lower(coalesce((select auth.jwt()->>'email'), ''))
);

grant select, insert, update, delete on public.caregiver_access to authenticated;

create or replace function public.accept_caregiver_invitation(invitation_id uuid)
returns public.caregiver_access
language plpgsql
security definer
set search_path = public
as $$
declare
  accepted public.caregiver_access;
  signed_in_email text;
begin
  signed_in_email := lower(coalesce(auth.jwt()->>'email', ''));
  if auth.uid() is null or signed_in_email = '' then
    raise exception 'You must be signed in with a verified email address.';
  end if;

  update public.caregiver_access
     set caregiver_id = auth.uid(),
         status = 'active',
         accepted_at = coalesce(accepted_at, now()),
         updated_at = now()
   where id = invitation_id
     and lower(caregiver_email) = signed_in_email
     and status in ('pending','active')
  returning * into accepted;

  if accepted.id is null then
    raise exception 'No matching pending invitation was found for this email address.';
  end if;

  return accepted;
end;
$$;

grant execute on function public.accept_caregiver_invitation(uuid) to authenticated;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists caregiver_access_set_updated_at on public.caregiver_access;
create trigger caregiver_access_set_updated_at
before update on public.caregiver_access
for each row execute function public.set_updated_at();

-- A linked caregiver may read, but never change, the elder's cloud data.
drop policy if exists "Caregivers read shared profiles" on public.profiles;
create policy "Caregivers read shared profiles"
on public.profiles for select to authenticated
using (
  exists (
    select 1 from public.caregiver_access ca
    where ca.elder_id = profiles.user_id
      and ca.caregiver_id = (select auth.uid())
      and ca.status = 'active'
  )
);

drop policy if exists "Caregivers read shared checkins" on public.checkins;
create policy "Caregivers read shared checkins"
on public.checkins for select to authenticated
using (
  exists (
    select 1 from public.caregiver_access ca
    where ca.elder_id = checkins.user_id
      and ca.caregiver_id = (select auth.uid())
      and ca.status = 'active'
  )
);

drop policy if exists "Caregivers read shared reminders" on public.reminders;
create policy "Caregivers read shared reminders"
on public.reminders for select to authenticated
using (
  exists (
    select 1 from public.caregiver_access ca
    where ca.elder_id = reminders.user_id
      and ca.caregiver_id = (select auth.uid())
      and ca.status = 'active'
  )
);

drop policy if exists "Caregivers read shared contacts" on public.contacts;
create policy "Caregivers read shared contacts"
on public.contacts for select to authenticated
using (
  exists (
    select 1 from public.caregiver_access ca
    where ca.elder_id = contacts.user_id
      and ca.caregiver_id = (select auth.uid())
      and ca.status = 'active'
  )
);

-- ========== reminder-schedule-migration.sql ==========
-- ElderXonnect reminder scheduling migration
-- Run once in Supabase Dashboard > SQL Editor.

alter table public.reminders
  add column if not exists schedule_type text not null default 'daily'
    check (schedule_type in ('daily','once','weekly')),
  add column if not exists schedule_date date,
  add column if not exists schedule_days smallint[] not null default '{}'::smallint[],
  add column if not exists schedule_time time;

-- Preserve existing reminders as daily reminders.
update public.reminders
set schedule_time = coalesce(schedule_time, reminder_time),
    schedule_type = coalesce(nullif(schedule_type,''), 'daily')
where schedule_time is null or schedule_type is null or schedule_type = '';

alter table public.reminders
  drop constraint if exists reminders_schedule_days_valid;

alter table public.reminders
  add constraint reminders_schedule_days_valid
  check (
    schedule_days <@ array[0,1,2,3,4,5,6]::smallint[]
  );

-- ========== caregiver-leave-access-migration.sql ==========
-- Allow a caregiver to remove only their own read-only access record.
-- Run once in Supabase Dashboard > SQL Editor.

create or replace function public.leave_caregiver_access(access_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  removed_count integer;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in.';
  end if;

  delete from public.caregiver_access
   where id = access_id
     and caregiver_id = auth.uid()
     and status = 'active';

  get diagnostics removed_count = row_count;

  if removed_count = 0 then
    raise exception 'That caregiver access record was not found or does not belong to this account.';
  end if;

  return true;
end;
$$;

grant execute on function public.leave_caregiver_access(uuid) to authenticated;

-- ========== care-recipient-display-name-migration.sql ==========
-- Store a care recipient display name directly on each caregiver access record.
-- This avoids cross-table profile lookup failures in the caregiver portal.

alter table public.caregiver_access
add column if not exists recipient_display_name text;

-- Backfill existing caregiver links from the recipient's saved cloud profile.
update public.caregiver_access ca
set recipient_display_name = nullif(trim(p.profile_data->>'name'), ''),
    updated_at = now()
from public.profiles p
where p.user_id = ca.elder_id
  and nullif(trim(coalesce(ca.recipient_display_name, '')), '') is null
  and nullif(trim(p.profile_data->>'name'), '') is not null;

create or replace function public.set_care_recipient_display_name(p_display_name text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  clean_name text;
  changed_count integer;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in.';
  end if;

  clean_name := left(trim(coalesce(p_display_name, '')), 120);
  if clean_name = '' then
    raise exception 'A display name is required.';
  end if;

  update public.caregiver_access
     set recipient_display_name = clean_name,
         updated_at = now()
   where elder_id = auth.uid()
     and recipient_display_name is distinct from clean_name;

  get diagnostics changed_count = row_count;
  return changed_count;
end;
$$;

revoke all on function public.set_care_recipient_display_name(text) from public;
grant execute on function public.set_care_recipient_display_name(text) to authenticated;

-- ========== care-recipient-profile-snapshot-migration.sql ==========
-- Store a complete care-recipient profile snapshot on each caregiver access record.
-- The recipient can update only records where they are the elder_id.

alter table public.caregiver_access
add column if not exists recipient_display_name text;

alter table public.caregiver_access
add column if not exists recipient_profile jsonb not null default '{}'::jsonb;

-- Backfill existing caregiver links from the recipient's current cloud profile.
update public.caregiver_access ca
set recipient_profile = coalesce(p.profile_data, '{}'::jsonb),
    recipient_display_name = coalesce(
      nullif(trim(p.profile_data->>'name'), ''),
      ca.recipient_display_name
    ),
    updated_at = now()
from public.profiles p
where p.user_id = ca.elder_id
  and p.profile_data is not null;

create or replace function public.set_care_recipient_profile(p_profile jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  clean_profile jsonb;
  clean_name text;
  changed_count integer;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in.';
  end if;

  clean_profile := coalesce(p_profile, '{}'::jsonb);
  if jsonb_typeof(clean_profile) <> 'object' then
    raise exception 'The shared profile must be a JSON object.';
  end if;

  clean_name := left(trim(coalesce(clean_profile->>'name', '')), 120);

  update public.caregiver_access
     set recipient_profile = clean_profile,
         recipient_display_name = case
           when clean_name <> '' then clean_name
           else recipient_display_name
         end,
         updated_at = now()
   where elder_id = auth.uid()
     and (
       recipient_profile is distinct from clean_profile
       or (clean_name <> '' and recipient_display_name is distinct from clean_name)
     );

  get diagnostics changed_count = row_count;
  return changed_count;
end;
$$;

revoke all on function public.set_care_recipient_profile(jsonb) from public;
grant execute on function public.set_care_recipient_profile(jsonb) to authenticated;

-- ========== caregiver-shared-profile-rpc.sql ==========
-- Return shared profile data only for care recipients who have granted
-- active access to the currently signed-in caregiver.

create or replace function public.get_caregiver_shared_profiles()
returns table (
  elder_id uuid,
  profile_data jsonb
)
language sql
stable
security definer
set search_path = public
as $$
  select
    ca.elder_id,
    coalesce(p.profile_data, '{}'::jsonb) as profile_data
  from public.caregiver_access ca
  left join public.profiles p
    on p.user_id = ca.elder_id
  where ca.caregiver_id = auth.uid()
    and ca.status = 'active';
$$;

revoke all on function public.get_caregiver_shared_profiles() from public;
grant execute on function public.get_caregiver_shared_profiles() to authenticated;

-- ========== caregiver-profile-read-policy.sql ==========
-- Permit an authenticated caregiver to read a care recipient profile
-- only when that caregiver has an active caregiver_access record.

alter table public.profiles enable row level security;

drop policy if exists caregiver_read_shared_profiles on public.profiles;

create policy caregiver_read_shared_profiles
on public.profiles
for select
to authenticated
using (
  auth.uid() = user_id
  or exists (
    select 1
    from public.caregiver_access ca
    where ca.elder_id = profiles.user_id
      and ca.caregiver_id = auth.uid()
      and ca.status = 'active'
  )
);

-- ========== care-circle-migration.sql ==========
-- ElderXonnect care circle: shared messages and tasks for an elder and their caregivers.
-- NOT YET APPLIED. Review, then run once in Supabase Dashboard > SQL Editor (from the Mac).

-- Caregiver roles: family (can write), onsite (can write), viewer (read only).
alter table public.caregiver_access
  add column if not exists role text not null default 'family'
  check (role in ('family','onsite','viewer'));

-- Who is in this elder's circle? Elder, or an active caregiver. Writers exclude viewers.
create or replace function public.circle_can_read(target_elder uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() = target_elder
      or exists (select 1 from public.caregiver_access ca
                 where ca.elder_id = target_elder and ca.caregiver_id = auth.uid() and ca.status = 'active');
$$;
create or replace function public.circle_can_write(target_elder uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() = target_elder
      or exists (select 1 from public.caregiver_access ca
                 where ca.elder_id = target_elder and ca.caregiver_id = auth.uid()
                   and ca.status = 'active' and ca.role <> 'viewer');
$$;
revoke all on function public.circle_can_read(uuid), public.circle_can_write(uuid) from public;
grant execute on function public.circle_can_read(uuid), public.circle_can_write(uuid) to authenticated;

create table if not exists public.circle_messages (
  id uuid primary key default gen_random_uuid(),
  elder_id uuid not null references auth.users(id) on delete cascade,
  sender_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  sender_name text not null default '',
  body text not null check (char_length(body) between 1 and 1000),
  created_at timestamptz not null default now()
);
create index if not exists circle_messages_elder_idx on public.circle_messages(elder_id, created_at desc);

create table if not exists public.circle_tasks (
  id uuid primary key default gen_random_uuid(),
  elder_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 200),
  created_by uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_by_name text not null default '',
  done boolean not null default false,
  done_by_name text not null default '',
  done_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists circle_tasks_elder_idx on public.circle_tasks(elder_id, created_at desc);

alter table public.circle_messages enable row level security;
alter table public.circle_tasks enable row level security;

drop policy if exists "Circle reads messages" on public.circle_messages;
create policy "Circle reads messages" on public.circle_messages for select to authenticated
using (public.circle_can_read(elder_id));
drop policy if exists "Circle writes messages" on public.circle_messages;
create policy "Circle writes messages" on public.circle_messages for insert to authenticated
with check (public.circle_can_write(elder_id) and sender_id = (select auth.uid()));

drop policy if exists "Circle reads tasks" on public.circle_tasks;
create policy "Circle reads tasks" on public.circle_tasks for select to authenticated
using (public.circle_can_read(elder_id));
drop policy if exists "Circle writes tasks" on public.circle_tasks;
create policy "Circle writes tasks" on public.circle_tasks for insert to authenticated
with check (public.circle_can_write(elder_id) and created_by = (select auth.uid()));
drop policy if exists "Circle updates tasks" on public.circle_tasks;
create policy "Circle updates tasks" on public.circle_tasks for update to authenticated
using (public.circle_can_write(elder_id)) with check (public.circle_can_write(elder_id));

grant select, insert on public.circle_messages to authenticated;
grant select, insert, update on public.circle_tasks to authenticated;

-- Let the elder choose each caregiver's role (elder policy on caregiver_access already allows updates).
