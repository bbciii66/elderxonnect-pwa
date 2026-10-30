# ElderXonnect v2 notes

Made-up people only. Do not put real health information in until the privacy phase (Phase 4) is decided.

## What this branch changes (on top of the Family Circle PR)
- **Visit log** in the Care Circle: who visited, when, how long, what happened. Family and onsite roles can add entries; view-only can read.
- **Three roles that mean something**: Family manager, Onsite caregiver, View only. The elder sees a "Who can do what" card on their own circle and picks each person's role. New invitations now start as **view only** (least privilege).
- **Names can't be faked**: the database stamps the sender/visitor/"done by" name from the signed-in account. The browser no longer sends names.
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
- `tests/e2e/`: click-through robot (Chromium, fake Supabase) for elder, family, view-only and signed-out visitors, plus the main page.
- `tests/unit/`: the check-in status and role rules. No data or old data is "unknown"/"warning", never "all clear".

## Still open
- **Patch pile**: ~20 small scripts (`caregiver-*.js`, `profile-*.js`, `reminder-*.js`, ...) are still layered on `index.html`. They are all loaded by the service worker and untangling them needs a logged-in click-through on a real v2 project, so it is deferred rather than risked blind.
- Invite email helper (Resend) not on v2 yet; no-check-in alerts and push (Phase 3); not clicked through against the real v2 Supabase (only a fake one and a throwaway database).
