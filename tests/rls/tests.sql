-- Care circle database rules. Made-up people only. Each check raises an error if the rule is broken.
insert into auth.users(id,email) values
 ('00000000-0000-0000-0000-00000000000e','edna.testerson@example.com'),
 ('00000000-0000-0000-0000-0000000000f1','fran.testerson@example.com'),
 ('00000000-0000-0000-0000-0000000000a1','omar.aide@example.com'),
 ('00000000-0000-0000-0000-0000000000b1','vic.viewer@example.com'),
 ('00000000-0000-0000-0000-0000000000c1','stan.stranger@example.com');
insert into public.caregiver_access(elder_id,caregiver_id,caregiver_email,status,role) values
 ('00000000-0000-0000-0000-00000000000e','00000000-0000-0000-0000-0000000000f1','fran.testerson@example.com','active','family'),
 ('00000000-0000-0000-0000-00000000000e','00000000-0000-0000-0000-0000000000a1','omar.aide@example.com','active','onsite'),
 ('00000000-0000-0000-0000-00000000000e','00000000-0000-0000-0000-0000000000b1','vic.viewer@example.com','active','viewer');
insert into public.caregiver_access(elder_id,caregiver_id,caregiver_email,status) values
 ('00000000-0000-0000-0000-00000000000e',null,'new.person@example.com','pending');

create schema testkit; grant usage on schema testkit to public;
create or replace function testkit.login(uid text, mail text, nm text default null) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub',uid,'email',mail,'user_metadata',
          case when nm is null then '{}'::json else json_build_object('full_name',nm) end)::text, false);
  set role authenticated;
end $$;
create or replace function testkit.logout() returns void language plpgsql as $$
begin reset role; perform set_config('request.jwt.claims','',false); end $$;
-- run a statement as the current user and report whether it was blocked
create or replace function testkit.blocked(stmt text) returns boolean language plpgsql as $$
declare n int;
begin execute stmt; get diagnostics n = row_count; return n = 0;
exception when others then return true; end $$;

\set E '''00000000-0000-0000-0000-00000000000e'''
\set F '''00000000-0000-0000-0000-0000000000f1'''
\set A '''00000000-0000-0000-0000-0000000000a1'''
\set V '''00000000-0000-0000-0000-0000000000b1'''
\set S '''00000000-0000-0000-0000-0000000000c1'''

-- 0. New invitations default to view-only
do $$ begin
  assert (select role from public.caregiver_access where caregiver_email='new.person@example.com')='viewer', 'new invites should default to viewer';
end $$;

-- 1. Family and onsite can post; names are stamped by the server, not trusted from the browser
select testkit.login(:F,'fran.testerson@example.com','Fran T');
insert into public.circle_messages(elder_id,body,sender_name) values (:E,'Hi Edna, coming at 3','Edna (forged)');
select testkit.login(:A,'omar.aide@example.com');
insert into public.circle_messages(elder_id,body) values (:E,'Lunch done');
select testkit.logout();
do $$ begin
  assert (select count(*) from public.circle_messages)=2, 'two messages expected';
  assert (select sender_name from public.circle_messages where body like 'Hi Edna%')='fran.testerson', 'sender name must come from the verified email, not editable profile text';
  assert (select sender_name from public.circle_messages where body='Lunch done')='omar.aide', 'falls back to email name';
end $$;

-- 2. Viewer can read but not write anything
select testkit.login(:V,'vic.viewer@example.com');
do $$ begin
  assert (select count(*) from public.circle_messages)=2, 'viewer should read messages';
  assert testkit.blocked($q$insert into public.circle_messages(elder_id,body) values ('00000000-0000-0000-0000-00000000000e','x')$q$), 'viewer must not post';
  assert testkit.blocked($q$insert into public.circle_tasks(elder_id,title) values ('00000000-0000-0000-0000-00000000000e','x')$q$), 'viewer must not add tasks';
  assert testkit.blocked($q$insert into public.circle_visits(elder_id,notes) values ('00000000-0000-0000-0000-00000000000e','x')$q$), 'viewer must not log visits';
end $$;

-- 3. A stranger sees nothing and can write nothing
select testkit.login(:S,'stan.stranger@example.com');
do $$ begin
  assert (select count(*) from public.circle_messages)=0, 'stranger must not read messages';
  assert (select count(*) from public.circle_tasks)=0, 'stranger must not read tasks';
  assert (select count(*) from public.circle_visits)=0, 'stranger must not read visits';
  assert testkit.blocked($q$insert into public.circle_messages(elder_id,body) values ('00000000-0000-0000-0000-00000000000e','x')$q$), 'stranger must not post';
  assert testkit.blocked($q$insert into public.circle_visits(elder_id,notes) values ('00000000-0000-0000-0000-00000000000e','x')$q$), 'stranger must not log visits';
end $$;

-- 4. Cannot post as someone else
select testkit.login(:F,'fran.testerson@example.com','Fran T');
do $$ begin
  assert testkit.blocked($q$insert into public.circle_messages(elder_id,sender_id,body) values ('00000000-0000-0000-0000-00000000000e','00000000-0000-0000-0000-0000000000a1','spoof')$q$), 'sender_id must be the caller';
  assert testkit.blocked($q$insert into public.circle_visits(elder_id,visitor_id,notes) values ('00000000-0000-0000-0000-00000000000e','00000000-0000-0000-0000-0000000000a1','spoof')$q$), 'visitor_id must be the caller';
  assert testkit.blocked($q$update public.circle_messages set body='edited'$q$), 'messages cannot be edited';
  assert testkit.blocked($q$delete from public.circle_messages$q$), 'messages cannot be deleted';
end $$;

-- 5. Visit log works for family and onsite, with server-stamped names
insert into public.circle_visits(elder_id,minutes,notes,visitor_name) values (:E,45,'Brought groceries','Edna (forged)');
select testkit.login(:A,'omar.aide@example.com','Omar');
insert into public.circle_visits(elder_id,minutes,notes) values (:E,30,'Helped with bath');
select testkit.logout();
do $$ begin
  assert (select count(*) from public.circle_visits)=2, 'two visits expected';
  assert (select visitor_name from public.circle_visits where notes='Brought groceries')='fran.testerson', 'visitor name stamped from the verified email, not the forged one';
  assert (select visitor_name from public.circle_visits where notes='Helped with bath')='omar.aide', 'a self-chosen full_name must not be used as the visitor name';
end $$;
-- the visit log respects its limits
select testkit.login(:F,'fran.testerson@example.com','Fran T');
do $$ begin
  assert testkit.blocked($q$insert into public.circle_visits(elder_id,minutes) values ('00000000-0000-0000-0000-00000000000e',0)$q$), 'minutes must be positive';
  assert testkit.blocked($q$update public.circle_visits set notes='edited'$q$), 'visits cannot be edited';
end $$;

-- 6. Tasks: anyone who can write may add and tick; nobody may rewrite title/owner/circle
insert into public.circle_tasks(elder_id,title) values (:E,'Refill pills');
do $$ declare t uuid; begin
  select id into t from public.circle_tasks where title='Refill pills';
  assert testkit.blocked(format($q$update public.circle_tasks set title='Something else' where id=%L$q$,t)), 'title cannot change';
  assert testkit.blocked(format($q$update public.circle_tasks set elder_id=%L where id=%L$q$,'00000000-0000-0000-0000-0000000000c1',t)), 'task cannot move circles';
  assert not testkit.blocked(format($q$update public.circle_tasks set done=true, done_by_name='Edna (forged)' where id=%L$q$,t)), 'tick should work';
  assert (select done_by_name from public.circle_tasks where id=t)='fran.testerson', 'done-by stamped from the verified email';
end $$;
select testkit.login(:V,'vic.viewer@example.com');
do $$ begin
  assert testkit.blocked($q$update public.circle_tasks set done=false$q$), 'viewer cannot reopen tasks';
end $$;

-- 7. Roles: only the elder can change them; a caregiver cannot promote themselves
select testkit.login(:V,'vic.viewer@example.com');
do $$ begin
  assert testkit.blocked($q$update public.caregiver_access set role='family' where caregiver_id='00000000-0000-0000-0000-0000000000b1'$q$), 'viewer must not promote self';
  assert testkit.blocked($q$update public.caregiver_access set status='active', role='family' where caregiver_email='new.person@example.com'$q$), 'cannot touch others';
end $$;
select testkit.login(:E,'edna.testerson@example.com','Edna T');
do $$ begin
  assert not testkit.blocked($q$update public.caregiver_access set role='onsite' where caregiver_id='00000000-0000-0000-0000-0000000000b1'$q$), 'elder can change roles';
  assert testkit.blocked($q$update public.caregiver_access set role='admin' where caregiver_id='00000000-0000-0000-0000-0000000000b1'$q$), 'unknown role rejected';
end $$;
insert into public.caregiver_access(elder_id,caregiver_email,status,role) values (:E,'new.aide@example.com','pending','onsite');
select testkit.login(:V,'vic.viewer@example.com');
do $$ begin
  assert testkit.blocked($q$insert into public.caregiver_access(elder_id,caregiver_email,status,role) values ('00000000-0000-0000-0000-00000000000e','sneaky@example.com','active','family')$q$), 'a caregiver cannot invite people into the elder circle';
end $$;
-- the promoted caregiver can now post
select testkit.login(:V,'vic.viewer@example.com');
insert into public.circle_messages(elder_id,body) values (:E,'Now I can post');

-- 8. Revoked caregivers lose access immediately
select testkit.login(:E,'edna.testerson@example.com','Edna T');
update public.caregiver_access set status='revoked' where caregiver_id=:A;
select testkit.login(:A,'omar.aide@example.com');
do $$ begin
  assert (select count(*) from public.circle_messages)=0, 'revoked caregiver must not read';
  assert testkit.blocked($q$insert into public.circle_messages(elder_id,body) values ('00000000-0000-0000-0000-00000000000e','x')$q$), 'revoked caregiver must not post';
end $$;

-- 9. The elder reads and posts in their own circle
select testkit.login(:E,'edna.testerson@example.com','Edna T');
insert into public.circle_messages(elder_id,body) values (:E,'I am okay today');
do $$ begin assert (select count(*) from public.circle_messages)=4, 'elder sees all messages'; end $$;
select testkit.logout();
-- 10. Push devices: you see and manage only your own; strangers and other caregivers see nothing
select testkit.login(:F,'fran.testerson@example.com');
insert into public.push_subscriptions(endpoint,p256dh,auth,tz) values ('https://push.example/fran','k','a','America/Chicago');
do $$ begin
  assert testkit.blocked($q$insert into public.push_subscriptions(user_id,endpoint,p256dh,auth) values ('00000000-0000-0000-0000-0000000000a1','https://push.example/hijack','k','a')$q$), 'cannot register a device for someone else';
  assert testkit.blocked($q$insert into public.push_subscriptions(endpoint,p256dh,auth) values ('http://insecure.example/x','k','a')$q$), 'endpoint must be https';
end $$;
select testkit.login(:F,'fran.testerson@example.com');
insert into public.push_subscriptions(endpoint,p256dh,auth,tz) values ('https://push.example/fran','k2','a2','America/New_York') on conflict (endpoint) do update set p256dh=excluded.p256dh, tz=excluded.tz;
do $$ begin assert (select tz from public.push_subscriptions where endpoint='https://push.example/fran')='America/New_York', 'owner can refresh their own device'; end $$;
select testkit.login(:A,'omar.aide@example.com');
do $$ begin
  assert testkit.blocked($q$update public.push_subscriptions set tz='UTC'$q$), 'cannot change someone else''s device';
  assert (select count(*) from public.push_subscriptions)=0, 'another caregiver must not see Fran''s device';
  assert testkit.blocked($q$delete from public.push_subscriptions$q$), 'cannot delete someone else''s device';
end $$;
select testkit.login(:E,'edna.testerson@example.com');
do $$ begin
  assert (select count(*) from public.push_subscriptions)=0, 'the elder does not see caregiver devices';
  assert testkit.blocked($q$insert into public.alert_log(elder_id,caregiver_id,day) values ('00000000-0000-0000-0000-00000000000e','00000000-0000-0000-0000-0000000000f1',current_date)$q$), 'app users cannot write the alert log';
  assert testkit.blocked($q$select 1 from public.alert_log$q$), 'app users cannot read the alert log';
end $$;
select testkit.logout();
\echo ALL DATABASE RULE CHECKS PASSED
