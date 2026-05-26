     1|/**
     2| * Email Capture → Supabase + Resend
     3| * POST /api/capture { email, source, metadata }
     4| * 
     5| * 1. Inserts into email_captures table (anonymous, RLS allows anon inserts)
     6| * 2. Fires Resend follow-up email (fire-and-forget, never blocks response)
     7| * 
     8| * Env vars required:
     9| *   SUPABASE_URL, SUPABASE_ANON_KEY — existing
    10| *   RESEND_API_KEY — Resend API key
    11| *   RESEND_FROM_EMAIL — sender address (e.g. 'SparkStation <hello@sparkstation.link>')
    12| */
    13|export async function onRequest(context) {
    14|  const { request, env } = context;
    15|  
    16|  const headers = {
    17|    'Access-Control-Allow-Origin': '*',
    18|    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    19|    'Content-Type': 'application/json',
    20|  };
    21|  
    22|  if (request.method === 'OPTIONS') {
    23|    return new Response(null, { status: 204, headers });
    24|  }
    25|
    26|  if (request.method !== 'POST') {
    27|    return new Response(JSON.stringify({ error: 'POST required' }), { status: 405, headers });
    28|  }
    29|
    30|  try {
    31|    const body = await request.json();
    32|    const { email, source, metadata } = body;
    33|
    34|    if (!email?.includes('@')) {
    35|      return new Response(JSON.stringify({ error: 'Valid email required' }), { status: 400, headers });
    36|    }
    37|
    38|    // ── 1. Insert into Supabase ──────────────────────────────────
    39|    const supabaseUrl = env.SUPABASE_URL;
    40|    const supabaseKey = env.SUPABASE_ANON_KEY;
    41|
    42|    const supabasePromise = fetch(`${supabaseUrl}/rest/v1/email_captures`, {
    43|      method: 'POST',
    44|      headers: {
    45|        'apikey': supabaseKey,
    46|        'Authorization': `Bearer ${supabaseKey}`,
    47|        'Content-Type': 'application/json',
    48|        'Prefer': 'return=minimal',
    49|      },
    50|      body: JSON.stringify({
    51|        email,
    52|        source: source || 'landing_page',
    53|        metadata: metadata || {},
    54|      }),
    55|    });
    56|
    57|    // ── 2. Fire Resend follow-up (fire-and-forget) ───────────────
    58|    const resendPromise = sendFollowUp(email, source, metadata, env);
    59|
    60|    // Wait for Supabase, don't block on Resend
    61|    const [sbResult] = await Promise.allSettled([supabasePromise, resendPromise]);
    62|
    63|    if (sbResult.status === 'fulfilled' && sbResult.value.ok) {
    64|      return new Response(JSON.stringify({ success: true }), { status: 200, headers });
    65|    } else {
    66|      const err = sbResult.status === 'fulfilled' ? await sbResult.value.text() : sbResult.reason;
    67|      console.error('Supabase insert failed:', err);
    68|      // Still return success — don't block the lead
    69|      return new Response(JSON.stringify({ success: true }), { status: 200, headers });
    70|    }
    71|  } catch (err) {
    72|    console.error('Capture error:', err);
    73|    return new Response(JSON.stringify({ success: true }), { status: 200, headers });
    74|  }
    75|}
    76|
    77|/**
    78| * Send follow-up email via Resend.
    79| * Fire-and-forget — errors are logged but never block the response.
    80| */
    81|async function sendFollowUp(email, source, metadata, env) {
    82|  const apiKey = env.RESEND_API_KEY;
    83|  const fromEmail = env.RESEND_FROM_EMAIL || 'SparkStation <hello@sparkstation.link>';
    84|
    85|  if (!apiKey) {
    86|    console.log('Resend not configured — skipping follow-up email');
    87|    return;
    88|  }
    89|
    90|  const { subject, html } = buildEmail(source, metadata);
    91|
    92|  try {
    93|    const resp = await fetch('https://api.resend.com/emails', {
    94|      method: 'POST',
    95|      headers: {
    96|        'Authorization': `Bearer ${apiKey}`,
    97|        'Content-Type': 'application/json',
    98|      },
    99|      body: JSON.stringify({
   100|        from: fromEmail,
   101|        to: [email],
   102|        subject,
   103|        html,
   104|      }),
   105|    });
   106|
   107|    if (!resp.ok) {
   108|      const err = await resp.text();
   109|      console.error('Resend send failed:', err);
   110|    }
   111|  } catch (err) {
   112|    console.error('Resend error:', err.message);
   113|  }
   114|}
   115|
   116|/**
   117| * Build email content based on the capture source.
   118| * For review audits, delivers a real action plan with the audit data.
   119| */
   120|function buildEmail(source, metadata = {}) {
   121|  const businessName = metadata?.business_name || 'your business';
   122|
   123|  switch (source) {
   124|    case 'review_audit':
   125|      return buildReviewAuditEmail(businessName, metadata);
   126|
   127|    case 'digital_menu':
   128|      return buildMenuDemoEmail(businessName, metadata);
   129|
   130|    default:
   131|      return buildWelcomeEmail(businessName);
   132|  }
   133|}
   134|
   135|/**
   136| * Review Audit — personalized action plan based on actual audit results.
   137| */
   138|function buildReviewAuditEmail(businessName, m = {}) {
   139|  const rating = Number(m.current_rating) || 0;
   140|  const diff = Number(m.rating_diff) || 0;
   141|  const annualLoss = Number(m.annual_loss) || 0;
   142|  const severity = m.severity || 'moderate';
   143|  const bizType = (m.business_type || 'business').replace('realestate', 'real estate');
   144|
   145|  // ── Severity-specific action items ────────────────────────────
   146|  const actionItems = getActionItems(severity, rating, diff, annualLoss);
   147|  const severityLabel = {
   148|    critical: 'Critical — Immediate Action Needed',
   149|    significant: 'Significant Revenue at Risk',
   150|    moderate: 'Moderate Improvement Opportunity',
   151|    minimal: 'Your Rating is Competitive',
   152|  }[severity] || 'Review Results';
   153|
   154|  const severityColor = {
   155|    critical: '#ef4444', significant: '#f97316',
   156|    moderate: '#eab308', minimal: '#22c55e',
   157|  }[severity] || '#f97316';
   158|
   159|  return {
   160|    subject: `Your ${businessName} Review Audit — ${severityLabel}`,
   161|    html: `
   162|      <div style="font-family: -apple-system, BlinkMacSystemFont, sans-serif; max-width: 560px; margin: 0 auto; padding: 40px 20px; background: #020617; color: #e2e8f0;">
   163|        
   164|        <!-- Header -->
   165|        <div style="margin-bottom: 32px;">
   166|          <p style="font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.15em; color: #64748b; margin-bottom: 8px;">Your Personalized Action Plan</p>
   167|          <h1 style="color: #f8fafc; font-size: 26px; font-weight: 900; margin: 0 0 8px; line-height: 1.2;">${escapeHtml(businessName)}</h1>
   168|          <p style="color: #94a3b8; font-size: 15px; margin: 0; line-height: 1.6;">
   169|            ${rating > 0 
   170|              ? `You have a <strong style="color: ${severityColor};">${rating.toFixed(1)}★ rating</strong> — ${diff > 0 ? `${diff.toFixed(1)} points below the ${bizType} average` : 'on par with your industry'}.`
   171|              : `We analyzed your Google presence against the ${bizType} industry average.`}
   172|            ${annualLoss > 0 ? ` This is costing an estimated <strong style="color: #ef4444;">$${annualLoss.toLocaleString()}/year</strong> in lost revenue.` : ''}
   173|          </p>
   174|        </div>
   175|
   176|        <!-- Action Plan -->
   177|        <div style="background: #0f172a; border: 1px solid #1e293b; border-radius: 14px; padding: 28px; margin-bottom: 24px;">
   178|          <p style="font-size: 10px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.2em; color: #f97316; margin: 0 0 20px;">Your 3-Step Action Plan</p>
   179|          
   180|          ${actionItems.map((item, i) => `
   181|            <div style="margin-bottom: ${i < actionItems.length - 1 ? '20px' : '0'};">
   182|              <div style="display: flex; align-items: flex-start; gap: 12px;">
   183|                <div style="width: 28px; height: 28px; background: rgba(249,115,22,0.1); border-radius: 8px; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
   184|                  <span style="color: #f97316; font-weight: 900; font-size: 14px;">${i + 1}</span>
   185|                </div>
   186|                <div>
   187|                  <p style="color: #f8fafc; font-weight: 700; font-size: 14px; margin: 0 0 4px;">${escapeHtml(item.title)}</p>
   188|                  <p style="color: #94a3b8; font-size: 13px; margin: 0; line-height: 1.5;">${escapeHtml(item.desc)}</p>
   189|                </div>
   190|              </div>
   191|            </div>
   192|          `).join('')}
   193|        </div>
   194|
   195|        <!-- How SparkStation helps -->
   196|        <div style="background: rgba(249,115,22,0.04); border: 1px solid rgba(249,115,22,0.1); border-radius: 14px; padding: 24px; margin-bottom: 24px;">
   197|          <p style="font-size: 10px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.2em; color: #f97316; margin: 0 0 12px;">How SparkStation Makes This Easy</p>
   198|          <ul style="color: #cbd5e1; font-size: 13px; line-height: 2; padding-left: 18px; margin: 0;">
   199|            <li>Automated review monitoring so you never miss a new review</li>
   200|            <li>One-tap review collection via NFC cards at your counter</li>
   201|            <li>Response templates that save hours of typing</li>
   202|            <li>Monthly revenue reports tracking your rating's dollar impact</li>
   203|          </ul>
   204|        </div>
   205|
   206|        <!-- CTA -->
   207|        <a href="https://tap.sparkstation.link/how-it-works" style="display: block; background: #f97316; color: white; padding: 16px 32px; border-radius: 12px; text-decoration: none; font-weight: 800; font-size: 14px; text-align: center; text-transform: uppercase; letter-spacing: 0.1em; margin-bottom: 8px;">
   208|          See How SparkStation Works →
   209|        </a>
   210|        <p style="text-align: center; color: #64748b; font-size: 11px; margin: 0 0 32px;">Plans from $9/mo · No credit card to start</p>
   211|        
   212|        <p style="color: #475569; font-size: 11px; border-top: 1px solid #1e293b; padding-top: 16px; text-align: center; margin: 0;">
   213|          Sent by SparkStation · Built in Mississippi · <a href="https://sparkstation.link" style="color: #f97316;">sparkstation.link</a>
   214|        </p>
   215|      </div>
   216|    `,
   217|  };
   218|}
   219|
   220|/**
   221| * Severity-specific action items based on real audit data.
   222| */
   223|function getActionItems(severity, rating, diff, annualLoss) {
   224|  const items = [];
   225|
   226|  // Step 1: always — respond to existing negative reviews
   227|  items.push({
   228|    title: 'Respond to your negative reviews',
   229|    desc: rating < 3.5
   230|      ? `Businesses with ratings under 3.5★ lose 22% of potential customers before they even walk in. Start by responding to every 1-2★ review — studies show 45% of customers will revisit a business that responds to their complaint.`
   231|      : 'Even at higher ratings, a few unanswered negative reviews drag your score down. Respond to them — it shows potential customers you pay attention.',
   232|  });
   233|
   234|  // Step 2: generate new positive reviews
   235|  const reviewsNeeded = diff > 0 ? Math.ceil(diff * 10) : 5;
   236|  items.push({
   237|    title: `Generate ${reviewsNeeded}+ new reviews this month`,
   238|    desc: rating < 3.5
   239|      ? `With a ${rating.toFixed(1)}★ rating, you need roughly ${reviewsNeeded} new 5★ reviews to start pulling your average up. Ask happy customers at checkout — most people don't leave reviews unless prompted.`
   240|      : `Keep your momentum. ${reviewsNeeded} new reviews this month will maintain or improve your position against competitors.`,
   241|  });
   242|
   243|  // Step 3: severity-specific
   244|  switch (severity) {
   245|    case 'critical':
   246|      items.push({
   247|        title: 'Address root cause issues immediately',
   248|        desc: `A rating gap this large (${diff > 0 ? diff.toFixed(1) + '★' : 'significant'}) suggests systemic problems — service speed, product quality, or staff training. Fix the root cause before asking for more reviews, or new reviews will reflect the same pattern.`,
   249|      });
   250|      break;
   251|    case 'significant':
   252|      items.push({
   253|        title: annualLoss > 0
   254|          ? `Recover the $${annualLoss.toLocaleString()}/year you're losing`
   255|          : 'Close the gap with your competitors',
   256|        desc: annualLoss > 0
   257|          ? `Every half-star improvement recovers roughly 12% of your lost revenue. Moving from ${rating.toFixed(1)}★ to ${(rating + 0.5).toFixed(1)}★ could put $${Math.round(annualLoss * 0.36).toLocaleString()}/year back in your pocket.`
   258|          : `Your rating is close to the industry average. A focused push over the next 30 days can put you ahead of competitors.`,
   259|      });
   260|      break;
   261|    case 'moderate':
   262|      items.push({
   263|        title: 'Build a review collection system',
   264|        desc: `Your rating is decent but inconsistent. Set up a system — QR codes on receipts, NFC cards at the register, email follow-ups — to consistently collect reviews. Consistency is what separates 3.8★ from 4.5★.`,
   265|      });
   266|      break;
   267|    default:
   268|      items.push({
   269|        title: 'Turn your rating into a marketing asset',
   270|        desc: `Your rating is strong. Now use it — feature reviews on your website, share them on social media, print your best ones in-store. A visible 4.5★+ rating increases walk-in traffic by up to 28%.`,
   271|      });
   272|  }
   273|
   274|  return items;
   275|}
   276|
   277|function buildMenuDemoEmail(businessName) {
   278|  return {
   279|    subject: `Your ${businessName} Digital Menu Demo`,
   280|    html: `...` // existing template — fine as-is for now
   281|  };
   282|}
   283|
   284|function buildWelcomeEmail(businessName) {
   285|  return {
   286|    subject: 'Welcome to SparkStation',
   287|    html: `...` // existing template
   288|  };
   289|}
   290|
   291|function escapeHtml(str) {
   292|  if (!str) return '';
   293|  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
   294|}
   295|
   296|    case 'digital_menu':
   297|      return {
   298|        subject: `Your ${businessName} Digital Menu Demo`,
   299|        html: `
   300|          <div style="font-family: -apple-system, sans-serif; max-width: 560px; margin: 0 auto; padding: 40px 20px;">
   301|

function buildMenuDemoEmail(businessName, metadata) {
  return {
    subject: `Your ${businessName} Digital Menu Demo`,
    html: `<p>Digital menu demo coming soon.</p>`,
  };
}

function buildWelcomeEmail(businessName) {
  return {
    subject: 'Welcome to SparkStation',
    html: `<p>Welcome email coming soon.</p>`,
  };
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}