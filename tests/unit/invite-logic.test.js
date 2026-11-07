const test = require('node:test');
const assert = require('node:assert');

const load = () => import('../../supabase/functions/send-caregiver-invite/invite-logic.mjs');
const GOOD = 'https://elderxonnect-pwa.vercel.app/caregiver.html';

test('accepts our own caregiver page and encodes the email', async () => {
  const { buildInviteLink } = await load();
  assert.strictEqual(buildInviteLink(GOOD, 'pat+test@example.com'),
    'https://elderxonnect-pwa.vercel.app/caregiver.html?email=pat%2Btest%40example.com');
});

test('rejects links to other sites, other paths, and non-https', async () => {
  const { buildInviteLink } = await load();
  for (const bad of ['https://evil.example/caregiver.html', 'http://elderxonnect-pwa.vercel.app/caregiver.html',
    'https://elderxonnect-pwa.vercel.app/other', 'https://elderxonnect-pwa.vercel.app.evil.example/caregiver.html',
    'https://elderxonnect-pwa.vercel.app/caregiver.html"onmouseover="x', 'javascript:alert(1)', '', null]) {
    assert.strictEqual(buildInviteLink(bad, 'a@b.co'), null, String(bad));
  }
});

test('extra allowed origins come from the environment list', async () => {
  const { buildInviteLink, parseAllowedOrigins } = await load();
  const origins = parseAllowedOrigins('https://x.example/, https://y.example');
  assert.ok(buildInviteLink('https://x.example/caregiver.html', 'a@b.co', origins));
  assert.strictEqual(buildInviteLink(GOOD, 'a@b.co', origins), null);
  assert.deepStrictEqual(parseAllowedOrigins(''), ['https://elderxonnect-pwa.vercel.app']);
});

test('email is generic: no name, no injection, only our link', async () => {
  const { buildInviteEmail } = await load();
  const link = GOOD + '?email=bob%40example.test';
  // Even if a caller still passes a name (older code did), it must never reach the email.
  const { subject, html } = buildInviteEmail({ elderName: 'Pat Example <script>x</script>\r\nBcc: a@b.co', link });
  assert.ok(!subject.includes('Pat') && !html.includes('Pat') && !html.includes('Example'));
  assert.ok(!html.includes('<script>'));
  assert.ok(!/[\r\n]/.test(subject));
  assert.ok(html.includes('care circle') && html.includes(link));
});
