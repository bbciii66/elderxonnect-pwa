-- ElderXonnect care circle v2: visit log, locked-down edits, trusted sender names.
-- Safe to run more than once. Run AFTER full-setup-v2.sql (or care-circle-migration.sql).
-- NOT YET APPLIED. Review, then run once in Supabase Dashboard > SQL Editor (from the Mac).

-- 1. Visit log: one row per visit by a family member or onsite caregiver.
create table if not exists public.circle_visits (
  id uuid primary key default gen_random_uuid(),
  elder_id uuid not null references auth.users(id) on delete cascade,
  visitor_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  visitor_name text not null default '',
  visited_at timestamptz not null default now(),
  minutes integer check (minutes is null or minutes between 1 and 1440),
  notes text not null default '' check (char_length(notes) <= 2000),
  created_at timestamptz not null default now()
);
create index if not exists circle_visits_elder_idx on public.circle_visits(elder_id, visited_at desc);
alter table public.circle_visits enable row level security;

drop policy if exists "Circle reads visits" on public.circle_visits;
create policy "Circle reads visits" on public.circle_visits for select to authenticated
using (public.circle_can_read(elder_id));
drop policy if exists "Circle writes visits" on public.circle_visits;
create policy "Circle writes visits" on public.circle_visits for insert to authenticated
with check (public.circle_can_write(elder_id) and visitor_id = (select auth.uid()));
grant select, insert on public.circle_visits to authenticated;

-- 2. Names come from the signed-in account, never from the browser, so nobody can post as someone else.
create or replace function public.circle_trusted_name()
returns text language sql stable as $$
  select coalesce(
    nullif(trim(auth.jwt()->'user_metadata'->>'full_name'), ''),
    nullif(split_part(coalesce(auth.jwt()->>'email', ''), '@', 1), ''),
    'Someone');
$$;
create or replace function public.circle_stamp_sender()
returns trigger language plpgsql as $$
begin
  if tg_table_name = 'circle_messages' then new.sender_name := public.circle_trusted_name();
  elsif tg_table_name = 'circle_visits' then new.visitor_name := public.circle_trusted_name();
  elsif tg_table_name = 'circle_tasks' then new.created_by_name := public.circle_trusted_name();
  end if;
  return new;
end $$;
drop trigger if exists circle_messages_stamp on public.circle_messages;
create trigger circle_messages_stamp before insert on public.circle_messages
  for each row execute function public.circle_stamp_sender();
drop trigger if exists circle_visits_stamp on public.circle_visits;
create trigger circle_visits_stamp before insert on public.circle_visits
  for each row execute function public.circle_stamp_sender();
drop trigger if exists circle_tasks_stamp on public.circle_tasks;
create trigger circle_tasks_stamp before insert on public.circle_tasks
  for each row execute function public.circle_stamp_sender();

-- 3. A task may only be marked done (or reopened). Title, owner and circle cannot be rewritten.
create or replace function public.circle_tasks_guard()
returns trigger language plpgsql as $$
begin
  if new.id <> old.id or new.elder_id <> old.elder_id or new.title <> old.title
     or new.created_by <> old.created_by or new.created_at <> old.created_at then
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
drop trigger if exists circle_tasks_guard on public.circle_tasks;
create trigger circle_tasks_guard before update on public.circle_tasks
  for each row execute function public.circle_tasks_guard();

-- 4. Least privilege for new invitations: view-only until the elder picks a role.
alter table public.caregiver_access alter column role set default 'viewer';
