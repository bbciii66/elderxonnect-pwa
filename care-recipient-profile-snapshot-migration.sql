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
