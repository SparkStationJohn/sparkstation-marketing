/**
 * Email Capture → Supabase + Resend
 * POST /api/capture { email, source, metadata }
 * 
 * 1. Inserts into email_captures table (anonymous, RLS allows anon inserts)
 * 2. Fires Resend follow-up email (fire-and-forget, never blocks response)
 * 
 * Env vars required:
 *   SUPABASE_URL, SUPABASE_ANON_KEY — existing
 *   RESEND_API_KEY — Resend API key
 *   RESEND_FROM_EMAIL — sender address (e.g. 'SparkStation <hello@sparkstation.link>')
 */
export async function onRequest(context) {
  const { request, env } = context;
  
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
  };
  
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers });
  }

  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'POST required' }), { status: 405, headers });
  }

  try {
    const body = await request.json();
    const { email, source, metadata } = body;

    if (!email?.includes('@')) {
      return new Response(JSON.stringify({ error: 'Valid email required' }), { status: 400, headers });
    }

    // ── 1. Insert into Supabase ──────────────────────────────────
    const supabaseUrl = env.SUPABASE_URL;
    const supabaseKey = env.SUPABASE_ANON_KEY;

    const supabasePromise = fetch(`${supabaseUrl}/rest/v1/email_captures`, {
      method: 'POST',
      headers: {
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal',
      },
      body: JSON.stringify({
        email,
        source: source || 'landing_page',
        metadata: metadata || {},
      }),
    });

    // ── 2. Fire Resend follow-up (fire-and-forget) ───────────────
    const resendPromise = sendFollowUp(email, source, metadata, env);

    // Wait for Supabase, don't block on Resend
    const [sbResult] = await Promise.allSettled([supabasePromise, resendPromise]);

    if (sbResult.status === 'fulfilled' && sbResult.value.ok) {
      return new Response(JSON.stringify({ success: true }), { status: 200, headers });
    } else {
      const err = sbResult.status === 'fulfilled' ? await sbResult.value.text() : sbResult.reason;
      console.error('Supabase insert failed:', err);
      // Still return success — don't block the lead
      return new Response(JSON.stringify({ success: true }), { status: 200, headers });
    }
  } catch (err) {
    console.error('Capture error:', err);
    return new Response(JSON.stringify({ success: true }), { status: 200, headers });
  }
}

/**
 * Send follow-up email via Resend.
 * Fire-and-forget — errors are logged but never block the response.
 */
async function sendFollowUp(email, source, metadata, env) {
  const apiKey = env.RESEND_API_KEY;
  const fromEmail = env.RESEND_FROM_EMAIL || 'SparkStation <hello@sparkstation.link>';

  if (!apiKey) {
    console.log('Resend not configured — skipping follow-up email');
    return;
  }

  const { subject, html } = buildEmail(source, metadata);

  try {
    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: fromEmail,
        to: [email],
        subject,
        html,
      }),
    });

    if (!resp.ok) {
      const err = await resp.text();
      console.error('Resend send failed:', err);
    }
  } catch (err) {
    console.error('Resend error:', err.message);
  }
}

/**
 * Build email content based on the capture source.
 */
function buildEmail(source, metadata = {}) {
  const businessName = metadata?.business_name || 'your business';

  switch (source) {
    case 'review_audit':
      return {
        subject: `Your ${businessName} Review Audit Results`,
        html: `
          <div style="font-family: -apple-system, sans-serif; max-width: 560px; margin: 0 auto; padding: 40px 20px;">
            <h1 style="color: #f97316; font-size: 24px; margin-bottom: 8px;">Your Review Audit is Ready</h1>
            <p style="color: #475569; font-size: 15px; line-height: 1.6; margin-bottom: 24px;">
              We analyzed ${businessName}'s Google presence. Here's what we found and how SparkStation helps you fix it.
            </p>
            
            <div style="background: #0f172a; border: 1px solid #1e293b; border-radius: 12px; padding: 24px; margin-bottom: 24px;">
              <p style="color: #94a3b8; font-size: 12px; text-transform: uppercase; letter-spacing: 0.1em; margin-bottom: 12px;">SparkStation Pro unlocks:</p>
              <ul style="color: #e2e8f0; font-size: 14px; line-height: 2; padding-left: 20px;">
                <li>Real-time review monitoring across all locations</li>
                <li>Automated review response templates</li>
                <li>Customer sentiment analytics dashboard</li>
                <li>NFC-powered review collection hardware</li>
                <li>QR code review cards for tables and counters</li>
              </ul>
            </div>

            <a href="https://tap.sparkstation.link/how-it-works" style="display: inline-block; background: #f97316; color: white; padding: 14px 32px; border-radius: 10px; text-decoration: none; font-weight: 700; font-size: 14px;">
              See How SparkStation Works →
            </a>
            
            <p style="color: #64748b; font-size: 12px; margin-top: 32px; border-top: 1px solid #1e293b; padding-top: 16px;">
              Sent by SparkStation · Built in Mississippi · <a href="https://sparkstation.link" style="color: #f97316;">sparkstation.link</a>
            </p>
          </div>
        `,
      };

    case 'digital_menu':
      return {
        subject: `Your ${businessName} Digital Menu Demo`,
        html: `
          <div style="font-family: -apple-system, sans-serif; max-width: 560px; margin: 0 auto; padding: 40px 20px;">
            <h1 style="color: #f97316; font-size: 24px; margin-bottom: 8px;">Your Digital Menu Demo</h1>
            <p style="color: #475569; font-size: 15px; line-height: 1.6; margin-bottom: 24px;">
              Here's how ${businessName} can go from paper menus to a complete digital storefront — QR ordering, real-time updates, and zero app downloads required.
            </p>
            
            <div style="background: #0f172a; border: 1px solid #1e293b; border-radius: 12px; padding: 24px; margin-bottom: 24px;">
              <p style="color: #94a3b8; font-size: 12px; text-transform: uppercase; letter-spacing: 0.1em; margin-bottom: 12px;">SparkStation Pro unlocks:</p>
              <ul style="color: #e2e8f0; font-size: 14px; line-height: 2; padding-left: 20px;">
                <li>QR code menus — no app, instant load</li>
                <li>Real-time menu updates from your dashboard</li>
                <li>Order capture — customer orders go straight to you</li>
                <li>Multi-location menu management</li>
                <li>NFC table tags for instant menu access</li>
              </ul>
            </div>

            <a href="https://tap.sparkstation.link/how-it-works" style="display: inline-block; background: #f97316; color: white; padding: 14px 32px; border-radius: 10px; text-decoration: none; font-weight: 700; font-size: 14px;">
              See How SparkStation Works →
            </a>
            
            <p style="color: #64748b; font-size: 12px; margin-top: 32px; border-top: 1px solid #1e293b; padding-top: 16px;">
              Sent by SparkStation · Built in Mississippi · <a href="https://sparkstation.link" style="color: #f97316;">sparkstation.link</a>
            </p>
          </div>
        `,
      };

    default:
      return {
        subject: 'Welcome to SparkStation',
        html: `
          <div style="font-family: -apple-system, sans-serif; max-width: 560px; margin: 0 auto; padding: 40px 20px;">
            <h1 style="color: #f97316; font-size: 24px; margin-bottom: 8px;">Welcome to SparkStation</h1>
            <p style="color: #475569; font-size: 15px; line-height: 1.6; margin-bottom: 24px;">
              Thanks for trying our free tools. SparkStation is the complete physical-to-digital platform behind them — NFC hardware, digital identity, and automated marketing for businesses that live in the real world.
            </p>
            
            <a href="https://tap.sparkstation.link/how-it-works" style="display: inline-block; background: #f97316; color: white; padding: 14px 32px; border-radius: 10px; text-decoration: none; font-weight: 700; font-size: 14px;">
              Explore the Platform →
            </a>
            
            <p style="color: #64748b; font-size: 12px; margin-top: 32px; border-top: 1px solid #1e293b; padding-top: 16px;">
              Sent by SparkStation · Built in Mississippi · <a href="https://sparkstation.link" style="color: #f97316;">sparkstation.link</a>
            </p>
          </div>
        `,
      };
  }
}
