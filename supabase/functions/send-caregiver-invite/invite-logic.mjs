// Pure helpers for the invite email, kept free of Deno/Supabase so `npm test` can check them.

export const DEFAULT_ALLOWED_ORIGINS = ['https://elderxonnect-pwa.vercel.app'];

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

// The invite link must point at our own caregiver page. Without this an elder account
// could make the email carry a link to any site.
export function buildInviteLink(portalUrl, email, allowedOrigins = DEFAULT_ALLOWED_ORIGINS) {
  let url;
  try { url = new URL(String(portalUrl || '').trim()); } catch { return null; }
  const allowed = allowedOrigins.map((o) => o.trim().replace(/\/+$/, '')).filter(Boolean);
  if (url.protocol !== 'https:' || !allowed.includes(url.origin)) return null;
  if (url.pathname !== '/caregiver.html') return null;
  return `${url.origin}${url.pathname}?email=${encodeURIComponent(email)}`;
}

export function parseAllowedOrigins(raw) {
  const list = String(raw || '').split(',').map((s) => s.trim()).filter(Boolean);
  return list.length ? list : DEFAULT_ALLOWED_ORIGINS;
}

export function buildInviteEmail({ elderName, link }) {
  const safeName = escapeHtml(String(elderName || 'Someone you know').slice(0, 80));
  const safeLink = escapeHtml(link);
  return {
    subject: `${String(elderName || 'Someone you know').replace(/[\r\n]+/g, ' ').slice(0, 80)} invited you to ElderXonnect`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#173126">
        <h1 style="color:#1a6b4a">ElderXonnect</h1>
        <p><strong>${safeName}</strong> invited you to join their care circle.</p>
        <p>You will use your own caregiver account, never theirs.</p>
        <p style="margin:28px 0"><a href="${safeLink}" style="background:#2ecc8a;color:#071209;text-decoration:none;padding:13px 20px;border-radius:10px;font-weight:bold">Open Caregiver Invitation</a></p>
        <p style="font-size:13px;color:#61756a">Create an account with this same email address, confirm it, then accept the invitation.</p>
        <p style="font-size:12px;color:#87968e;word-break:break-all">${safeLink}</p>
      </div>`,
  };
}
