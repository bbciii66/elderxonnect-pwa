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
