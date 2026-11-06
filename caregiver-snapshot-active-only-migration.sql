-- ElderXonnect privacy fix: pending and revoked caregivers must never hold a copy of the care recipient's profile.
-- Safe to run more than once. Run AFTER care-circle-admin-migration.sql.
-- NOT YET APPLIED. Review, then run once in Supabase Dashboard > SQL Editor.
--
-- The problem: the profile snapshot (recipient_profile) lives on the caregiver_access row, and the policy
-- "Caregivers view their invitations" lets the person on that row read it whatever its status. So a pending
-- invitee, or someone who was revoked, could still read the profile with a plain select.
-- The fix: a snapshot exists only on an ACTIVE row that is allowed the profile section. Any other status is
-- blanked by the database itself, and the elder's profile sync no longer writes to those rows.

-- 1. The snapshot guard now also requires status = 'active'.
create or replace function public.circle_snapshot_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- The recipient's name, like the profile, is only held by ACTIVE rows.
  if new.status <> 'active' then
    new.recipient_display_name := null;
  elsif tg_op = 'INSERT' or old.status <> 'active' then
    select nullif(trim(p.profile_data->>'name'), '') into new.recipient_display_name
      from public.profiles p where p.user_id = new.elder_id;
  end if;
  if new.status = 'active' and (new.role = 'admin' or 'profile' = any(new.sections)) then
    if tg_op = 'INSERT' or new.recipient_profile = '{}'::jsonb
       or (old.role <> 'admin' and not ('profile' = any(old.sections)) and old.recipient_profile = '{}'::jsonb)
       or old.status <> 'active' then
      -- Newly allowed (or just accepted): start from the elder's current profile, never from a stale copy.
      if tg_op = 'UPDATE' and old.status <> 'active' then new.recipient_profile := '{}'::jsonb; end if;
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
-- (the trigger caregiver_access_snapshot from care-circle-admin-migration.sql keeps pointing at this function)

-- 2. The elder's profile sync only touches rows that may hold a snapshot.
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
     and status = 'active'
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

-- 2a. The name function also only writes active rows.
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
     and status = 'active'
     and recipient_display_name is distinct from clean_name;

  get diagnostics changed_count = row_count;
  return changed_count;
end;
$$;
revoke all on function public.set_care_recipient_display_name(text) from public;
grant execute on function public.set_care_recipient_display_name(text) to authenticated;

-- 2b. A person is recognised by their account, not by an email address. Only a PENDING invitation can be matched
--     by email; active access needs the bound user id. Otherwise someone who later takes over an old email address
--     could read the active row (and its snapshot) or take the access over.
drop policy if exists "Caregivers view their invitations" on public.caregiver_access;
create policy "Caregivers view their invitations"
on public.caregiver_access for select to authenticated
using (
  caregiver_id = (select auth.uid())
  or (status = 'pending' and lower(caregiver_email) = lower(coalesce((select auth.jwt()->>'email'), '')))
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
       (status = 'pending' and lower(caregiver_email) = signed_in_email)
       or (status = 'active' and caregiver_id = auth.uid())
     )
  returning * into accepted;

  if accepted.id is null then
    raise exception 'No matching pending invitation was found for this email address.';
  end if;

  return accepted;
end;
$$;
revoke all on function public.accept_caregiver_invitation(uuid) from public;
grant execute on function public.accept_caregiver_invitation(uuid) to authenticated;

-- 2c. Pending and revoked rows hold no recipient name.
update public.caregiver_access set recipient_display_name = null where status <> 'active' and recipient_display_name is not null;

-- 3. One-time cleanup: blank every snapshot that belongs to a pending or revoked row, or to a row that may not see it.
--    (The trigger re-runs on this update and blanks them; the where clause just limits the work.)
update public.caregiver_access
   set recipient_profile = '{}'::jsonb
 where recipient_profile <> '{}'::jsonb
   and (status <> 'active' or not (role = 'admin' or 'profile' = any(sections)));
