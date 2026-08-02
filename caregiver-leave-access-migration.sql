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
