import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';
import { alertMessage, checkinAlertDecision, mayReceiveAlert, safeEqual } from './alert-logic.mjs';

// Runs on a schedule (see V2-NOTES.md). Protected by a shared secret, not by a user login.
// Needs these secrets: ALERT_CRON_SECRET, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT.
// Sends nothing and answers "not configured" until they exist.

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const secret = Deno.env.get('ALERT_CRON_SECRET');
  const vapidPublic = Deno.env.get('VAPID_PUBLIC_KEY');
  const vapidPrivate = Deno.env.get('VAPID_PRIVATE_KEY');
  const vapidSubject = Deno.env.get('VAPID_SUBJECT');
  const url = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!secret || !vapidPublic || !vapidPrivate || !vapidSubject || !url || !serviceKey) {
    return json({ sent: 0, error: 'Push alerts are not configured' }, 503);
  }
  if (!safeEqual(req.headers.get('x-cron-secret'), secret)) return json({ error: 'Forbidden' }, 403);

  webpush.setVapidDetails(vapidSubject, vapidPublic, vapidPrivate);
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const now = new Date();

  const { data: subs, error: subsError } = await admin
    .from('push_subscriptions').select('id, user_id, endpoint, p256dh, auth, tz');
  if (subsError) return json({ error: subsError.message }, 500);

  let sent = 0, skipped = 0, removed = 0;
  const byCaregiver = new Map<string, typeof subs>();
  for (const s of subs ?? []) byCaregiver.set(s.user_id, [...(byCaregiver.get(s.user_id) ?? []), s]);

  for (const [caregiverId, devices] of byCaregiver) {
    const { data: links } = await admin.from('caregiver_access')
      .select('elder_id, recipient_display_name, role, status').eq('caregiver_id', caregiverId).eq('status', 'active');
    for (const link of (links ?? []).filter(mayReceiveAlert)) {
      const { data: last } = await admin.from('checkins').select('occurred_at')
        .eq('user_id', link.elder_id).order('occurred_at', { ascending: false }).limit(1).maybeSingle();
      const decision = checkinAlertDecision({ lastCheckinAt: last?.occurred_at ?? null, now, tz: devices[0].tz });
      if (!decision.alert) { skipped++; continue; }
      // One nudge per person per day: the unique key makes a second run a no-op.
      const { error: dupe } = await admin.from('alert_log')
        .insert({ elder_id: link.elder_id, caregiver_id: caregiverId, day: decision.day });
      if (dupe) { skipped++; continue; }
      const message = JSON.stringify(alertMessage(link.recipient_display_name));
      for (const d of devices) {
        try {
          await webpush.sendNotification({ endpoint: d.endpoint, keys: { p256dh: d.p256dh, auth: d.auth } }, message);
          sent++;
        } catch (e) {
          const code = (e as { statusCode?: number }).statusCode;
          if (code === 404 || code === 410) { await admin.from('push_subscriptions').delete().eq('id', d.id); removed++; }
          else console.error('push failed', code);
        }
      }
    }
  }
  return json({ sent, skipped, removed });
});
