-- ElderXonnect care circle: administrator, "who manages this account", and per-section sharing.
-- Safe to run more than once. Run AFTER care-circle-v2-migration.sql.
-- NOT YET APPLIED. Review, then run once in Supabase Dashboard > SQL Editor.

-- 1. A fourth role: admin (can manage who is in the circle and what they see).
do $$
declare c text;
begin
  for c in select conname from pg_constraint
           where conrelid = 'public.caregiver_access'::regclass and contype = 'c'
             and pg_get_constraintdef(oid) like '%role%' loop
    execute format('alter table public.caregiver_access drop constraint %I', c);
  end loop;
end $$;
alter table public.caregiver_access
  add constraint caregiver_access_role_check check (role in ('admin','family','onsite','viewer'));

-- 2. Sections each person may see. Everyone in the circle always has 'circle'.
--    Sections: circle (messages, tasks, visits), checkins, reminders, profile (profile, medical details, address),
--    contacts, portal (health portal button).
do $$
begin
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'caregiver_access' and column_name = 'sections') then
    alter table public.caregiver_access add column sections text[] not null default '{circle}';
    -- One-time: keep what existing people could already see, using role defaults.
    update public.caregiver_access set sections = case role
      when 'family' then array['circle','checkins','reminders','contacts']
      when 'onsite' then array['circle','reminders']
      else array['circle'] end;
  end if;
end $$;
alter table public.caregiver_access drop constraint if exists caregiver_access_sections_check;
alter table public.caregiver_access add constraint caregiver_access_sections_check
  check (sections <@ array['circle','checkins','reminders','profile','contacts','portal'] and 'circle' = any(sections));

-- Admins always see everything.
create or replace function public.circle_admin_sections()
returns trigger language plpgsql as $$
begin
  if new.role = 'admin' then
    new.sections := array['circle','checkins','reminders','profile','contacts','portal'];
  end if;
  return new;
end $$;
drop trigger if exists caregiver_access_admin_sections on public.caregiver_access;
create trigger caregiver_access_admin_sections before insert or update on public.caregiver_access
  for each row execute function public.circle_admin_sections();

-- 3. Who manages this circle: the elder ('self'), or an administrator ('managed').
create table if not exists public.circle_settings (
  elder_id uuid primary key references auth.users(id) on delete cascade,
  mode text not null default 'self' check (mode in ('self','managed')),
  updated_by uuid default auth.uid(),
  updated_at timestamptz not null default now()
);
alter table public.circle_settings enable row level security;

-- 4. Rules, written once and used by every policy.
create or replace function public.circle_is_admin(target_elder uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.caregiver_access ca
                 where ca.elder_id = target_elder and ca.caregiver_id = auth.uid()
                   and ca.status = 'active' and ca.role = 'admin');
$$;
-- Managed mode only takes effect once an administrator has accepted, so the elder is never locked out by a pending invite.
create or replace function public.circle_managed(target_elder uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.circle_settings s where s.elder_id = target_elder and s.mode = 'managed')
     and exists (select 1 from public.caregiver_access ca
                 where ca.elder_id = target_elder and ca.status = 'active' and ca.role = 'admin');
$$;
create or replace function public.circle_can_manage(target_elder uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select case when public.circle_managed(target_elder)
              then public.circle_is_admin(target_elder)
              else auth.uid() = target_elder end;
$$;
create or replace function public.circle_has_section(target_elder uuid, sec text)
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() = target_elder
      or exists (select 1 from public.caregiver_access ca
                 where ca.elder_id = target_elder and ca.caregiver_id = auth.uid() and ca.status = 'active'
                   and (ca.role = 'admin' or sec = any(ca.sections)));
$$;
revoke all on function public.circle_is_admin(uuid), public.circle_managed(uuid),
  public.circle_can_manage(uuid), public.circle_has_section(uuid, text) from public;
grant execute on function public.circle_is_admin(uuid), public.circle_managed(uuid),
  public.circle_can_manage(uuid), public.circle_has_section(uuid, text) to authenticated;

-- 5. Who may change the circle. In managed mode the elder can look but not change.
drop policy if exists "Elders manage caregiver access" on public.caregiver_access;
drop policy if exists "Managers manage caregiver access" on public.caregiver_access;
create policy "Managers manage caregiver access" on public.caregiver_access for all to authenticated
  using (public.circle_can_manage(elder_id)) with check (public.circle_can_manage(elder_id));
drop policy if exists "Elders see their circle" on public.caregiver_access;
create policy "Elders see their circle" on public.caregiver_access for select to authenticated
  using ((select auth.uid()) = elder_id);

drop policy if exists "Circle reads settings" on public.circle_settings;
create policy "Circle reads settings" on public.circle_settings for select to authenticated
  using (public.circle_can_read(elder_id));
drop policy if exists "Managers write settings" on public.circle_settings;
create policy "Managers write settings" on public.circle_settings for insert to authenticated
  with check (public.circle_can_manage(elder_id));
drop policy if exists "Managers update settings" on public.circle_settings;
create policy "Managers update settings" on public.circle_settings for update to authenticated
  using (public.circle_can_manage(elder_id)) with check (public.circle_can_manage(elder_id));
grant select, insert, update on public.circle_settings to authenticated;

-- Managed mode needs an administrator to be invited first.
create or replace function public.circle_settings_guard()
returns trigger language plpgsql as $$
begin
  if new.mode = 'managed' and not exists (select 1 from public.caregiver_access ca
        where ca.elder_id = new.elder_id and ca.role = 'admin' and ca.status in ('pending','active')) then
    raise exception 'Invite an administrator first.';
  end if;
  new.updated_by := auth.uid(); new.updated_at := now();
  return new;
end $$;
drop trigger if exists circle_settings_guard on public.circle_settings;
create trigger circle_settings_guard before insert or update on public.circle_settings
  for each row execute function public.circle_settings_guard();

-- 6. The last administrator of a managed circle cannot leave, be removed, or be demoted.
create or replace function public.circle_last_admin_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.role = 'admin' and old.status = 'active' and (tg_op = 'DELETE' or new.role <> 'admin' or new.status <> 'active') then
    -- One change at a time per circle, so two administrators cannot remove each other simultaneously.
    perform pg_advisory_xact_lock(hashtextextended('circle-admin:' || old.elder_id::text, 0));
  end if;
  if old.role = 'admin' and old.status = 'active'
     and (tg_op = 'DELETE' or new.role <> 'admin' or new.status <> 'active')
     and exists (select 1 from public.circle_settings s where s.elder_id = old.elder_id and s.mode = 'managed')
     and exists (select 1 from auth.users u where u.id = old.elder_id)
     and not exists (select 1 from public.caregiver_access o
                     where o.elder_id = old.elder_id and o.id <> old.id and o.role = 'admin' and o.status = 'active') then
    raise exception 'A managed circle must keep at least one administrator. Add another administrator first.';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
drop trigger if exists caregiver_access_last_admin on public.caregiver_access;
create trigger caregiver_access_last_admin before update or delete on public.caregiver_access
  for each row execute function public.circle_last_admin_guard();

-- 6b. The profile snapshot kept on each access row follows the 'profile' section too.
create or replace function public.circle_snapshot_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.role = 'admin' or 'profile' = any(new.sections) then
    if tg_op = 'INSERT' or new.recipient_profile = '{}'::jsonb
       or (old.role <> 'admin' and not ('profile' = any(old.sections)) and old.recipient_profile = '{}'::jsonb) then
      -- Newly allowed: start from the elder's current profile rather than waiting for their next sync.
      if new.recipient_profile = '{}'::jsonb then
        select coalesce(p.profile_data, '{}'::jsonb) into new.recipient_profile from public.profiles p where p.user_id = new.elder_id;
        new.recipient_profile := coalesce(new.recipient_profile, '{}'::jsonb);
      end if;
    end if;
  else
    new.recipient_profile := '{}'::jsonb;
  end if;
  return new;
end $$;
drop trigger if exists caregiver_access_snapshot on public.caregiver_access;
create trigger caregiver_access_snapshot before insert or update on public.caregiver_access
  for each row execute function public.circle_snapshot_guard();
-- One-time cleanup of snapshots people were never allowed to see.
update public.caregiver_access set recipient_profile = '{}'::jsonb
 where role <> 'admin' and not ('profile' = any(sections)) and recipient_profile <> '{}'::jsonb;

-- 7. Caregivers only read what their sections allow (replaces the old "any active caregiver sees everything").
drop policy if exists "Caregivers read shared profiles" on public.profiles;
drop policy if exists caregiver_read_shared_profiles on public.profiles;
create policy "Caregivers read shared profiles" on public.profiles for select to authenticated
  using (public.circle_has_section(user_id, 'profile'));
drop policy if exists "Caregivers read shared checkins" on public.checkins;
create policy "Caregivers read shared checkins" on public.checkins for select to authenticated
  using (public.circle_has_section(user_id, 'checkins'));
drop policy if exists "Caregivers read shared reminders" on public.reminders;
create policy "Caregivers read shared reminders" on public.reminders for select to authenticated
  using (public.circle_has_section(user_id, 'reminders'));
drop policy if exists "Caregivers read shared contacts" on public.contacts;
create policy "Caregivers read shared contacts" on public.contacts for select to authenticated
  using (public.circle_has_section(user_id, 'contacts'));

-- The older helper that returned every shared profile must respect sections too.
create or replace function public.get_caregiver_shared_profiles()
returns table (elder_id uuid, profile_data jsonb)
language sql stable security definer set search_path = public as $$
  select ca.elder_id,
         case when ca.role = 'admin' or 'profile' = any(ca.sections)
              then coalesce(p.profile_data, '{}'::jsonb) else '{}'::jsonb end
  from public.caregiver_access ca
  left join public.profiles p on p.user_id = ca.elder_id
  where ca.caregiver_id = auth.uid() and ca.status = 'active';
$$;
