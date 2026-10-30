-- ElderXonnect push alerts: where to send a family member's "no check-in yet today" nudge.
-- NOT YET APPLIED. Safe to run twice. Run in the Supabase SQL Editor for elderxonnect-v2 (from the Mac).

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  endpoint text not null unique check (endpoint like 'https://%'),
  p256dh text not null check (char_length(p256dh) between 1 and 200),
  auth text not null check (char_length(auth) between 1 and 100),
  tz text not null default 'UTC' check (char_length(tz) between 1 and 64),
  created_at timestamptz not null default now()
);
create index if not exists push_subscriptions_user_idx on public.push_subscriptions(user_id);
alter table public.push_subscriptions enable row level security;

-- A person manages only their own devices. The sender uses the service role, which skips these rules.
drop policy if exists "Own devices read" on public.push_subscriptions;
create policy "Own devices read" on public.push_subscriptions for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists "Own devices add" on public.push_subscriptions;
create policy "Own devices add" on public.push_subscriptions for insert to authenticated with check (user_id = (select auth.uid()));
drop policy if exists "Own devices remove" on public.push_subscriptions;
create policy "Own devices remove" on public.push_subscriptions for delete to authenticated using (user_id = (select auth.uid()));
grant select, insert, delete on public.push_subscriptions to authenticated;

-- One nudge per person per day. No one can read or write it from the app; only the sender (service role).
create table if not exists public.alert_log (
  elder_id uuid not null references auth.users(id) on delete cascade,
  caregiver_id uuid not null references auth.users(id) on delete cascade,
  day date not null,
  sent_at timestamptz not null default now(),
  primary key (elder_id, caregiver_id, day)
);
alter table public.alert_log enable row level security;
revoke all on public.alert_log from anon, authenticated;
