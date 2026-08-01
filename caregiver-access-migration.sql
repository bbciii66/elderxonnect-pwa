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
