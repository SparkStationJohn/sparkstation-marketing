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
      return new Response(JSON.stringify({ success: true }), { status: 200, headers });
    } else {
      const err = await resp.text();
      console.error('Supabase insert failed:', err);
      return new Response(JSON.stringify({ success: true }), { status: 200, headers });
    }
  } catch (err) {
    console.error('Capture error:', err);
    // Always return success to the user — don't block the lead
    return new Response(JSON.stringify({ success: true }), { status: 200, headers });
  }
}
