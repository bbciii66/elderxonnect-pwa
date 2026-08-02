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
