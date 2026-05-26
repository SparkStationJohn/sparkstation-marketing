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
 *   RESEND_FROM_EMAIL — sender address
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

    if (!email || !email.includes('@')) {
      return new Response(JSON.stringify({ error: 'Valid email required' }), { status: 400, headers });
    }

    // Insert into Supabase
    const supabaseUrl = env.SUPABASE_URL;
    const supabaseKey = env.SUPABASE_ANON_KEY;

    const resp = await fetch(supabaseUrl + '/rest/v1/email_captures', {
      method: 'POST',
      headers: {
        'apikey': supabaseKey,
        'Authorization': 'Bearer ' + supabaseKey,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal',
      },
      body: JSON.stringify({
        email: email,
        source: source || 'landing_page',
        metadata: metadata || {},
      }),
    });

    if (resp.ok) {
      // Fire Resend follow-up (fire-and-forget)
      sendFollowUp(email, source, metadata, env).catch(function(e) {
        console.error('Resend error:', e.message);
      });
      return new Response(JSON.stringify({ success: true }), { status: 200, headers });
    } else {
      var err = await resp.text();
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
  var apiKey = env.RESEND_API_KEY;
  if (!apiKey) return;

  var bizName = (metadata && metadata.business_name) || 'your business';
  var rating = metadata && metadata.current_rating;
  var severity = (metadata && metadata.severity) || 'moderate';
  var annualLoss = (metadata && metadata.annual_loss) || 0;
  var hasListing = rating && Number(rating) > 0;

  var subject, html;

  if (source === 'digital_menu') {
    subject = 'Your ' + bizName + ' Digital Menu Demo';
    html = '<p>Thanks for trying the SparkStation Digital Menu Preview. <a href="https://tap.sparkstation.link/how-it-works">See how the full platform works →</a></p>';
  } else if (!hasListing) {
    subject = 'Get ' + bizName + ' Found on Google';
    html = noListingEmail(bizName);
  } else {
    subject = 'Your ' + bizName + ' Review Audit — ' + rating + '★ rating';
    html = reviewAuditEmail(bizName, rating, severity, annualLoss);
  }

  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: env.RESEND_FROM_EMAIL || 'SparkStation <hello@sparkstation.link>',
        to: [email],
        subject: subject,
        html: html,
      }),
    });
  } catch (e) { /* fire-and-forget */ }
}

function reviewAuditEmail(name, rating, severity, loss) {
  var steps = {
    critical: 'Respond to negative reviews immediately, address root cause issues, then generate new reviews.',
    significant: 'Respond to complaints, generate 10+ new reviews this month, recover the revenue gap.',
    moderate: 'Build a consistent review collection system — QR codes, email follow-ups, NFC cards.',
    minimal: 'Turn your strong rating into a marketing asset — feature reviews on your site and social media.',
  };
  var step = steps[severity] || steps.moderate;
  var lossStr = loss > 0 ? ' This is costing an estimated $' + Number(loss).toLocaleString() + '/year.' : '';

  return '<html><body style="font-family:-apple-system,sans-serif;max-width:560px;margin:0 auto;padding:40px 20px;background:#020617;color:#e2e8f0">' +
    '<h1 style="color:#f97316">' + name + '</h1>' +
    '<p style="color:#94a3b8;font-size:15px">You have a <strong>' + rating + '★ rating</strong>.' + lossStr + '</p>' +
    '<div style="background:#0f172a;border:1px solid #1e293b;border-radius:14px;padding:24px;margin:24px 0">' +
    '<p style="color:#f97316;font-weight:800;font-size:10px;text-transform:uppercase;letter-spacing:.2em">Your Action Plan</p>' +
    '<p style="color:#e2e8f0;font-size:14px;line-height:1.6">' + step + '</p>' +
    '</div>' +
    '<div style="background:rgba(249,115,22,.04);border:1px solid rgba(249,115,22,.1);border-radius:14px;padding:20px;margin-bottom:24px">' +
    '<p style="color:#f97316;font-weight:800;font-size:10px;text-transform:uppercase;letter-spacing:.2em">SparkStation Makes This Easy</p>' +
    '<p style="color:#cbd5e1;font-size:13px;line-height:1.8">Automated review monitoring · NFC review collection cards · Response templates · Monthly revenue reports</p>' +
    '</div>' +
    '<a href="https://tap.sparkstation.link/how-it-works" style="display:block;background:#f97316;color:white;padding:14px;border-radius:10px;text-align:center;text-decoration:none;font-weight:700">See How SparkStation Works →</a>' +
    '<p style="color:#475569;font-size:11px;text-align:center;margin-top:24px;border-top:1px solid #1e293b;padding-top:16px">SparkStation · Built in Mississippi · <a href="https://sparkstation.link" style="color:#f97316">sparkstation.link</a></p>' +
    '</body></html>';
}

function noListingEmail(name) {
  return '<html><body style="font-family:-apple-system,sans-serif;max-width:560px;margin:0 auto;padding:40px 20px;background:#020617;color:#e2e8f0">' +
    '<h1 style="color:#f97316;font-size:22px">' + name + ' isn\'t on Google yet.</h1>' +
    '<p style="color:#94a3b8;font-size:15px;line-height:1.6">That\'s actually great news — it means you\'re starting with a clean slate. No bad reviews to overcome, no reputation damage to undo. You just need to <strong style="color:#f8fafc">get found.</strong></p>' +
    '<div style="background:#0f172a;border:1px solid #1e293b;border-radius:14px;padding:24px;margin:24px 0">' +
    '<p style="color:#f97316;font-weight:800;font-size:10px;text-transform:uppercase;letter-spacing:.2em">Your 3-Step Get-Found Plan</p>' +
    '<div style="margin-bottom:16px"><p style="color:#f8fafc;font-weight:700;font-size:14px;margin:0 0 4px">1. Create your Google Business Profile</p><p style="color:#94a3b8;font-size:13px;margin:0;line-height:1.5">Free. Takes 10 minutes. Go to google.com/business and claim your listing. This is how customers find you on Google Maps and Search.</p></div>' +
    '<div style="margin-bottom:16px"><p style="color:#f8fafc;font-weight:700;font-size:14px;margin:0 0 4px">2. Get your first 10 reviews</p><p style="color:#94a3b8;font-size:13px;margin:0;line-height:1.5">Ask your best regulars. Send a follow-up email. Put a QR code at the register. The first 10 reviews set your baseline.</p></div>' +
    '<div><p style="color:#f8fafc;font-weight:700;font-size:14px;margin:0 0 4px">3. Stay ahead of competitors</p><p style="color:#94a3b8;font-size:13px;margin:0;line-height:1.5">Most businesses in your industry already have reviews. But they\'re not monitoring them. You can start fresh AND stay on top — that\'s a real advantage.</p></div>' +
    '</div>' +
    '<div style="background:rgba(249,115,22,.04);border:1px solid rgba(249,115,22,.1);border-radius:14px;padding:20px;margin-bottom:24px">' +
    '<p style="color:#f97316;font-weight:800;font-size:10px;text-transform:uppercase;letter-spacing:.2em">SparkStation Helps You Get Found</p>' +
    '<p style="color:#cbd5e1;font-size:13px;line-height:1.8">NFC cards that send customers straight to your review page · QR codes for your counter and tables · Automated review requests after every visit · Dashboard that tracks your rating as it grows</p>' +
    '</div>' +
    '<a href="https://tap.sparkstation.link/how-it-works" style="display:block;background:#f97316;color:white;padding:14px;border-radius:10px;text-align:center;text-decoration:none;font-weight:700">See How SparkStation Works →</a>' +
    '<p style="color:#475569;font-size:11px;text-align:center;margin-top:24px;border-top:1px solid #1e293b;padding-top:16px">SparkStation · Built in Mississippi · <a href="https://sparkstation.link" style="color:#f97316">sparkstation.link</a></p>' +
    '</body></html>';
}
