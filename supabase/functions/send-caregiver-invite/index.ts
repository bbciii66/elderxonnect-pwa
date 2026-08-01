import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const resendKey = Deno.env.get('RESEND_API_KEY');
    const fromEmail = Deno.env.get('CAREGIVER_INVITE_FROM') || 'ElderXonnect <onboarding@resend.dev>';

    if (!supabaseUrl || !anonKey || !serviceKey) {
      return json({ error: 'Supabase function environment is incomplete' }, 500);
    }
    if (!resendKey) {
      return json({ sent: false, error: 'Email delivery is not configured' }, 503);
    }

    const authHeader = req.headers.get('Authorization') || '';
    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });
    const { data: userData, error: userError } = await callerClient.auth.getUser();
    if (userError || !userData.user) return json({ error: 'Authentication required' }, 401);

    const { invitationId, caregiverEmail, portalUrl } = await req.json();
    const email = String(caregiverEmail || '').trim().toLowerCase();
    const invitation = String(invitationId || '').trim();
    const portal = String(portalUrl || '').trim();
    if (!invitation || !email || !email.includes('@') || !portal.startsWith('https://')) {
      return json({ error: 'Invalid invitation request' }, 400);
    }

    const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
    const { data: access, error: accessError } = await admin
      .from('caregiver_access')
      .select('id, elder_id, caregiver_email, status')
      .eq('id', invitation)
      .eq('elder_id', userData.user.id)
      .maybeSingle();

    if (accessError) return json({ error: accessError.message }, 500);
    if (!access || access.status !== 'pending' || access.caregiver_email.toLowerCase() !== email) {
      return json({ error: 'Invitation not found or no longer pending' }, 404);
    }

    const link = `${portal}?email=${encodeURIComponent(email)}`;
    const elderName = String(userData.user.user_metadata?.full_name || userData.user.email || 'Someone you know');
    const subject = `${elderName} invited you to ElderXonnect`;
    const html = `
      <div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#173126">
        <h1 style="color:#1a6b4a">ElderXonnect</h1>
        <p><strong>${elderName.replace(/[<>&"']/g, '')}</strong> invited you to securely view their shared care information.</p>
        <p>Your access is read-only and uses your own caregiver account.</p>
        <p style="margin:28px 0"><a href="${link}" style="background:#2ecc8a;color:#071209;text-decoration:none;padding:13px 20px;border-radius:10px;font-weight:bold">Open Caregiver Invitation</a></p>
        <p style="font-size:13px;color:#61756a">Create an account with this same email address, confirm it, then accept the invitation.</p>
        <p style="font-size:12px;color:#87968e;word-break:break-all">${link}</p>
      </div>`;

    const mailResponse = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from: fromEmail, to: [email], subject, html }),
    });
    const mailData = await mailResponse.json();
    if (!mailResponse.ok) {
      console.error('Resend error', mailData);
      return json({ sent: false, error: mailData?.message || 'Email provider rejected the message' }, 502);
    }

    return json({ sent: true, id: mailData.id });
  } catch (error) {
    console.error(error);
    return json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
});
