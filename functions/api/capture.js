/**
 * Email Capture → Supabase
 * POST /api/capture { email, source, metadata }
 * 
 * Inserts into email_captures table. Anonymous (RLS allows anon inserts).
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

    // Insert into Supabase
    const supabaseUrl = env.SUPABASE_URL;
    const supabaseKey = env.SUPABASE_ANON_KEY;

    const resp = await fetch(`${supabaseUrl}/rest/v1/email_captures`, {
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

    if (resp.ok) {
      // Fire Resend follow-up (fire-and-forget — don't block response)
      sendFollowUp(email, source, metadata, env).catch(e => console.error('Resend error:', e.message));
      return new Response(JSON.stringify({ success: true }), { status: 200, headers });
    } else {
      const err = await resp.text();
      console.error('Supabase insert failed:', err);
      return new Response(JSON.stringify({ success: true }), { status: 200, headers });
    }
  } catch (err) {
    console.error('Capture error:', err);
    return new Response(JSON.stringify({ success: true }), { status: 200, headers });
  }
}

/**
 * Send follow-up email via Resend. Fire-and-forget.
 */
async function sendFollowUp(email, source, metadata, env) {
  const apiKey = env.RESEND_API_KEY;
  if (!apiKey) return;

  const bizName = (metadata?.business_name || 'your business');
  const rating = metadata?.current_rating || '?';
  const severity = metadata?.severity || 'moderate';
  const annualLoss = metadata?.annual_loss || 0;

  const templates = {
    review_audit: {
      subject: `Your ${bizName} Review Audit — ${rating}★ rating`,
      html: reviewAuditEmail(bizName, rating, severity, annualLoss),
    },
    digital_menu: {
      subject: `Your ${bizName} Digital Menu Demo`,
      html: `<p>Thanks for trying the SparkStation Digital Menu Preview. <a href="https://tap.sparkstation.link/how-it-works">See how the full platform works →</a></p>`,
    },
  };

  const tmpl = templates[source] || templates.review_audit;

  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: env.RESEND_FROM_EMAIL || 'SparkStation <hello@sparkstation.link>',
        to: [email],
        subject: tmpl.subject,
        html: tmpl.html,
      }),
    });
  } catch (e) { /* fire-and-forget */ }
}

function reviewAuditEmail(name, rating, severity, loss) {
  const steps = {
    critical: 'Respond to negative reviews immediately, address root cause issues, then generate new reviews.',
    significant: 'Respond to complaints, generate 10+ new reviews this month, recover the revenue gap.',
    moderate: 'Build a consistent review collection system — QR codes, email follow-ups, NFC cards.',
    minimal: 'Turn your strong rating into a marketing asset — feature reviews on your site and social media.',
  };
  const step = steps[severity] || steps.moderate;
  const lossStr = loss > 0 ? ` This is costing an estimated $${Number(loss).toLocaleString()}/year.` : '';

  return `<html><body style="font-family:-apple-system,sans-serif;max-width:560px;margin:0 auto;padding:40px 20px;background:#020617;color:#e2e8f0">
<h1 style="color:#f97316">${name}</h1>
<p style="color:#94a3b8;font-size:15px">You have a <strong>${rating}★ rating</strong>.${lossStr}</p>
<div style="background:#0f172a;border:1px solid #1e293b;border-radius:14px;padding:24px;margin:24px 0">
<p style="color:#f97316;font-weight:800;font-size:10px;text-transform:uppercase;letter-spacing:.2em">Your Action Plan</p>
<p style="color:#e2e8f0;font-size:14px;line-height:1.6">${step}</p>
</div>
<div style="background:rgba(249,115,22,.04);border:1px solid rgba(249,115,22,.1);border-radius:14px;padding:20px;margin-bottom:24px">
<p style="color:#f97316;font-weight:800;font-size:10px;text-transform:uppercase;letter-spacing:.2em">SparkStation Makes This Easy</p>
<p style="color:#cbd5e1;font-size:13px;line-height:1.8">Automated review monitoring · NFC review collection cards · Response templates · Monthly revenue reports</p>
</div>
<a href="https://tap.sparkstation.link/how-it-works" style="display:block;background:#f97316;color:white;padding:14px;border-radius:10px;text-align:center;text-decoration:none;font-weight:700">See How SparkStation Works →</a>
<p style="color:#475569;font-size:11px;text-align:center;margin-top:24px;border-top:1px solid #1e293b;padding-top:16px">SparkStation · Built in Mississippi · <a href="https://sparkstation.link" style="color:#f97316">sparkstation.link</a></p>
</body></html>`;
}
