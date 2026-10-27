-- ElderXonnect care circle: shared messages and tasks for an elder and their caregivers.
-- NOT YET APPLIED. Review, then run once in Supabase Dashboard > SQL Editor (from the Mac).

-- Caregiver roles: family (can write), onsite (can write), viewer (read only).
alter table public.caregiver_access
  add column if not exists role text not null default 'family'
  check (role in ('family','onsite','viewer'));

-- Who is in this elder's circle? Elder, or an active caregiver. Writers exclude viewers.
create or replace function public.circle_can_read(target_elder uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() = target_elder
      or exists (select 1 from public.caregiver_access ca
                 where ca.elder_id = target_elder and ca.caregiver_id = auth.uid() and ca.status = 'active');
$$;
create or replace function public.circle_can_write(target_elder uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() = target_elder
      or exists (select 1 from public.caregiver_access ca
                 where ca.elder_id = target_elder and ca.caregiver_id = auth.uid()
                   and ca.status = 'active' and ca.role <> 'viewer');
$$;
revoke all on function public.circle_can_read(uuid), public.circle_can_write(uuid) from public;
grant execute on function public.circle_can_read(uuid), public.circle_can_write(uuid) to authenticated;

create table if not exists public.circle_messages (
  id uuid primary key default gen_random_uuid(),
  elder_id uuid not null references auth.users(id) on delete cascade,
  sender_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  sender_name text not null default '',
  body text not null check (char_length(body) between 1 and 1000),
  created_at timestamptz not null default now()
);
create index if not exists circle_messages_elder_idx on public.circle_messages(elder_id, created_at desc);

create table if not exists public.circle_tasks (
  id uuid primary key default gen_random_uuid(),
  elder_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 200),
  created_by uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_by_name text not null default '',
  done boolean not null default false,
  done_by_name text not null default '',
  done_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists circle_tasks_elder_idx on public.circle_tasks(elder_id, created_at desc);

alter table public.circle_messages enable row level security;
alter table public.circle_tasks enable row level security;

drop policy if exists "Circle reads messages" on public.circle_messages;
create policy "Circle reads messages" on public.circle_messages for select to authenticated
using (public.circle_can_read(elder_id));
drop policy if exists "Circle writes messages" on public.circle_messages;
create policy "Circle writes messages" on public.circle_messages for insert to authenticated
with check (public.circle_can_write(elder_id) and sender_id = (select auth.uid()));

drop policy if exists "Circle reads tasks" on public.circle_tasks;
create policy "Circle reads tasks" on public.circle_tasks for select to authenticated
using (public.circle_can_read(elder_id));
drop policy if exists "Circle writes tasks" on public.circle_tasks;
create policy "Circle writes tasks" on public.circle_tasks for insert to authenticated
with check (public.circle_can_write(elder_id) and created_by = (select auth.uid()));
drop policy if exists "Circle updates tasks" on public.circle_tasks;
create policy "Circle updates tasks" on public.circle_tasks for update to authenticated
using (public.circle_can_write(elder_id)) with check (public.circle_can_write(elder_id));

grant select, insert on public.circle_messages to authenticated;
grant select, insert, update on public.circle_tasks to authenticated;

-- Let the elder choose each caregiver's role (elder policy on caregiver_access already allows updates).
