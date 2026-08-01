-- ElderXonnect reminder scheduling migration
-- Run once in Supabase Dashboard > SQL Editor.

alter table public.reminders
  add column if not exists schedule_type text not null default 'daily'
    check (schedule_type in ('daily','once','weekly')),
  add column if not exists schedule_date date,
  add column if not exists schedule_days smallint[] not null default '{}'::smallint[],
  add column if not exists schedule_time time;

-- Preserve existing reminders as daily reminders.
update public.reminders
set schedule_time = coalesce(schedule_time, reminder_time),
    schedule_type = coalesce(nullif(schedule_type,''), 'daily')
where schedule_time is null or schedule_type is null or schedule_type = '';

alter table public.reminders
  drop constraint if exists reminders_schedule_days_valid;

alter table public.reminders
  add constraint reminders_schedule_days_valid
  check (
    schedule_days <@ array[0,1,2,3,4,5,6]::smallint[]
  );
