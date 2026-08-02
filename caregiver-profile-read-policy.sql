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
