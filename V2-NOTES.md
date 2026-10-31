# ElderXonnect v2 notes

Made-up people only. Do not put real health information in until the privacy phase (Phase 4) is decided.

## What this branch changes (on top of the Family Circle PR)
- **Visit log** in the Care Circle: who visited, when, how long, what happened. Family and onsite roles can add entries; view-only can read.
- **Three roles that mean something**: Family manager, Onsite caregiver, View only. The elder sees a "Who can do what" card on their own circle and picks each person's role. New invitations now start as **view only** (least privilege).
- **Names can't be faked**: the database stamps the sender/visitor/"done by" name from the verified account email (not the editable profile name). The browser no longer sends names.
- **Tasks can only be ticked**: title, owner and circle can't be rewritten after creation.
- **No more API key for the elder**: the key box is gone and any key saved on a device by older versions is cleared. The companion now answers locally and sends nothing off the phone (this also stops the elder's medical profile from being sent to an AI service). Bringing the AI back needs a server-side key in the Cloudflare relay (not in this repo) and a privacy decision.
- Circle screen split into `circle.html` (page), `circle.js` (screen), `circle-logic.js` (rules that can be tested alone).
- Removed 3 unused patch files (`caregiver-access-display-name.js`, `caregiver-shared-profile.js`, `profile-name-publisher.js`; nothing loaded them).
- Service worker cache bumped to v31 and now caches the circle files.

## Needs Ben
1. Run `care-circle-v2-migration.sql` once in the Supabase SQL Editor for **elderxonnect-v2** (from the Mac). It is safe to run twice. Until then the visit log shows an error and names show as "Someone"; nothing else breaks.
2. Decide the Phase 4 privacy rules (who sees medical details and the address, revoke and deletion). Not built.

## Checks (`npm test`)
- `tests/rls/`: 30+ rule checks run against the real SQL on a throwaway Postgres (stranger sees nothing, viewer can't write, nobody can post as someone else, only the elder can change roles, revoked access stops at once, migration is re-runnable).
- `tests/e2e/`: click-through robot (Chromium, fake Supabase) for elder, family, view-only and signed-out visitors, plus the main page, the weather card and every game.
- `tests/unit/`: the check-in status and role rules, game rules and weather wording. No data or old data is "unknown"/"warning", never "all clear".

## Still open
- **Patch pile**: ~20 small scripts (`caregiver-*.js`, `profile-*.js`, `reminder-*.js`, ...) are still layered on `index.html`. They are all loaded by the service worker and untangling them needs a logged-in click-through on a real v2 project, so it is deferred rather than risked blind.
- Invite email helper (Resend) not on v2 yet; no-check-in alerts and push (Phase 3); not clicked through against the real v2 Supabase (only a fake one and a throwaway database).

## Invite emails (not live yet)
- The email helper is `supabase/functions/send-caregiver-invite`. It now only accepts a link to our own `/caregiver.html` (allowed sites: `INVITE_ALLOWED_ORIGINS`, default the Vercel site) and escapes the elder's name, so it can't be used to send a link to another site.
- To turn it on for v2 (Ben, from the Mac): deploy the function to elderxonnect-v2, and set two secrets in Supabase: `RESEND_API_KEY` and (once a sending domain is verified) `CAREGIVER_INVITE_FROM`. Until a key is set the function answers "Email delivery is not configured" and sends nothing, and the app falls back to the copy-link button.
- Resend's free test sender only delivers to the account owner's own address. A verified domain is needed to email family.

## Opening the app (Me → "Opening the app")
- Three choices on each phone: **Face ID or fingerprint** (shown only when the phone supports it; the PIN stays as a backup behind "Use my PIN instead"), **4-digit PIN**, or **Just open it** (no lock; for phones that are already locked).
- The PIN or Face ID is asked for only after 12 hours of not using the app. Before, it was asked 12 hours after unlocking, even in the middle of use.
- The lock screen shows one big choice. Restoring an account and setting up a new person are folded under "More options". On a phone with no account yet, restore stays visible.
- Face ID here is a lock on this phone only (WebAuthn, no server). The cloud account (Care Circle) stays signed in through Supabase.
- Checked by `tests/e2e/unlock.e2e.js` with Chrome's virtual Face ID device.

## AI chat (links, no API)
- The Chat tab has buttons that open a free AI in a new window: Duck.ai (free, no account), ChatGPT (works without signing in), Claude and Gemini (need a free account). Nothing is sent from our app and there is no key to manage. Close the window to come back.

## Games and weather (no logins, no ads)
- Built into the app, work offline, big tap targets, a big ✕ Close (the phone's Back button and Escape also close): Memory Match (6 or 8 pairs), Sudoku (4×4, 6×6, 9×9), Solitaire (Klondike, tap to move, Undo), Tile Match (mahjong-style; every deal can be finished; Hint and Shuffle).
- Chess links to Lichess (free, open source, no ads, no sign-up needed).
- Rules are in `games-logic.js` and `weather-logic.js`, tested in `tests/unit/`; screens in `games.js` and `weather.js`, clicked through by `tests/e2e/games.e2e.js`.
- Weather uses Open-Meteo (free, no key, credit shown on the card). Nothing is fetched until the person taps "Use my location" or types a town. Location is rounded to about 1 km and kept on the phone only. The forecast is saved for 30 minutes and shown offline.

## Administrator and per-section sharing (care-circle-admin-migration.sql)
- **Who manages the account** is chosen on the Care Circle page: "I manage it myself" or "A family member manages it for me". In managed mode the family member is the **administrator**. Managed mode only takes effect once the administrator has accepted, so a pending invite never locks the elder out.
- In managed mode the elder can still read and post, but cannot invite, remove, change roles, change what is shared, or switch back. Only administrators can; an administrator can hand control back.
- A managed circle always keeps at least one administrator (the last one cannot leave, be removed or be demoted).
- **Per-section sharing**: each person has switches for check-ins, reminders and medications, profile and medical details (includes the address), contacts and the health portal button. Messages, tasks and visits are always on. Roles only set the starting switches. This is enforced in the database for check-ins, reminders, profile and contacts (and the older shared-profile helper), not just hidden on screen. The portal switch is stored but has no button yet.
- Existing people keep what they could already see (one-time backfill from role defaults). New people start with messages, tasks and visits only.
- Run `care-circle-admin-migration.sql` after `care-circle-v2-migration.sql`; safe to run twice. Check with `npm test`.
- Still open: history of who changed sharing, "delete everything", the health portal button, the older caregiver dashboard page still shows what the database now allows (blank sections for people without access).

## Push alerts: "no check-in yet today" (built, not switched on)
- A family member who helps someone sees an **Alerts** card on the circle page. With it on, their phone gets one nudge per person per day if that person hasn't checked in by 11am (the family member's own time zone), as long as they checked in at some point in the last 7 days. People with no check-ins at all, or silent for over a week, never trigger a nudge.
- Only **active** circle members can be nudged (revoked and pending never). `mayReceiveAlert()` in `supabase/functions/send-checkin-alerts/alert-logic.mjs` is the one place to change when the admin/permission model decides who may see check-ins.
- Pieces: `push-alerts-migration.sql` (device list + once-a-day log, privacy locked, safe to run twice), the `send-checkin-alerts` function, `push-client.js` and the push handlers in `service-worker.js`.
- **To switch on (Ben, from the Mac; nothing here is deployed or paid):**
  1. Run `push-alerts-migration.sql` in the elderxonnect-v2 SQL Editor.
  2. Make a push key pair with `npx web-push generate-vapid-keys`. Put the public key in `push-config.js`. Save the private key, the public key, a contact like `mailto:you@example.com`, and a made-up `ALERT_CRON_SECRET` as secrets on the function (never in the repo).
  3. Deploy `send-checkin-alerts`, then have Supabase's built-in scheduler (pg_cron, free) call it every 30 minutes with the secret in the `x-cron-secret` header.
  4. On iPhone the family member must add the app to the Home Screen first.
- Until step 3, the function answers "not configured" and sends nothing.
