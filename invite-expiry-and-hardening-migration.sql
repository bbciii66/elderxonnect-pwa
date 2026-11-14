-- ElderXonnect follow-ups: invitations expire after 14 days, a few small database tightenings.
-- Safe to run more than once. Run it LAST (after caregiver-snapshot-active-only-migration.sql, before or after push-alerts-migration.sql).
-- Needs the helper functions from care-circle-admin-migration.sql and the privacy file.

-- 1. Invitations expire 14 days after they were sent (invited_at). Only PENDING rows can expire: people who
--    already joined keep their access. An elder or administrator can send a fresh invitation (renew_caregiver_invitation).
create or replace function public.caregiver_invite_is_current(sent_at timestamptz)
returns boolean language sql stable as $$
  select sent_at > now() - interval '14 days';
$$;
revoke all on function public.caregiver_invite_is_current(timestamptz) from public, anon;
grant execute on function public.caregiver_invite_is_current(timestamptz) to authenticated;

-- An expired invitation can no longer be seen by the invited person (same as if it did not exist).
drop policy if exists "Caregivers view their invitations" on public.caregiver_access;
create policy "Caregivers view their invitations"
on public.caregiver_access for select to authenticated
using (
  caregiver_id = (select auth.uid())
  or (status = 'pending' and public.caregiver_invite_is_current(invited_at)
      and lower(caregiver_email) = lower(coalesce((select auth.jwt()->>'email'), ''))
      and public.caregiver_email_confirmed(caregiver_email))
);

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
     and (
       (status = 'pending' and public.caregiver_invite_is_current(invited_at)
        and lower(caregiver_email) = signed_in_email
        and public.caregiver_email_confirmed(caregiver_email))
       or (status = 'active' and caregiver_id = auth.uid())
     )
  returning * into accepted;

  if accepted.id is null then
    if exists (select 1 from public.caregiver_access
               where id = invitation_id and status = 'pending'
                 and not public.caregiver_invite_is_current(invited_at)
                 and lower(caregiver_email) = signed_in_email
                 and public.caregiver_email_confirmed(caregiver_email)) then
      raise exception 'This invitation has expired. Ask for a new one.';
    end if;
    raise exception 'No matching pending invitation was found for this email address.';
  end if;

  return accepted;
end;
$$;
revoke all on function public.accept_caregiver_invitation(uuid) from public, anon;
grant execute on function public.accept_caregiver_invitation(uuid) to authenticated;

-- Sending a fresh invitation: restarts the 14 days on a PENDING row. Only whoever may manage the circle can do it.
create or replace function public.renew_caregiver_invitation(access_id uuid)
returns public.caregiver_access
language plpgsql
security definer
set search_path = public
as $$
declare
  renewed public.caregiver_access;
  target uuid;
begin
  select elder_id into target from public.caregiver_access where id = access_id and status = 'pending';
  if target is null or not public.circle_can_manage(target) then
    raise exception 'No pending invitation to renew.';
  end if;
  update public.caregiver_access set invited_at = now(), updated_at = now()
   where id = access_id and status = 'pending'
  returning * into renewed;
  return renewed;
end;
$$;
revoke all on function public.renew_caregiver_invitation(uuid) from public, anon;
grant execute on function public.renew_caregiver_invitation(uuid) to authenticated;

-- 2. Strangers must not be able to ask "does this person have a managed circle?". The helper is only for the
--    database's own functions (circle_can_manage runs it as its owner, so nothing that works today breaks).
revoke execute on function public.circle_managed(uuid) from public, anon, authenticated;

-- 3. A task can only be ticked or unticked; the stamped author name cannot be rewritten either.
create or replace function public.circle_tasks_guard()
returns trigger language plpgsql as $$
begin
  if new.id <> old.id or new.elder_id <> old.elder_id or new.title <> old.title
     or new.created_by <> old.created_by or new.created_at <> old.created_at
     or new.created_by_name is distinct from old.created_by_name then
    raise exception 'Only the done state of a task can be changed.';
  end if;
  if new.done then
    new.done_by_name := public.circle_trusted_name();
    new.done_at := coalesce(old.done_at, now());
  else
    new.done_by_name := ''; new.done_at := null;
  end if;
  return new;
end $$;
